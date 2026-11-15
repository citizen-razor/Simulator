import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { createSession, currentStep, interact, lintSimulation, scoreSession, type Mode, type SessionState } from "../shared/engine";
import { SimulationSchema, type Simulation } from "../shared/schema";

const load = (): Simulation => SimulationSchema.parse(structuredClone(sample));

function run(sim: Simulation, state: SessionState, mode: Mode, events: Array<[string, string?]>) {
  for (const [elementId, value] of events) {
    state = interact(sim, state, mode, value === undefined ? { type: "activate", elementId } : { type: "commit", elementId, value }).state;
  }
  return state;
}

const signInAndOpen: Array<[string, string?]> = [["login-user", "sam"], ["login-pass", "pw"], ["login-submit"], ["dash-t1042"]];

describe("multiple valid paths", () => {
  it("sample with an alternative path lints clean", () => {
    expect(lintSimulation(load())).toEqual([]);
  });

  it("main path still completes and is reported as the main path", () => {
    const sim = load();
    const s = run(sim, createSession(sim, "resolve-printer"), "scenario", [...signInAndOpen, ["tk-status", "Resolved"], ["tk-notes", "x"], ["tk-save"]]);
    expect(s.completed).toBe(true);
    expect(scoreSession(sim, s)).toMatchObject({ score: 100, pathName: "Main path", stepsTotal: 7 });
  });

  it("alternative path completes with no errors and becomes the lead", () => {
    const sim = load();
    const s = run(sim, createSession(sim, "resolve-printer"), "scenario", [...signInAndOpen, ["tk-notes", "Power cycled"], ["tk-resolve"]]);
    expect(s.errors).toBe(0);
    expect(s.completed).toBe(true);
    expect(s.leadPath).toBe("quick-resolve");
    expect(scoreSession(sim, s)).toMatchObject({ score: 100, pathName: "Quick resolve", stepsCompleted: 6, stepsTotal: 6 });
  });

  it("shared opening steps advance every path", () => {
    const sim = load();
    const s = run(sim, createSession(sim, "resolve-printer"), "scenario", signInAndOpen);
    expect(s.pathProgress).toEqual({ main: 4, "quick-resolve": 4 });
    expect(s.leadPath).toBe("main");
  });

  it("guided mode coaches the main path but accepts the alternative and follows it", () => {
    const sim = load();
    let s = run(sim, createSession(sim, "resolve-printer"), "guided", signInAndOpen);
    expect(currentStep(sim, s)!.elementId).toBe("tk-status"); // main path's next step
    const r = interact(sim, s, "guided", { type: "commit", elementId: "tk-notes", value: "done" });
    // Notes is a field: the main path's later step is satisfied too, but the quick path's NEXT step matched.
    expect(r.blocked).toBe(false);
    s = r.state;
    expect(s.leadPath).toBe("quick-resolve");
    expect(currentStep(sim, s)!.elementId).toBe("tk-resolve");
    s = run(sim, s, "guided", [["tk-resolve"]]);
    expect(s.completed).toBe(true);
    expect(s.errors).toBe(0);
  });

  it("an action on no path is still an error", () => {
    const sim = load();
    const s = run(sim, createSession(sim, "resolve-printer"), "scenario", [...signInAndOpen, ["tk-back"]]);
    expect(s.errors).toBe(1);
  });
});

describe("also-accept alternatives on a step", () => {
  it("accepts any listed element for the step", () => {
    const sim = load();
    // Let "Sign out" count as an alternative to opening the ticket (contrived, but tests the mechanism).
    sim.scenarios[0].steps[3].alsoElementIds = ["dash-t1043"];
    let s = run(sim, createSession(sim, "resolve-printer"), "scenario", [...signInAndOpen.slice(0, 3), ["dash-t1043"]]);
    expect(s.errors).toBe(0);
    expect(s.pathProgress.main).toBe(4);
    sim.scenarios[0].steps[3].alsoElementIds = ["no-such-element"];
    expect(lintSimulation(sim).join(" ")).toMatch(/missing element "no-such-element"/);
    s = createSession(sim, "resolve-printer"); // silence unused warning in strict configs
    expect(s.leadPath).toBe("main");
  });
});
