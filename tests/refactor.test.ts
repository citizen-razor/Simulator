import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { createSession, interact, lintSimulation, type Mode, type SessionState } from "../shared/engine";
import { snapRect } from "../shared/layout";
import { duplicateElement, duplicateScreen, moveScreen, renameElement, renameScreen, renameVariable } from "../shared/refactor";
import { SimulationSchema, type Simulation } from "../shared/schema";

const fresh = (): Simulation => SimulationSchema.parse(structuredClone(sample));

/** Play the "resolve printer" scenario perfectly using the given element ids. */
function playResolve(sim: Simulation, ids: Record<string, string> = {}): SessionState {
  const id = (x: string) => ids[x] ?? x;
  let s = createSession(sim, "resolve-printer");
  const mode: Mode = "scenario";
  const evs: Array<[string, string?]> = [
    ["login-user", "sam"], ["login-pass", "pw"], ["login-submit"], ["dash-t1042"],
    ["tk-status", "Resolved"], ["tk-notes", "done"], ["tk-save"],
  ];
  for (const [e, v] of evs) {
    s = interact(sim, s, mode, v === undefined ? { type: "activate", elementId: id(e) } : { type: "commit", elementId: id(e), value: v }).state;
  }
  return s;
}

describe("renames keep the simulation working", () => {
  it("element rename updates steps and keeps the field's variable", () => {
    const sim = fresh();
    renameElement(sim, "login-user", "username-field");
    renameElement(sim, "tk-save", "save-ticket");
    expect(lintSimulation(sim)).toEqual([]);
    const s = playResolve(sim, { "login-user": "username-field", "tk-save": "save-ticket" });
    expect(s.completed).toBe(true);
    expect(s.vars.username).toBe("sam");
  });

  it("screen rename updates navigation and start screens", () => {
    const sim = fresh();
    renameScreen(sim, "dashboard", "home");
    renameScreen(sim, "login", "sign-in");
    expect(sim.startScreenId).toBe("sign-in");
    expect(sim.scenarios[1].startScreenId).toBe("home");
    expect(lintSimulation(sim)).toEqual([]);
    expect(playResolve(sim).completed).toBe(true);
  });

  it("variable rename updates bindings, conditions, actions and {{templates}}", () => {
    const sim = fresh();
    renameVariable(sim, "username", "agentName");
    renameVariable(sim, "t1042_status", "printerStatus");
    const json = JSON.stringify(sim);
    expect(json).not.toMatch(/"username"|\{\{username\}\}|t1042_status/);
    expect(json).toContain("Welcome, {{agentName}}");
    expect(lintSimulation(sim)).toEqual([]);
    const s = playResolve(sim);
    expect(s.completed).toBe(true);
    expect(s.vars.printerStatus).toBe("Resolved");
  });

  it("rejects bad or duplicate names", () => {
    const sim = fresh();
    expect(() => renameElement(sim, "login-user", "login-pass")).toThrow(/already used/);
    expect(() => renameScreen(sim, "login", "has space")).toThrow(/letters/);
    expect(() => renameVariable(sim, "username", "password")).toThrow(/already exists/);
  });
});

describe("duplicate and reorder", () => {
  it("duplicated field gets its own variable", () => {
    const sim = fresh();
    const login = sim.screens[0];
    const newId = duplicateElement(sim, login.elements.find((e) => e.id === "login-user")!, "login");
    const copy = login.elements.find((e) => e.id === newId)!;
    expect(newId).toBe("login-user-copy");
    expect(copy.bindVar).toBe(newId);
    expect(sim.variables.some((v) => v.name === newId)).toBe(true);
    expect(copy.rect.x).toBe(37);
  });

  it("duplicated screen has unique ids, sits after the original, and lints clean", () => {
    const sim = fresh();
    const id = duplicateScreen(sim, "ticket");
    expect(sim.screens.map((s) => s.id)).toEqual(["login", "dashboard", "ticket", id, "new-ticket"]);
    const copy = sim.screens.find((s) => s.id === id)!;
    expect(copy.elements).toHaveLength(sim.screens[2].elements.length);
    expect(copy.elements.every((e) => e.id.endsWith("-copy"))).toBe(true);
    expect(lintSimulation(sim)).toEqual([]);
  });

  it("moves screens", () => {
    const sim = fresh();
    moveScreen(sim, "ticket", -1);
    moveScreen(sim, "login", -1); // already first: no-op
    expect(sim.screens.map((s) => s.id)).toEqual(["login", "ticket", "dashboard", "new-ticket"]);
  });
});

describe("snapping", () => {
  const other = { x: 10, y: 10, w: 20, h: 10 };
  it("snaps a moving box's nearest edge to another box and draws a guide", () => {
    const r = snapRect({ x: 10.5, y: 40, w: 15, h: 5 }, [other], "move");
    expect(r.rect.x).toBe(10);
    expect(r.guides.x).toEqual([10]);
    expect(r.guides.y).toEqual([]);
  });
  it("snaps resize to the other box's right edge", () => {
    const r = snapRect({ x: 5, y: 40, w: 24.6, h: 5 }, [other], "resize");
    expect(r.rect.w).toBe(25);
    expect(r.guides.x).toEqual([30]);
  });
  it("leaves distant boxes alone", () => {
    const r = snapRect({ x: 60, y: 70, w: 15, h: 5 }, [other], "move");
    expect(r.rect).toEqual({ x: 60, y: 70, w: 15, h: 5 });
  });
});

describe("duplicated screens share named state", () => {
  it("keeps named bindings on a screen copy", () => {
    const sim = fresh();
    const id = duplicateScreen(sim, "login");
    const copyUser = sim.screens.find((s) => s.id === id)!.elements.find((e) => e.label === "Username")!;
    expect(copyUser.bindVar).toBe("username");
  });
});
