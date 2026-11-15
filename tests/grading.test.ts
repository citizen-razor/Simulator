import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { createSession, interact, scoreSession, type Mode, type SessionState } from "../shared/engine";
import { evaluateObjectives, finalScore, gradeSession, resolveScheme, settleUnmarked, timeLeft, unboundChecks } from "../shared/grading";
import { GradingSchemeSchema, STANDARD_SCHEME, type GradingScheme } from "../shared/library";
import { SimulationSchema, type Simulation } from "../shared/schema";

const load = (): Simulation => SimulationSchema.parse(structuredClone(sample));
const T0 = 1_000_000;

function run(sim: Simulation, s: SessionState, mode: Mode, events: Array<[string, string?]>, at = T0 + 60_000) {
  for (const [elementId, value] of events) {
    s = interact(sim, s, mode, value === undefined ? { type: "activate", elementId } : { type: "commit", elementId, value }, at).state;
  }
  return s;
}
const perfect: Array<[string, string?]> = [
  ["login-user", "sam"], ["login-pass", "pw"], ["login-submit"], ["dash-t1042"],
  ["tk-status", "Resolved"], ["tk-notes", "done"], ["tk-save"],
];

const rubricScheme: GradingScheme = GradingSchemeSchema.parse({
  id: "support-rubric",
  name: "Support rubric",
  points: { errorPenalty: 20, hintPenalty: 0, timeLimitSec: 120, overtimePenaltyPerMin: 10, passScore: 70, masteryScore: 90 },
  rubricWeight: 50,
  rubric: [
    { id: "done", label: "Completed the task", weight: 2, check: { type: "completed" } },
    { id: "clean", label: "No mistakes", weight: 1, check: { type: "maxErrors", n: 0 } },
    { id: "resolved", label: "Ticket marked resolved", weight: 1, check: { type: "state", conditions: [] } },
    { id: "tone", label: "Professional resolution notes", weight: 1, check: { type: "manual" } },
  ],
  objectives: [
    { id: "explore", label: "Visit at least half the screens", check: { type: "coverage", n: 50 } },
    { id: "newticket", label: "Find the new-ticket form", check: { type: "screen" } },
  ],
});

