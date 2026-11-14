/**
 * People routes.
 *   GET    /api/people/directory     everyone signed in: names, managers, roles (no emails)
 *   GET    /api/people               Admin-Builders: everything, including emails
 *   POST   /api/people               Admin-Builders: add someone (returns a one-time password)
 *   PATCH  /api/people/:id           Admin-Builders: name, email, roles, manager, active
 *   POST   /api/people/:id/password  Admin-Builders: reset to a one-time password
 *   POST   /api/people/import        Admin-Builders: CSV of email, name, manager_email, roles
 *   GET/POST/DELETE /api/people/scim  Admin-Builders: SCIM token status / issue / revoke
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { createsCycle, parsePeopleCsv, Roles, type Role } from "../shared/people";
import {
  issueScimToken,
  orgUsers,
  readOrgs,
  requirePermission,
  requireUser,
  revokeScimToken,
  setUserPassword,
  temporaryPassword,
  updateUsers,
} from "./auth";
import { HttpError } from "./storage";

type Handler = (req: Request, res: Response) => Promise<unknown>;
const route = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const PersonInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  roles: z.array(z.enum(Roles)).default(["learner"]),
  managerId: z.string().nullable().default(null),
});

export function peopleRoutes(app: Express) {
  app.get(
    "/api/people/directory",
    route(async (req, res) => {
      const r = requireUser(req);
      res.json(r.people.map((u) => ({ id: u.id, name: u.name, managerId: u.managerId, active: u.active, roles: u.roles })));
    }),
  );

  app.get(
    "/api/people",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      res.json(await orgUsers(r.user.orgId));
    }),
  );

  app.post(
    "/api/people",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      const input = PersonInput.parse(req.body);
      const password = temporaryPassword();
      let id = "";
      await updateUsers(r.user.orgId, async (users, { make }) => {
        if (input.managerId && !users.some((u) => u.id === input.managerId)) throw new HttpError(400, "That manager isn't in this organisation.");
        const u = await make({ ...input, active: true }, password);
        users.push(u);
        id = u.id;
      });
      res.status(201).json({ id, temporaryPassword: password });
    }),
  );

  app.patch(
    "/api/people/:id",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      const id = String(req.params.id);
      const patch = PersonInput.partial().extend({ active: z.boolean().optional() }).parse(req.body);
      await updateUsers(r.user.orgId, (users) => {
        const u = users.find((x) => x.id === id);
        if (!u) throw new HttpError(404, "Person not found");
        if (patch.managerId !== undefined) {
          if (patch.managerId && !users.some((x) => x.id === patch.managerId)) throw new HttpError(400, "That manager isn't in this organisation.");
          if (createsCycle(users, id, patch.managerId)) throw new HttpError(400, "That would make someone their own manager (a loop in the reporting line).");
        }
        Object.assign(u, patch, { updatedAt: new Date().toISOString() });
      });
      res.json({ ok: true });
    }),
  );

  app.post(
    "/api/people/:id/password",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      const password = temporaryPassword();
      await setUserPassword(r.user.orgId, String(req.params.id), password);
      res.json({ temporaryPassword: password });
    }),
  );

  app.post(
    "/api/people/import",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      const { rows, errors } = parsePeopleCsv(String(req.body?.csv ?? ""));
      const created: { email: string; name: string; temporaryPassword: string }[] = [];
      let updated = 0;
      await updateUsers(r.user.orgId, async (users, { make }) => {
        // Pass 1: create or update everyone, so managers can appear anywhere in the file.
        for (const row of rows) {
          const existing = users.find((u) => u.email === row.email);
          if (existing) {
            existing.name = row.name;
            // Never remove someone's Admin-Builder role through an import.
            existing.roles = [...new Set<Role>([...row.roles, ...existing.roles.filter((x) => x === "admin")])];
            existing.active = true;
            existing.updatedAt = new Date().toISOString();
            updated++;
          } else {
            const password = temporaryPassword();
            users.push(await make({ name: row.name, email: row.email, roles: row.roles, managerId: null, active: true }, password));
            created.push({ email: row.email, name: row.name, temporaryPassword: password });
          }
        }
        // Pass 2: managers, by email.
        for (const row of rows) {
          if (!row.managerEmail) continue;
          const u = users.find((x) => x.email === row.email)!;
          const m = users.find((x) => x.email === row.managerEmail);
          if (!m) errors.push(`Line ${row.line}: manager ${row.managerEmail} isn't in the file or the organisation.`);
          else if (createsCycle(users, u.id, m.id)) errors.push(`Line ${row.line}: ${row.managerEmail} as manager would create a loop; skipped.`);
          else u.managerId = m.id;
        }
      });
      res.json({ created, updated, errors });
    }),
  );

  app.get(
    "/api/people/scim",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      const org = (await readOrgs()).find((o) => o.id === r.user.orgId);
      res.json({ enabled: !!org?.scimTokenHash, path: "/scim/v2" });
    }),
  );
  app.post(
    "/api/people/scim",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      res.json({ token: await issueScimToken(r.user.orgId), path: "/scim/v2" });
    }),
  );
  app.delete(
    "/api/people/scim",
    route(async (req, res) => {
      const r = requirePermission(req, "people.manage");
      await revokeScimToken(r.user.orgId);
      res.status(204).end();
    }),
  );
}
