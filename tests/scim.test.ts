import { describe, expect, it } from "vitest";
import { combineName, fieldsFromPatch, fieldsFromResource, parseFilter, SCHEMA_ENTERPRISE, toScim } from "../server/scim";
import type { User } from "../shared/people";

const user: User = { id: "user-1", orgId: "default", email: "ana@example.com", name: "Ana Silva", roles: ["learner"], managerId: "user-9", active: true, externalId: "00u1", createdAt: "c", updatedAt: "u" };

describe("SCIM mapping", () => {
  it("renders a SCIM User with the enterprise manager", () => {
    const r = toScim(user, "https://h/scim/v2");
    expect(r).toMatchObject({ id: "user-1", userName: "ana@example.com", displayName: "Ana Silva", active: true, externalId: "00u1" });
    expect(r.name).toMatchObject({ givenName: "Ana", familyName: "Silva" });
    expect(r[SCHEMA_ENTERPRISE]).toEqual({ manager: { value: "user-9", $ref: "https://h/scim/v2/Users/user-9" } });
  });

  it("reads Okta-style create bodies", () => {
    expect(
      fieldsFromResource({
        userName: "Cai@Example.com",
        name: { givenName: "Cai", familyName: "Lin" },
        emails: [{ value: "cai@example.com", primary: true }],
        active: true,
        externalId: "00u2",
        [SCHEMA_ENTERPRISE]: { manager: { value: "user-1" } },
      }),
    ).toEqual({ email: "cai@example.com", name: "Cai Lin", active: true, externalId: "00u2", manager: "user-1" });
  });

  it("reads PATCH with paths (Okta) and without paths (Entra)", () => {
    expect(fieldsFromPatch({ Operations: [{ op: "replace", path: "active", value: false }] })).toEqual({ active: false });
    expect(fieldsFromPatch({ Operations: [{ op: "replace", path: `${SCHEMA_ENTERPRISE}:manager`, value: "user-7" }] })).toEqual({ manager: "user-7" });
    expect(fieldsFromPatch({ Operations: [{ op: "remove", path: `${SCHEMA_ENTERPRISE}:manager` }] })).toEqual({ manager: null });
    expect(
      fieldsFromPatch({
        Operations: [{ op: "Replace", value: { active: "False", displayName: "Ana S.", [SCHEMA_ENTERPRISE]: { manager: { value: "user-3" } } } }],
      }),
    ).toEqual({ active: false, name: "Ana S.", manager: "user-3" });
    expect(() => fieldsFromPatch({ Operations: [{ op: "move", path: "active" }] })).toThrow(/Unsupported PATCH op/);
  });

  it("combines separately-sent name parts with the current name", () => {
    const f = fieldsFromPatch({ Operations: [{ op: "replace", path: "name.familyName", value: "Okafor" }] });
    expect(combineName("Ana Silva", f)).toBe("Ana Okafor");
    expect(combineName("Ana Silva", { givenName: "Anna" })).toBe("Anna Silva");
    expect(combineName("Ana Silva", { name: "Someone Else", givenName: "x" })).toBe("Someone Else");
  });

  it("supports the lookups IdPs make before creating, and rejects others", () => {
    expect(parseFilter('userName eq "ANA@example.com"')!(user)).toBe(true);
    expect(parseFilter('externalId eq "00u1"')!(user)).toBe(true);
    expect(parseFilter(undefined)).toBeNull();
    expect(() => parseFilter('name.givenName sw "A"')).toThrow(/Unsupported filter/);
  });
});
