/**
 * Accounts, sign-in and organisations.
 *
 *   data/system/orgs.json      organisations (one for now: "default")
 *   data/system/users.json     everyone, with their organisation, roles and manager
 *   data/system/sessions.json  signed-in sessions (only a hash of each token is stored)
 *
 * Passwords: scrypt with a random salt per user, compared in constant time; at least 10
 * characters. Sign-in is rate-limited per account and overall.
 * Sessions: a random 32-byte token in an HttpOnly, SameSite=Strict cookie (Secure when
 * served over HTTPS), valid 14 days. Together with the X-Simulator header the API already
 * requires on every change, other websites can't act as a signed-in user.
 *
 * First run: with no users at all, the setup screen creates the organisation and its first
 * Admin-Builder. Everything already in data/ belongs to that default organisation.
 */
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { can, canAssign, canView, effectiveRoles, UserSchema, type Action, type Role, type User } from "../shared/people";
import { DATA_DIR, DEFAULT_ORG, ensureOrgStorage, HttpError, newId, runInOrg } from "./storage";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const SYSTEM_DIR = path.join(DATA_DIR, "system");
const USERS_FILE = path.join(SYSTEM_DIR, "users.json");
const ORGS_FILE = path.join(SYSTEM_DIR, "orgs.json");
const SESSIONS_FILE = path.join(SYSTEM_DIR, "sessions.json");
const SESSION_DAYS = 14;
export const SESSION_COOKIE = "sim_session";
export const MIN_PASSWORD = 10;

const StoredUser = UserSchema.extend({ passwordHash: z.string().nullable().default(null) });
type StoredUser = z.infer<typeof StoredUser>;
export const OrgSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(100),
  /** sha256 of the SCIM bearer token, if one has been issued. */
  scimTokenHash: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type Org = z.infer<typeof OrgSchema>;
const Session = z.object({ tokenHash: z.string(), userId: z.string(), expiresAt: z.number() });
type Session = z.infer<typeof Session>;

// ------------------------------------------------------------------ files

