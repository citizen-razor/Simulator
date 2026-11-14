import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { SimulationSchema } from "../shared/schema";
import { createSession, interact, lintSimulation, scoreSession, switchMode, takeHint, type Mode, type SessionState } from "../shared/engine";

const sim = SimulationSchema.parse(sample);

function run(state: SessionState, mode: Mode, events: Array<[string, string?]>) {
  for (const [elementId, value] of events) {
    const ev = value === undefined ? { type: "activate" as const, elementId } : { type: "commit" as const, elementId, value };
    state = interact(sim, state, mode, ev).state;
  }
  return state;
}

const perfectResolve: Array<[string, string?]> = [
  ["login-user", "sam"],
  ["login-pass", "pw"],
  ["login-submit"],
  ["dash-t1042"],
  ["tk-status", "Resolved"],
  ["tk-notes", "Power-cycled."],
  ["tk-save"],
];

describe("engine", () => {
  it("sample simulation has no lint issues", () => {
    expect(lintSimulation(sim)).toEqual([]);
  });

  it("open mode just runs rules", () => {
    let s = createSession(sim, null);
    s = run(s, "open", [["login-submit"]]);
    expect(s.screenId).toBe("login"); // blocked by validation rule
    s = run(s, "open", [["login-user", "a"], ["login-pass", "b"], ["login-submit"]]);
    expect(s.screenId).toBe("dashboard");
    expect(s.errors).toBe(0);
  });

  it("scenario mode: perfect run scores 100", () => {
    const s = run(createSession(sim, "resolve-printer"), "scenario", perfectResolve);
    expect(s.completed).toBe(true);
    expect(s.vars.t1042_status).toBe("Resolved");
    expect(scoreSession(sim, s).score).toBe(100);
  });

  it("scenario mode: wrong clicks still apply but count as errors", () => {
    let s = run(createSession(sim, "resolve-printer"), "scenario", perfectResolve.slice(0, 3));
    s = run(s, "scenario", [["dash-new"]]); // wrong
    expect(s.screenId).toBe("new-ticket");
    expect(s.errors).toBe(1);
    s = run(s, "scenario", [["nt-back"], ["dash-t1042"], ["tk-status", "Resolved"], ["tk-notes", "x"], ["tk-save"]]);
    expect(s.completed).toBe(true);
    expect(scoreSession(sim, s).score).toBe(80); // two errors (dash-new, nt-back)
  });

  it("guided mode blocks wrong clicks", () => {
    const s0 = createSession(sim, "resolve-printer");
    const r = interact(sim, s0, "guided", { type: "activate", elementId: "login-submit" });
    expect(r.blocked).toBe(true);
    expect(r.state.screenId).toBe("login");
    expect(r.feedback[0].tone).toBe("error");
  });

  it("fields filled out of order auto-complete their steps", () => {
    const s = run(createSession(sim, "resolve-printer"), "scenario", [
      ["login-pass", "pw"],
      ["login-user", "sam"],
      ["login-submit"],
    ]);
    expect(s.errors).toBe(0);
    expect(s.stepIndex).toBe(3);
  });

  it("switching modes keeps state and marks the run assisted", () => {
    let s = run(createSession(sim, "resolve-printer"), "scenario", perfectResolve.slice(0, 3));
    s = switchMode(s, "guided");
    expect(s.assisted).toBe(true);
    expect(s.screenId).toBe("dashboard");
    s = run(s, "guided", perfectResolve.slice(3));
    expect(s.completed).toBe(true);
  });

  it("hints cost points and point to the right screen", () => {
    let s = createSession(sim, "resolve-printer");
    const h = takeHint(sim, s);
    expect(h.hint).toContain("Any username");
    s = run(h.state, "scenario", perfectResolve);
    expect(scoreSession(sim, s).score).toBe(95);
  });

  it("success criteria gate completion", () => {
    // Choose the wrong priority: steps can't complete, so scenario isn't done.
    const s = run(createSession(sim, "log-vpn"), "scenario", [
      ["dash-new"],
      ["nt-title", "VPN down"],
      ["nt-priority", "Low"],
      ["nt-desc", "sales blocked"],
      ["nt-submit"],
    ]);
    expect(s.completed).toBe(false);
    expect(s.errors).toBeGreaterThan(0);
  });
});
