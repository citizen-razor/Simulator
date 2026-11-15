/**
 * SCIM 2.0 (RFC 7643/7644) provisioning, so an organisation's identity provider (Okta,
 * Microsoft Entra ID, …) can create, update and deactivate people, and send each person's
 * MANAGER, which builds the reporting hierarchy leaders see.
 *
 *   Base URL:  https://<your host>/scim/v2         (once hosted; IdPs can't reach localhost)
 *   Auth:      Authorization: Bearer <token>       (issued on the People page; one per organisation)
 *
 * Supported: ServiceProviderConfig, ResourceTypes, Schemas; Users list (with
 * `filter=userName eq "…"`, startIndex, count), get, create, replace (PUT), PATCH
 * (add/replace/remove, with or without paths: Okta and Entra styles), DELETE.
 * DELETE deactivates rather than erases, so the person's training history is kept.
 * Groups aren't synced: roles are managed in the app (new people are learners; anyone with
 * reports is a leader automatically).
 */
import express, { type NextFunction, type Request, type Response, Router } from "express";
import type { User } from "../shared/people";
import { orgForScimToken, orgUsers, updateUsers } from "./auth";
import { HttpError, runInOrg } from "./storage";

export const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCHEMA_ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const SCHEMA_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const SCHEMA_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCHEMA_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

class ScimError extends Error {
  constructor(public status: number, message: string, public scimType?: string) {
    super(message);
  }
}

// ------------------------------------------------------------------ mapping (pure; tested)

/** Our user → a SCIM User resource. */
export function toScim(u: User, base: string) {
  const [givenName, ...rest] = u.name.split(" ");
  return {
    schemas: [SCHEMA_USER, SCHEMA_ENTERPRISE],
    id: u.id,
    externalId: u.externalId,
    userName: u.email,
    displayName: u.name,
    name: { formatted: u.name, givenName, familyName: rest.join(" ") || undefined },
    emails: [{ value: u.email, type: "work", primary: true }],
    active: u.active,
    [SCHEMA_ENTERPRISE]: u.managerId ? { manager: { value: u.managerId, $ref: `${base}/Users/${u.managerId}` } } : {},
    meta: { resourceType: "User", created: u.createdAt, lastModified: u.updatedAt, location: `${base}/Users/${u.id}` },
  };
}

export interface ScimFields {
  email?: string;
  name?: string;
  active?: boolean;
  externalId?: string;
  /** undefined = not mentioned; null = remove; string = manager's SCIM id (or externalId) */
  manager?: string | null;
  /** Name parts sent on their own (PATCH name.givenName / name.familyName); combined with the current name. */
  givenName?: string;
  familyName?: string;
}

/** The full name after applying separately-sent name parts to the current name. */
export function combineName(current: string, f: Pick<ScimFields, "name" | "givenName" | "familyName">): string {
  if (f.name) return f.name;
  const [given, ...rest] = current.split(" ");
  const family = rest.join(" ");
  return [f.givenName ?? given, f.familyName ?? family].filter(Boolean).join(" ") || current;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : v === "True" || v === "true" ? true : v === "False" || v === "false" ? false : undefined);

function nameFrom(body: Json): string | undefined {
  const name = (body.name ?? {}) as Json;
  return str(body.displayName) || str(name.formatted) || [str(name.givenName), str(name.familyName)].filter(Boolean).join(" ") || undefined;
}
function emailFrom(body: Json): string | undefined {
  const emails = Array.isArray(body.emails) ? (body.emails as Json[]) : [];
  const primary = emails.find((e) => e.primary === true) ?? emails[0];
  return (str(body.userName) || str(primary?.value))?.toLowerCase();
}
function managerFrom(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object") {
    const v = (value as Json).value;
    return typeof v === "string" ? v || null : v === null ? null : undefined;
  }
  return undefined;
}

/** Fields from a full SCIM User (POST, PUT). */
export function fieldsFromResource(body: Json): ScimFields {
  const ext = (body[SCHEMA_ENTERPRISE] ?? {}) as Json;
  return {
    email: emailFrom(body),
    name: nameFrom(body),
    active: bool(body.active),
    externalId: str(body.externalId),
    manager: "manager" in ext ? managerFrom(ext.manager) : undefined,
  };
}