async function readList<T>(file: string, schema: z.ZodType<T>): Promise<T[]> {
  try {
    return z.array(schema).parse(JSON.parse(await fs.readFile(file, "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
async function writeList(file: string, list: unknown[]) {
  await fs.mkdir(SYSTEM_DIR, { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), { mode: 0o600 });
  await fs.rename(tmp, file);
}

let lock: Promise<unknown> = Promise.resolve();
/** Run a read-modify-write on the system files one at a time. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const job = lock.then(fn);
  lock = job.catch(() => undefined);
  return job;
}

const readUsers = () => readList(USERS_FILE, StoredUser);
export const readOrgs = () => readList(ORGS_FILE, OrgSchema);
const strip = ({ passwordHash: _h, ...u }: StoredUser): User => u;

/** Everyone in an organisation (without password hashes). */
export async function orgUsers(orgId: string): Promise<User[]> {
  return (await readUsers()).filter((u) => u.orgId === orgId).map(strip);
}

// ------------------------------------------------------------------ passwords

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  // Always do the work, even for unknown users, so timing doesn't reveal who has an account.
  const [, saltHex, keyHex] = (stored ?? "scrypt$00$00").split("$");
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return !!stored && expected.length === key.length && timingSafeEqual(key, expected);
}

export function checkPasswordRules(password: string) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters.`);
  if (password.length > 200) throw new HttpError(400, "That password is too long.");
}

/** A readable one-time password for new or reset accounts. */
export function temporaryPassword(): string {
  const words = randomBytes(12).toString("base64url").replace(/[-_]/g, "x");
  return `${words.slice(0, 4)}-${words.slice(4, 8)}-${words.slice(8, 12)}`;
}

// ------------------------------------------------------------------ sessions

async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await serial(async () => {
    const now = Date.now();
    const sessions = (await readList(SESSIONS_FILE, Session)).filter((s) => s.expiresAt > now);
    sessions.push({ tokenHash: sha256(token), userId, expiresAt: now + SESSION_DAYS * 86_400_000 });
    await writeList(SESSIONS_FILE, sessions);
  });
  return token;
}

async function endSessions(match: (s: Session) => boolean) {
  await serial(async () => {
    const sessions = await readList(SESSIONS_FILE, Session);
    await writeList(SESSIONS_FILE, sessions.filter((s) => !match(s)));
  });
}

function setCookie(req: Request, res: Response, token: string | null) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https" ? "; Secure" : "";
  const value = token ?? "";
  const age = token ? SESSION_DAYS * 86400 : 0;
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`);
}

function readCookie(req: Request): string | null {
  const m = (req.headers.cookie ?? "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([a-f0-9]{64})`));
  return m ? m[1] : null;
}

// ------------------------------------------------------------------ request user

export interface AuthedRequest extends Request {
  user: User;
  /** Everyone in the user's organisation (for hierarchy checks). */
  people: User[];
}

/**
 * Resolve the signed-in user, if any, and run the rest of the request inside their
 * organisation, so storage only ever touches that organisation's files.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readCookie(req);
    if (token) {
      const sessions = await readList(SESSIONS_FILE, Session);
      const session = sessions.find((s) => s.tokenHash === sha256(token) && s.expiresAt > Date.now());
      const all = session ? await readUsers() : [];
      const user = all.find((u) => u.id === session?.userId && u.active);
      if (user) {
        const people = all.filter((u) => u.orgId === user.orgId).map(strip);
        Object.assign(req, { user: strip(user), people });
        return runInOrg(user.orgId, () => {
          ensureOrgStorage().then(() => next(), next);
        });
      }
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireUser(req: Request): AuthedRequest {
  if (!(req as Partial<AuthedRequest>).user) throw new HttpError(401, "Please sign in.");
  return req as AuthedRequest;
}

/** Throw unless the signed-in user may do this. */
export function requirePermission(req: Request, action: Action): AuthedRequest {
  const r = requireUser(req);
  if (!can(r.user, r.people, action)) {
    throw new HttpError(403, action === "simulations.build" ? "Only Builders and Admin-Builders can do that." : "Only Admin-Builders can do that.");
  }
  return r;
}

export const userCan = (req: Request, action: Action) => {
  const r = req as Partial<AuthedRequest>;
  return !!r.user && can(r.user, r.people!, action);
};
export const viewerCanSee = (req: AuthedRequest, userId: string) => canView(req.user, req.people, userId);
export const viewerCanAssign = (req: AuthedRequest, userId: string) => canAssign(req.user, req.people, userId);
export const rolesOf = (req: AuthedRequest): Role[] => [...effectiveRoles(req.user, req.people)];

// ------------------------------------------------------------------ sign-in routes

const failures = new Map<string, number[]>();
function rateLimit(key: string) {
  const now = Date.now();
  const recent = (failures.get(key) ?? []).filter((t) => now - t < 15 * 60_000);
  failures.set(key, recent);
  if (recent.length >= 8) throw new HttpError(429, "Too many failed sign-ins. Try again in 15 minutes.");
}
function recordFailure(key: string) {
  failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
}

export async function authState(req: Request) {
  const r = req as Partial<AuthedRequest>;
  const users = await readUsers();
  const orgs = await readOrgs();
  if (!r.user) return { setupNeeded: users.length === 0, user: null };
  return {
    setupNeeded: false,
    user: r.user,
    roles: rolesOf(r as AuthedRequest),
    org: orgs.find((o) => o.id === r.user!.orgId)?.name ?? "",
  };
}

/** First run only: create the organisation and its first Admin-Builder, and sign them in. */
export async function setup(req: Request, res: Response) {
  const body = z.object({ orgName: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email(), password: z.string() }).parse(req.body);
  checkPasswordRules(body.password);
  const user = await serial(async () => {
    if ((await readUsers()).length) throw new HttpError(409, "This app is already set up. Sign in instead.");
    const now = new Date().toISOString();
    await writeList(ORGS_FILE, [{ id: DEFAULT_ORG, name: body.orgName, scimTokenHash: null, createdAt: now }]);
    const u: StoredUser = StoredUser.parse({
      id: newId("user"), orgId: DEFAULT_ORG, email: body.email, name: body.name, roles: ["admin", "builder"],
      managerId: null, active: true, createdAt: now, updatedAt: now, passwordHash: await hashPassword(body.password),
    });
    await writeList(USERS_FILE, [u]);
    return u;
  });
  setCookie(req, res, await createSession(user.id));
}

export async function login(req: Request, res: Response) {
  const email = String(req.body?.email ?? "").trim().toLowerCase();
  const password = String(req.body?.password ?? "");
  rateLimit("*");
  rateLimit(email);
  const user = (await readUsers()).find((u) => u.email === email);
  const ok = await verifyPassword(password, user?.passwordHash ?? null);
  if (!user || !ok || !user.active) {
    recordFailure(email);
    recordFailure("*");
    throw new HttpError(401, "That email and password don't match an active account.");
  }
  failures.delete(email);
  setCookie(req, res, await createSession(user.id));
}

export async function logout(req: Request, res: Response) {
  const token = readCookie(req);
  if (token) await endSessions((s) => s.tokenHash === sha256(token));
  setCookie(req, res, null);
}

export async function changeOwnPassword(req: Request) {
  const r = requireUser(req);
  const current = String(req.body?.current ?? "");
  const next = String(req.body?.next ?? "");
  checkPasswordRules(next);
  await serial(async () => {
    const all = await readUsers();
    const u = all.find((x) => x.id === r.user.id)!;
    if (!(await verifyPassword(current, u.passwordHash))) throw new HttpError(400, "Your current password isn't right.");
    u.passwordHash = await hashPassword(next);
    u.updatedAt = new Date().toISOString();
    await writeList(USERS_FILE, all);
  });
}

// ------------------------------------------------------------------ managing people (used by people + SCIM routes)

export interface UserPatch {
  name?: string;
  email?: string;
  roles?: Role[];
  managerId?: string | null;
  active?: boolean;
  externalId?: string;
}

/** Create or change people in one organisation, checking emails and the hierarchy. */
export async function updateUsers(orgId: string, fn: (users: StoredUser[], helpers: { make: (u: Omit<User, "id" | "orgId" | "createdAt" | "updatedAt">, password: string | null) => Promise<StoredUser> }) => Promise<void> | void) {
  return serial(async () => {
    const all = await readUsers();
    const inOrg = all.filter((u) => u.orgId === orgId);
    const others = all.filter((u) => u.orgId !== orgId);
    const make = async (u: Omit<User, "id" | "orgId" | "createdAt" | "updatedAt">, password: string | null) => {
      const now = new Date().toISOString();
      return StoredUser.parse({ ...u, id: newId("user"), orgId, createdAt: now, updatedAt: now, passwordHash: password ? await hashPassword(password) : null });
    };
    await fn(inOrg, { make });
    // Emails are unique across all organisations (they're how people sign in).
    const emails = new Set<string>();
    for (const u of [...others, ...inOrg]) {
      if (emails.has(u.email)) throw new HttpError(409, `${u.email} is already used by another account.`);
      emails.add(u.email);
    }
    for (const u of inOrg) StoredUser.parse(u);
    if (!inOrg.some((u) => u.active && u.roles.includes("admin"))) throw new HttpError(400, "There must always be at least one active Admin-Builder.");
    await writeList(USERS_FILE, [...others, ...inOrg]);
    // Deactivated people are signed out everywhere.
    const inactive = new Set(inOrg.filter((u) => !u.active).map((u) => u.id));
    if (inactive.size) await writeList(SESSIONS_FILE, (await readList(SESSIONS_FILE, Session)).filter((s) => !inactive.has(s.userId)));
  });
}

export async function setUserPassword(orgId: string, userId: string, password: string) {
  await updateUsers(orgId, async (users) => {
    const u = users.find((x) => x.id === userId);
    if (!u) throw new HttpError(404, "Person not found");
    u.passwordHash = await hashPassword(password);
    u.updatedAt = new Date().toISOString();
  });
  await endSessions((s) => s.userId === userId);
}

// ------------------------------------------------------------------ SCIM token

export async function issueScimToken(orgId: string): Promise<string> {
  const token = `scim_${randomBytes(32).toString("hex")}`;
  await serial(async () => {
    const orgs = await readOrgs();
    const org = orgs.find((o) => o.id === orgId);
    if (!org) throw new HttpError(404, "Organisation not found");
    org.scimTokenHash = sha256(token);
    await writeList(ORGS_FILE, orgs);
  });
  return token;
}

export async function revokeScimToken(orgId: string) {
  await serial(async () => {
    const orgs = await readOrgs();
    const org = orgs.find((o) => o.id === orgId);
    if (org) org.scimTokenHash = null;
    await writeList(ORGS_FILE, orgs);
  });
}

/** Which organisation a SCIM bearer token belongs to (constant-time compare). */
export async function orgForScimToken(token: string): Promise<string | null> {
  const h = Buffer.from(sha256(token), "hex");
  for (const org of await readOrgs()) {
    if (!org.scimTokenHash) continue;
    const stored = Buffer.from(org.scimTokenHash, "hex");
    if (stored.length === h.length && timingSafeEqual(stored, h)) return org.id;
  }
  return null;
}
