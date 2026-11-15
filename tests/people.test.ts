import { describe, expect, it } from "vitest";
import { canAssign, canView, can, createsCycle, effectiveRoles, parsePeopleCsv, reportingTree, type User } from "../shared/people";

const u = (id: string, managerId: string | null, roles: User["roles"] = ["learner"], active = true): User => ({
  id, orgId: "default", email: `${id}@example.com`, name: id, roles, managerId, active, createdAt: "", updatedAt: "",
});

//        ceo
//       /    \
//    ana      ben (inactive)
//    /  \        \
//  cai  dee      eve
const people = [u("ceo", null), u("ana", "ceo"), u("ben", "ceo", ["learner"], false), u("cai", "ana"), u("dee", "ana"), u("eve", "ben"), u("adm", null, ["admin"]), u("bld", null, ["builder"])];

describe("hierarchy", () => {
  it("finds everyone under a leader, at any depth, skipping inactive people's branches", () => {
    expect([...reportingTree(people, "ceo")].sort()).toEqual(["ana", "cai", "dee"]);
    expect([...reportingTree(people, "ana")].sort()).toEqual(["cai", "dee"]);
    expect(reportingTree(people, "cai").size).toBe(0);
  });

  it("survives manager loops", () => {
    const loop = [u("a", "b"), u("b", "a")];
    expect([...reportingTree(loop, "a")]).toEqual(["b"]);
  });

  it("refuses changes that would create a loop", () => {
    expect(createsCycle(people, "ana", "cai")).toBe(true); // cai reports to ana
    expect(createsCycle(people, "ana", "ana")).toBe(true);
    expect(createsCycle(people, "cai", "dee")).toBe(false);
  });
});

describe("roles and permissions", () => {
  it("stacks roles: everyone learns, admins build, managers lead", () => {
    expect([...effectiveRoles(people.find((p) => p.id === "adm")!, people)].sort()).toEqual(["admin", "builder", "learner"]);
    expect(effectiveRoles(people.find((p) => p.id === "ana")!, people).has("leader")).toBe(true);
    expect(effectiveRoles(people.find((p) => p.id === "cai")!, people).has("leader")).toBe(false);
    // ben's only report is under an inactive manager, but ben himself is inactive; eve doesn't make "eve" a leader
    expect(effectiveRoles(people.find((p) => p.id === "eve")!, people).has("leader")).toBe(false);
  });

  it("builders build but can't touch the Admin-Builder's things", () => {
    const bld = people.find((p) => p.id === "bld")!;
    expect(can(bld, people, "simulations.build")).toBe(true);
    for (const a of ["libraries.edit", "people.manage", "storage.manage", "attempts.mark", "assignments.viewAll"] as const) expect(can(bld, people, a)).toBe(false);
    const adm = people.find((p) => p.id === "adm")!;
    expect(can(adm, people, "libraries.edit")).toBe(true);
    const learner = people.find((p) => p.id === "cai")!;
    expect(can(learner, people, "simulations.build")).toBe(false);
  });

  it("learners see themselves; leaders see their tree; admins see everyone", () => {
    const [ceo, ana, , cai] = people;
    expect(canView(cai, people, "cai")).toBe(true);
    expect(canView(cai, people, "dee")).toBe(false);
    expect(canView(ana, people, "dee")).toBe(true);
    expect(canView(ana, people, "ceo")).toBe(false); // not upwards
    expect(canView(ceo, people, "dee")).toBe(true); // any depth
    expect(canView(people.find((p) => p.id === "adm")!, people, "eve")).toBe(true);
    expect(canAssign(ana, people, "cai")).toBe(true);
    expect(canAssign(ana, people, "ana")).toBe(false);
    expect(canAssign(cai, people, "dee")).toBe(false);
  });
});

describe("people CSV", () => {
  it("reads columns in any order, quoted fields, and roles", () => {
    const { rows, errors } = parsePeopleCsv(
      'Name,Email,Manager Email,Roles\n"Okafor, Emeka",EMEKA@example.com,ana@example.com,leader;builder\nCai Lin,cai@example.com,,\nNo Email,,x@example.com,\nBad,bad@example.com,,wizard\n',
    );
    expect(rows.map((r) => [r.name, r.email, r.managerEmail, r.roles.join("+")])).toEqual([
      ["Okafor, Emeka", "emeka@example.com", "ana@example.com", "leader+builder"],
      ["Cai Lin", "cai@example.com", "", "learner"],
      ["Bad", "bad@example.com", "", "learner"],
    ]);
    expect(errors).toEqual(["Line 4: missing or invalid email.", 'Line 5: unknown role "wizard" (use admin-builder, builder, leader or learner).']);
  });

  it("needs a header with email and name", () => {
    expect(parsePeopleCsv("a@b.com,Ann").errors[0]).toMatch(/first row/);
  });
});