describe("grading schemes", () => {
  it("Standard reproduces the original scoring", () => {
    const sim = load();
    // Two wrong clicks (−10 each with Standard).
    const s = run(sim, createSession(sim, "resolve-printer", T0), "scenario", [...perfect.slice(0, 3), ["dash-new"], ["nt-back"], ...perfect.slice(3)]);
    const g = gradeSession(sim, s, STANDARD_SCHEME, T0 + 60_000);
    expect(g.score).toBe(scoreSession(sim, s).score);
    expect(g.score).toBe(80);
    expect(g.passed).toBe(true);
    expect(g.rubric).toEqual([]);
  });

  it("applies the scheme's penalties, rubric, bindings and pending manual marks", () => {
    const sim = load();
    sim.grading = { schemeId: "support-rubric", bindings: [{ itemId: "resolved", conditions: [{ var: "t1042_status", op: "eq", value: "Resolved" }] }], trainerMarking: true };
    const s = run(sim, createSession(sim, "resolve-printer", T0), "scenario", [...perfect.slice(0, 3), ["dash-new"], ["nt-back"], ...perfect.slice(3)]);
    const scheme = resolveScheme(sim, "resolve-printer", [rubricScheme]);
    expect(scheme.id).toBe("support-rubric");
    const g = gradeSession(sim, s, scheme, T0 + 60_000);
    expect(g.pointsScore).toBe(60); // 100 − 2 errors × 20
    expect(g.rubric.map((c) => [c.id, c.met])).toEqual([["done", true], ["clean", false], ["resolved", true], ["tone", null]]);
    // Decided rubric: 3 of 4 weight met = 75 %. Final = 60 × 0.5 + 75 × 0.5 = 67.5 → 68
    expect(g.score).toBe(68);
    expect(g.passed).toBeNull(); // waiting for the trainer
    expect(g.pendingManual).toBe(1);
    // Trainer marks the manual criterion as met: rubric 4/5 = 80 % → 60×.5 + 80×.5 = 70 → passes at 70.
    const marked = finalScore({ ...g, rubric: g.rubric.map((c) => (c.id === "tone" ? { ...c, met: true } : c)) }, true);
    expect(marked).toEqual({ score: 70, passed: true, pendingManual: 0 });
  });

  it("skips trainer-marked criteria unless the builder turns trainer marking on, so results are final at once", () => {
    const sim = load();
    sim.grading = { schemeId: "support-rubric", bindings: [{ itemId: "resolved", conditions: [{ var: "t1042_status", op: "eq", value: "Resolved" }] }], trainerMarking: false };
    const s = run(sim, createSession(sim, "resolve-printer", T0), "scenario", [...perfect.slice(0, 3), ["dash-new"], ["nt-back"], ...perfect.slice(3)]);
    const g = gradeSession(sim, s, resolveScheme(sim, "resolve-printer", [rubricScheme]), T0 + 60_000);
    expect(g.rubric.map((c) => c.id)).toEqual(["done", "clean", "resolved"]);
    expect(g.pendingManual).toBe(0);
    expect(g.score).toBe(68); // rubric 3 of 4 weight = 75 % → 60×.5 + 75×.5
    expect(g.passed).toBe(false); // below the pass mark of 70, decided straight away
  });

  it("settles attempts still waiting for a trainer", () => {
    const grading = {
      schemeId: "x", schemeName: "X", passScore: 70, masteryScore: 90, pointsScore: 60, rubricWeight: 50, overtimeSec: 0,
      rubric: [
        { id: "done", label: "Done", weight: 2, manual: false, met: true },
        { id: "tone", label: "Tone", weight: 1, manual: true, met: null },
        { id: "notes", label: "Notes", weight: 1, manual: true, met: false },
      ],
    };
    const settled = settleUnmarked({ grading, completed: true, score: 80, passed: null as boolean | null });
    expect(settled.grading!.rubric.map((c) => c.id)).toEqual(["done", "notes"]); // a marked one stays
    expect(settled).toMatchObject({ score: 63, passed: false }); // rubric 2/3 → 60×.5 + 66.7×.5 = 63.3
    const untouched = { grading: { ...grading, rubric: grading.rubric.slice(0, 1) }, completed: true, score: 80, passed: true };
    expect(settleUnmarked(untouched)).toBe(untouched);
  });

  it("charges overtime per started minute and fails the time criterion", () => {
    const sim = load();
    const scheme = GradingSchemeSchema.parse({
      id: "timed", name: "Timed",
      points: { timeLimitSec: 60, overtimePenaltyPerMin: 10 },
      rubricWeight: 0,
      rubric: [{ id: "fast", label: "Within time", check: { type: "withinTime" } }],
    });
    const s = run(sim, createSession(sim, "resolve-printer", T0), "scenario", perfect, T0 + 150_000); // 90 s over
    const g = gradeSession(sim, s, scheme, T0 + 150_000);
    expect(g.overtimeSec).toBe(90);
    expect(g.pointsScore).toBe(80); // 2 started minutes × 10
    expect(g.rubric[0].met).toBe(false);
    expect(timeLeft(s, scheme)).toBe(-90);
  });

  it("scenario override wins; unknown schemes fall back to Standard", () => {
    const sim = load();
    sim.grading.schemeId = "nope";
    expect(resolveScheme(sim, "resolve-printer", [rubricScheme]).id).toBe("standard");
    sim.scenarios[0].gradingSchemeId = "support-rubric";
    expect(resolveScheme(sim, "resolve-printer", [rubricScheme]).id).toBe("support-rubric");
    expect(resolveScheme(sim, "log-vpn", [rubricScheme]).id).toBe("standard");
  });

  it("reports checks that aren't pointed at this simulation", () => {
    const sim = load();
    expect(unboundChecks(sim, rubricScheme)).toEqual(["Ticket marked resolved", "Find the new-ticket form"]);
    sim.grading.bindings = [
      { itemId: "resolved", conditions: [{ var: "t1042_status", op: "eq", value: "Resolved" }] },
      { itemId: "newticket", screenId: "new-ticket" },
    ];
    expect(unboundChecks(sim, rubricScheme)).toEqual([]);
  });

  it("evaluates open-world objectives live", () => {
    const sim = load();
    sim.grading.bindings = [{ itemId: "newticket", screenId: "new-ticket" }];
    let s = createSession(sim, null, T0);
    expect(evaluateObjectives(sim, s, rubricScheme).map((o) => o.met)).toEqual([false, false]);
    s = run(sim, s, "open", [["login-user", "a"], ["login-pass", "b"], ["login-submit"], ["dash-new"]]);
    // Visited login, dashboard, new-ticket = 3 of 4 screens.
    expect(evaluateObjectives(sim, s, rubricScheme).map((o) => o.met)).toEqual([true, true]);
  });
});

describe("reviewing AI marks", () => {
  it("lets a person correct an AI mark, keeps the AI's original, and rescores", async () => {
    const { reviewAiMark } = await import("../shared/grading");
    const a = {
      completed: true, score: 85, passed: true, reviews: undefined,
      grading: {
        schemeId: "s", schemeName: "S", passScore: 70, masteryScore: 90, pointsScore: 100, rubricWeight: 50, overtimeSec: 0,
        rubric: [
          { id: "done", label: "Done", weight: 1, manual: false, met: true },
          { id: "conv-tone", label: "Was polite", weight: 1, manual: false, ai: true, met: false, reason: "You were curt." },
        ],
      },
    };
    const r1 = reviewAiMark(a, "conv-tone", true, "They apologised twice; that counts.", "u-rev", "2026-11-15T00:00:00Z");
    expect(r1.score).toBe(100);
    expect(r1.grading!.rubric[1]).toMatchObject({ met: true, review: { originalMet: false, note: "They apologised twice; that counts." } });
    expect(r1.reviews).toEqual([{ criterionId: "conv-tone", label: "Was polite", from: false, to: true, note: "They apologised twice; that counts.", by: "u-rev", at: "2026-11-15T00:00:00Z" }]);
    // Setting it back to the AI's call removes the review mark but keeps the history.
    const r2 = reviewAiMark(r1, "conv-tone", false, "On reflection the AI was right.", "u-rev");
    expect((r2.grading!.rubric[1] as { review?: unknown }).review).toBeUndefined();
    expect(r2.score).toBe(75);
    expect(r2.reviews).toHaveLength(2);
    expect(() => reviewAiMark(a, "done", false, "x", "u")).toThrow(/Only AI-judged/);
  });
});