/** Fields from a PATCH request's Operations. Handles path and path-less (Entra) forms. */
export function fieldsFromPatch(body: Json): ScimFields {
  const ops = Array.isArray(body.Operations) ? (body.Operations as Json[]) : [];
  const out: ScimFields = {};
  const apply = (path: string, value: unknown, remove: boolean) => {
    const p = path.toLowerCase();
    if (p === "active") out.active = remove ? false : bool(value);
    else if (p === "username") out.email = str(value)?.toLowerCase();
    else if (p === "displayname" || p === "name.formatted") out.name = str(value);
    else if (p === "name.givenname") out.givenName = str(value);
    else if (p === "name.familyname") out.familyName = str(value);
    else if (p === "externalid") out.externalId = str(value);
    else if (p.startsWith("emails")) out.email = (typeof value === "string" ? value : str((Array.isArray(value) ? value[0] : value as Json)?.value))?.toLowerCase();
    else if (p === `${SCHEMA_ENTERPRISE}:manager`.toLowerCase() || p === `${SCHEMA_ENTERPRISE}:manager.value`.toLowerCase() || p === "manager") {
      out.manager = remove ? null : managerFrom(value);
    }
  };
  for (const op of ops) {
    const kind = String(op.op ?? "").toLowerCase();
    if (!["add", "replace", "remove"].includes(kind)) throw new ScimError(400, `Unsupported PATCH op "${op.op}"`, "invalidSyntax");
    const path = str(op.path);
    if (path) apply(path, op.value, kind === "remove");
    else if (op.value && typeof op.value === "object") {
      // Path-less: { value: { active: false, "name.givenName": "…", "urn:…:manager": {…} } }
      for (const [k, v] of Object.entries(op.value as Json)) {
        if (k === SCHEMA_ENTERPRISE && v && typeof v === "object") for (const [k2, v2] of Object.entries(v as Json)) apply(`${SCHEMA_ENTERPRISE}:${k2}`, v2, false);
        else if (k === "name" && v && typeof v === "object") {
          const n = v as Json;
          if (str(n.formatted)) out.name = str(n.formatted);
          if (str(n.givenName)) out.givenName = str(n.givenName);
          if (str(n.familyName)) out.familyName = str(n.familyName);
        }
        else apply(k, v, false);
      }
    }
  }
  return out;
}

/** `userName eq "x"` / `externalId eq "x"` → a predicate. Other filters are rejected. */
export function parseFilter(filter: string | undefined): ((u: User) => boolean) | null {
  if (!filter) return null;
  const m = filter.match(/^\s*(userName|externalId|emails\.value|id)\s+eq\s+"([^"]*)"\s*$/i);
  if (!m) throw new ScimError(400, `Unsupported filter: ${filter}`, "invalidFilter");
  const attr = m[1].toLowerCase();
  const value = m[2].toLowerCase();
  if (attr === "externalid") return (u) => (u.externalId ?? "").toLowerCase() === value;
  if (attr === "id") return (u) => u.id.toLowerCase() === value;
  return (u) => u.email === value;
}

// ------------------------------------------------------------------ routes

export const scimRouter = Router();
scimRouter.use(express.json({ type: ["application/json", "application/scim+json"], limit: "1mb" }));

type Authed = Request & { orgId: string };
const handle = (fn: (req: Authed, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req as Authed, res).catch(next);

scimRouter.use(async (req, res, next) => {
  const token = (req.get("authorization") ?? "").match(/^Bearer\s+(\S+)$/i)?.[1];
  const orgId = token ? await orgForScimToken(token).catch(() => null) : null;
  if (!orgId) return sendError(res, new ScimError(401, "A valid SCIM bearer token is required."));
  (req as Authed).orgId = orgId;
  res.type("application/scim+json");
  runInOrg(orgId, () => next());
});

const base = (req: Request) => `${req.protocol}://${req.get("host")}/scim/v2`;

scimRouter.get("/ServiceProviderConfig", (_req, res) => {
  res.json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [{ type: "oauthbearertoken", name: "Bearer token", description: "Issued on the People page" }],
  });
});
scimRouter.get("/ResourceTypes", (req, res) => {
  res.json({
    schemas: [SCHEMA_LIST],
    totalResults: 1,
    Resources: [{ schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: SCHEMA_USER, schemaExtensions: [{ schema: SCHEMA_ENTERPRISE, required: false }], meta: { location: `${base(req)}/ResourceTypes/User`, resourceType: "ResourceType" } }],
  });
});
scimRouter.get("/Schemas", (_req, res) => {
  res.json({
    schemas: [SCHEMA_LIST],
    totalResults: 2,
    Resources: [
      { id: SCHEMA_USER, name: "User", attributes: ["userName", "name", "displayName", "emails", "active", "externalId"].map((n) => ({ name: n })) },
      { id: SCHEMA_ENTERPRISE, name: "EnterpriseUser", attributes: [{ name: "manager" }] },
    ],
  });
});

