import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { breakdown } from "../shared/breakdown";
import { createSession, interact, takeHint, type SessionState } from "../shared/engine";
import { gradeSession } from "../shared/grading";
import { GradingSchemeSchema, STANDARD_SCHEME, type GradingScheme } from "../shared/library";
import { SimulationSchema, type Attempt, type Simulation } from "../shared/schema";

const load = (): Simulation => SimulationSchema.parse(structuredClone(sample));
const T0 = 1_000_000;
const play = (sim: Simulation, s: SessionState, events: Array<[string, string?]>) => {
  for (const [elementId, value] of events) s = interact(sim, s, "scenario", value === undefined ? { type: "activate", elementId } : { type: "commit", elementId, value }, T0 + 60_000).state;
  return s;
};
const toAttempt = (sim: Simulation, s: SessionState, scheme: GradingScheme): Attempt => {
  const g = gradeSession(sim, s, scheme, T0 + 60_000);
  const { score, passed, pendingManual: _p, ...grading } = g;
  return {
    id: "a1", trainee: "", simulationId: sim.id, simulationTitle: "", scenarioId: "resolve-printer", scenarioTitle: "", mode: "scenario",
    assisted: false, completed: s.completed, score, errors: s.errors, hintsUsed: s.hintsUsed, durationSec: 60, stepsCompleted: s.stepIndex,
    stepsTotal: 7, pathName: "Main path", passed, mistakes: [], troubleSteps: s.troubleSteps, penalties: s.penalties, grading, finishedAt: "",
  };
};
const titles = (sim: Simulation) => sim.scenarios.find((x) => x.id === "resolve-printer")!.steps.map((x) => x.instruction);
const sum = (b: ReturnType<typeof breakdown>) => [...b.steps, ...b.adjustments, ...b.rubric].reduce((n, l) => n + l.gained - l.lost, 0);

describe("points breakdown", () => {
  it("puts each error and hint on the step where it happened, adding up to the score", () => {
    const sim = load();
    let s = play(sim, createSession(sim, "resolve-printer", T0), [["login-user", "sam"], ["login-pass", "pw"], ["login-submit"], ["dash-new"], ["nt-back"]]);
    s = takeHint(sim, s).state;
    s = play(sim, s, [["dash-t1042"], ["tk-status", "Resolved"], ["tk-notes", "done"], ["tk-save"]]);
    const a = toAttempt(sim, s, STANDARD_SCHEME);
    expect(a.score).toBe(75); // 100 − 2×10 − 5
    const b = breakdown(a, titles(sim));
    expect(b.stepsRecorded).toBe(true);
    expect(b.pointsShare).toBe(100);
    const step4 = b.steps[3];
    expect(step4).toMatchObject({ stepNo: 4, errors: 2, hints: 1, lost: 25, done: true });
    expect(step4.label).toBe(titles(sim)[3]);
    expect(b.steps.filter((l) => l.lost > 0)).toHaveLength(1);
    expect(Math.round(sum(b))).toBe(a.score);
  });

  it("weights the points part and shows rubric criteria, including ones awaiting marking", () => {
    const sim = load();
    sim.grading.trainerMarking = true;
    const scheme = GradingSchemeSchema.parse({
      id: "r", name: "R", points: { errorPenalty: 20, hintPenalty: 0, timeLimitSec: null, overtimePenaltyPerMin: 0, passScore: 70, masteryScore: 90 },
      rubricWeight: 40,
      rubric: [
        { id: "done", label: "Completed", weight: 2, check: { type: "completed" } },
        { id: "clean", label: "No mistakes", weight: 2, check: { type: "maxErrors", n: 0 } },
        { id: "tone", label: "Tone", weight: 1, check: { type: "manual" } },
      ],
    });
    const s = play(sim, createSession(sim, "resolve-printer", T0), [["login-user", "sam"], ["login-pass", "pw"], ["login-submit"], ["dash-new"], ["nt-back"], ["dash-t1042"], ["tk-status", "Resolved"], ["tk-notes", "done"], ["tk-save"]]);
    const a = toAttempt(sim, s, scheme);
    const b = breakdown(a, titles(sim));
    expect([b.pointsShare, b.rubricShare]).toEqual([60, 40]);
    expect(b.steps[3]).toMatchObject({ errors: 2, lost: 24 }); // 2 × 20 × 0.6
    expect(b.rubric.map((l) => [l.label, l.gained, l.missed, l.met])).toEqual([["Completed", 20, 0, true], ["No mistakes", 0, 20, false], ["Tone", 0, 0, null]]);
    expect(b.rubric[2].worth).toBe(8); // 40 × 1/5 once marked
    expect(Math.round(sum(b))).toBe(a.score);
  });

  it("shows unfinished steps as not earned, and the floor of 0", () => {
    const a = { score: 0, completed: false, errors: 6, hintsUsed: 0, stepsCompleted: 2, stepsTotal: 4, grading: undefined, penalties: Array.from({ length: 6 }, () => ({ kind: "error" as const, stepNo: 3, step: "x" })) };
    const b = breakdown(a);
    expect(b.steps.map((l) => [l.done, l.gained, l.missed])).toEqual([[true, 25, 0], [true, 25, 0], [false, 0, 25], [false, 0, 25]]);
    expect(b.adjustments).toEqual([expect.objectContaining({ kind: "floor", gained: 10 })]);
    expect(Math.round(sum(b))).toBe(0);
  });

  it("handles older attempts that didn't record steps", () => {
    const b = breakdown({ score: 85, completed: true, errors: 1, hintsUsed: 1, stepsCompleted: 3, stepsTotal: 3, grading: undefined, penalties: [] });
    expect(b.stepsRecorded).toBe(false);
    expect(b.adjustments[0]).toMatchObject({ kind: "unrecorded", lost: 15 });
    expect(Math.round(sum(b))).toBe(85);
  });
});
