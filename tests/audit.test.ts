import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { createSession, interact, switchMode, takeHint, type SessionState } from "../shared/engine";
import { SimulationSchema, type Simulation } from "../shared/schema";

const load = (): Simulation => SimulationSchema.parse(structuredClone(sample));
const T0 = 1_000_000;
function run(sim: Simulation, s: SessionState, events: Array<[string, string?]>, mode: "scenario" | "guided" = "scenario", at = T0 + 5_000) {
  for (const [elementId, value] of events) s = interact(sim, s, mode, value === undefined ? { type: "activate", elementId } : { type: "commit", elementId, value }, at).state;
  return s;
}

describe("audit trail", () => {
  it("records every action with how it was scored, hiding passwords", () => {
    const sim = load();
    let s = run(sim, createSession(sim, "resolve-printer", T0), [["login-user", "sam"], ["login-pass", "hunter2"], ["login-submit"], ["dash-new"]]);
    s = takeHint(sim, s, T0 + 7_000).state;
    s = run(sim, s, [["nt-back"], ["dash-t1042"], ["tk-notes", "notes first"], ["tk-status", "Open"]]);
    expect(s.log.map((e) => [e.outcome, e.target, e.value ?? null, e.stepNo ?? null])).toEqual([
      ["step", expect.stringContaining("Username"), "sam", 1],
      ["step", expect.stringContaining("Password"), "•••", 2],
      ["step", expect.stringContaining("Sign in"), null, 3],
      ["error", expect.stringContaining("New ticket"), null, 4], // expected step 4
      ["hint", "", null, 4],
      ["error", expect.anything(), null, 4],
      ["step", expect.stringMatching(/^"TCK-\d+ · Printer offline/), null, 4], // labels shown as the trainee saw them
      ["step", expect.stringContaining("Resolution notes"), "notes first", 5], // this path takes notes in either order
      ["wrong-value", expect.stringContaining("Status"), "Open", 6],
    ]);
    expect(s.log[0]).toMatchObject({ at: 5, screen: expect.any(String) });
    expect(s.log[3].step).toMatch(/^Open ticket TCK-\d+ from your queue\.$/); // with this run's values
    expect(s.errors).toBe(s.log.filter((e) => e.outcome === "error" || e.outcome === "wrong-value").length);
  });

  it("records guided blocks and the switch to guided help", () => {
    const sim = load();
    let s = createSession(sim, "resolve-printer", T0);
    s = switchMode(s, "guided", T0 + 1000);
    s = run(sim, s, [["login-submit"]], "guided");
    expect(s.log.map((e) => e.outcome)).toEqual(["guided", "error"]);
    expect(s.assisted).toBe(true);
  });
});

describe("audit trail: fields that aren't the next step", () => {
  it("logs a later field as ignored, with no penalty", () => {
    const sim = load();
    const s = run(sim, createSession(sim, "resolve-printer", T0), [["login-pass", "x"]]);
    expect(s.log.map((e) => [e.outcome, e.stepNo])).toEqual([["ignored", 1]]);
    expect(s.errors).toBe(0);
  });
});