scimRouter.get("/Users", handle(async (req, res) => {
  const pred = parseFilter(typeof req.query.filter === "string" ? req.query.filter : undefined);
  const all = (await orgUsers(req.orgId)).filter((u) => !pred || pred(u));
  const start = Math.max(1, Number(req.query.startIndex) || 1);
  const count = Math.min(200, Math.max(0, Number(req.query.count ?? 100)));
  const page = all.slice(start - 1, start - 1 + count);
  res.json({ schemas: [SCHEMA_LIST], totalResults: all.length, startIndex: start, itemsPerPage: page.length, Resources: page.map((u) => toScim(u, base(req))) });
}));

scimRouter.get("/Users/:id", handle(async (req, res) => {
  const u = (await orgUsers(req.orgId)).find((x) => x.id === req.params.id);
  if (!u) throw new ScimError(404, "User not found");
  res.json(toScim(u, base(req)));
}));

/** Apply SCIM fields to one person (create if `id` is null). Returns the saved user's id. */
async function save(orgId: string, id: string | null, f: ScimFields, replace: boolean): Promise<string> {
  let savedId = id ?? "";
  await updateUsers(orgId, async (users, { make }) => {
    const resolveManager = (m: string | null | undefined) =>
      m === undefined ? undefined : m === null ? null : (users.find((u) => u.id === m) ?? users.find((u) => u.externalId === m))?.id ?? null;
    if (f.email && users.some((u) => u.email === f.email && u.id !== id)) throw new ScimError(409, `${f.email} already exists`, "uniqueness");
    if (id === null) {
      if (!f.email) throw new ScimError(400, "userName (an email address) is required", "invalidValue");
      const u = await make({ email: f.email, name: f.name || f.email, roles: ["learner"], managerId: resolveManager(f.manager) ?? null, active: f.active ?? true, externalId: f.externalId }, null);
      users.push(u);
      savedId = u.id;
      return;
    }
    const u = users.find((x) => x.id === id);
    if (!u) throw new ScimError(404, "User not found");
    if (f.email) u.email = f.email;
    if (f.name || f.givenName || f.familyName) u.name = combineName(u.name, f);
    if (f.active !== undefined) u.active = f.active;
    if (f.externalId !== undefined) u.externalId = f.externalId;
    const m = resolveManager(f.manager);
    if (m !== undefined) u.managerId = m === u.id ? null : m;
    else if (replace) u.managerId = null; // PUT replaces the whole resource
    u.updatedAt = new Date().toISOString();
  });
  return savedId;
}

scimRouter.post("/Users", handle(async (req, res) => {
  const id = await save(req.orgId, null, fieldsFromResource(req.body ?? {}), true);
  const u = (await orgUsers(req.orgId)).find((x) => x.id === id)!;
  res.status(201).location(`${base(req)}/Users/${id}`).json(toScim(u, base(req)));
}));

scimRouter.put("/Users/:id", handle(async (req, res) => {
  await save(req.orgId, req.params.id as string, fieldsFromResource(req.body ?? {}), true);
  res.json(toScim((await orgUsers(req.orgId)).find((x) => x.id === req.params.id)!, base(req)));
}));

scimRouter.patch("/Users/:id", handle(async (req, res) => {
  const body = (req.body ?? {}) as Json;
  if (Array.isArray(body.schemas) && !body.schemas.includes(SCHEMA_PATCH)) throw new ScimError(400, "Expected a PatchOp request", "invalidSyntax");
  await save(req.orgId, req.params.id as string, fieldsFromPatch(body), false);
  res.json(toScim((await orgUsers(req.orgId)).find((x) => x.id === req.params.id)!, base(req)));
}));

scimRouter.delete("/Users/:id", handle(async (req, res) => {
  await save(req.orgId, req.params.id as string, { active: false }, false);
  res.status(204).end();
}));

function sendError(res: Response, e: unknown) {
  const status = e instanceof ScimError || e instanceof HttpError ? e.status : 500;
  const detail = e instanceof Error ? e.message : "Internal error";
  res.status(status).type("application/scim+json").json({ schemas: [SCHEMA_ERROR], status: String(status), detail, scimType: e instanceof ScimError ? e.scimType : undefined });
}
scimRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => sendError(res, err));
