/**
 * People, roles and the reporting hierarchy.
 *
 * Roles stack; one person can hold several:
 *   admin    Admin-Builder: everything, including the libraries (tags, grading and rubrics,
 *            personas and templates), assignments, trainer marking, storage, managing people
 *   builder  builds simulations and scenarios
 *   leader   sees everyone in their reporting tree, assigns them training, team leaderboard
 *   learner  takes simulations, gets assignments, sees own results and the leaderboard
 * Everyone can learn. An admin is also a builder. Anyone with active people reporting to
 * them is a leader automatically (identity systems send managers, not "leader" flags); the
 * role can also be given by hand.
 *
 * The hierarchy comes from each person's manager (managerId), whether typed in, imported
 * from CSV, or synced by SCIM.
 */
import { z } from "zod";
import { ID_PATTERN } from "./schema";

export const Roles = ["admin", "builder", "leader", "learner"] as const;
export type Role = (typeof Roles)[number];

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin-Builder",
  builder: "Builder",
  leader: "Leader",
  learner: "Learner",
};

export const UserSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  orgId: z.string().regex(ID_PATTERN),
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().min(1).max(100),
  roles: z.array(z.enum(Roles)).default(["learner"]),
  managerId: z.string().nullable().default(null),
  active: z.boolean().default(true),
  /** The identity provider's id for this person (SCIM externalId). */
  externalId: z.string().max(200).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;
/** What the browser may see about a user. */
export type PublicUser = User;

/** Everyone under a person, at any depth (not including them). Safe against manager loops. */
export function reportingTree(users: Pick<User, "id" | "managerId" | "active">[], leaderId: string): Set<string> {
  const byManager = new Map<string, string[]>();
  for (const u of users) {
    if (!u.active || !u.managerId) continue;
    byManager.set(u.managerId, [...(byManager.get(u.managerId) ?? []), u.id]);
  }
  const out = new Set<string>();
  const queue = [...(byManager.get(leaderId) ?? [])];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === leaderId || out.has(id)) continue;
    out.add(id);
    queue.push(...(byManager.get(id) ?? []));
  }
  return out;
}

/** The roles a person effectively has. */
export function effectiveRoles(user: Pick<User, "id" | "roles">, users: Pick<User, "id" | "managerId" | "active">[]): Set<Role> {
  const roles = new Set<Role>(user.roles);
  roles.add("learner");
  if (roles.has("admin")) roles.add("builder");
  if (users.some((u) => u.active && u.managerId === user.id)) roles.add("leader");
  return roles;
}

/** Would making `managerId` the manager of `userId` create a loop? */
export function createsCycle(users: Pick<User, "id" | "managerId">[], userId: string, managerId: string | null): boolean {
  if (!managerId) return false;
  if (managerId === userId) return true;
  const managerOf = new Map(users.map((u) => [u.id, u.managerId]));
  const seen = new Set<string>();
  for (let cur: string | null | undefined = managerId; cur; cur = managerOf.get(cur)) {
    if (cur === userId) return true;
    if (seen.has(cur)) return false; // an existing loop elsewhere; not ours
    seen.add(cur);
  }
  return false;
}

export type Action =
  | "libraries.edit" // tags, grading/rubrics, personas, persona templates
  | "people.manage"
  | "storage.manage"
  | "attempts.mark" // trainer marking
  | "simulations.build" // create, edit, delete, generate, import/export
  | "assignments.viewAll";

/** May this person do something that isn't about one particular other person? */
export function can(user: Pick<User, "id" | "roles">, users: Pick<User, "id" | "managerId" | "active">[], action: Action): boolean {
  const roles = effectiveRoles(user, users);
  if (action === "simulations.build") return roles.has("builder");
  return roles.has("admin");
}

/** May the viewer see this person's results, progress and assignments? */
export function canView(viewer: Pick<User, "id" | "roles">, users: Pick<User, "id" | "managerId" | "active">[], targetId: string): boolean {
  if (viewer.id === targetId) return true;
  const roles = effectiveRoles(viewer, users);
  if (roles.has("admin")) return true;
  return roles.has("leader") && reportingTree(users, viewer.id).has(targetId);
}

/** May the viewer assign training to this person? Admin-Builders: anyone; leaders: their tree. */
export function canAssign(viewer: Pick<User, "id" | "roles">, users: Pick<User, "id" | "managerId" | "active">[], targetId: string): boolean {
  const roles = effectiveRoles(viewer, users);
  if (roles.has("admin")) return true;
  return roles.has("leader") && reportingTree(users, viewer.id).has(targetId);
}

// ------------------------------------------------------------------ CSV import

export interface CsvPerson {
  line: number;
  email: string;
  name: string;
  managerEmail: string;
  roles: Role[];
}

/**
 * Read a people CSV. Columns (header row required, any order, case-insensitive):
 *   email, name, manager_email (or manager), roles (e.g. "builder;leader")
 * Quoted fields with commas are supported.
 */
export function parsePeopleCsv(text: string): { rows: CsvPerson[]; errors: string[] } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const errors: string[] = [];
  if (!lines.length) return { rows: [], errors: ["The file is empty."] };
  const split = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") (out.push(cur), (cur = ""));
      else cur += c;
    }
    out.push(cur);
    return out.map((x) => x.trim());
  };
  const header = split(lines[0]).map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iEmail = col("email", "emailaddress");
  const iName = col("name", "fullname", "displayname");
  const iManager = col("manageremail", "manager");
  const iRoles = col("roles", "role");
  if (iEmail === -1 || iName === -1) return { rows: [], errors: ["The first row must name the columns, including email and name."] };
  const rows: CsvPerson[] = [];
  lines.slice(1).forEach((line, k) => {
    const cells = split(line);
    const email = (cells[iEmail] ?? "").toLowerCase();
    const name = cells[iName] ?? "";
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return errors.push(`Line ${k + 2}: missing or invalid email.`);
    if (!name) return errors.push(`Line ${k + 2}: missing name.`);
    const rawRoles = iRoles === -1 ? "" : cells[iRoles] ?? "";
    const roles: Role[] = [];
    for (const r of rawRoles.split(/[;|/ ]+/).map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      const role = r === "admin-builder" || r === "adminbuilder" ? "admin" : r;
      if ((Roles as readonly string[]).includes(role)) roles.push(role as Role);
      else errors.push(`Line ${k + 2}: unknown role "${r}" (use admin-builder, builder, leader or learner).`);
    }
    rows.push({ line: k + 2, email, name, managerEmail: iManager === -1 ? "" : (cells[iManager] ?? "").toLowerCase(), roles: roles.length ? roles : ["learner"] });
  });
  return { rows, errors };
}
