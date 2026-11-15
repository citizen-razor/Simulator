import { describe, expect, it } from "vitest";
import sample from "../samples/helpdesk.json";
import { analyzeSimulation, inDateRange, overviewCsv, performanceCsv, weekly } from "../shared/analytics";
import { SimulationSchema, type Attempt } from "../shared/schema";

const sim = SimulationSchema.parse(sample);
let n = 0;
const rubric = (met: (boolean | null)[]) => [
  { id: "done", label: "Completed", weight: 2, manual: false, met: met[0] },
  { id: "tone", label: "Professional notes", weight: 1, manual: true, met: met[1] },
  { id: "clean", label: "No mistakes", weight: 1, manual: false, met: met[2] },
];
const at = (p: Partial<Attempt>): Attempt => ({
  id: `a${++n}`, userId: `u${n}`, trainee: "", simulationId: sim.id, simulationTitle: sim.title, scenarioId: "resolve-printer",
  scenarioTitle: "Resolve", mode: "scenario", assisted: false, completed: true, score: 90, errors: 0, hintsUsed: 0, durationSec: 60,
  stepsCompleted: 7, stepsTotal: 7, pathName: "Main path", passed: true, mistakes: [], troubleSteps: [], penalties: [], finishedAt: "2026-11-14T00:00:00Z",
  ...p,
});
const graded = (met: (boolean | null)[], extra: Partial<Attempt> = {}): Attempt =>
  at({
    grading: { schemeId: "s1", schemeName: "Support", passScore: 70, masteryScore: 85, pointsScore: 80, rubricWeight: 40, rubric: rubric(met), overtimeSec: 0, pointsLost: { errors: 20, hints: 0, overtime: 0 } },
    ...extra,
  });

describe("course performance", () => {
  const attempts = [
    graded([true, true, false], { userId: "ana", score: 92, durationSec: 50, troubleSteps: ["Set the status to Resolved."] }),
    graded([true, null, false], { userId: "ana", score: 70, passed: null, durationSec: 70, troubleSteps: ["Set the status to Resolved.", "Save the ticket."] }),
    graded([true, false, true], { userId: "ben", score: 86, durationSec: 90, pathName: "Quick resolve" }),
    at({ userId: "cai", completed: false, score: 30, stepsCompleted: 4, passed: false, mode: "guided", assisted: true }),
    at({ userId: "dee", scenarioId: "log-vpn", score: 100 }),
  ];
  const r = analyzeSimulation(sim, attempts);
  const resolve = r.scenarios.find((s) => s.scenarioId === "resolve-printer")!;

  it("summarises the course without naming anyone", () => {
    expect(r.overall).toMatchObject({ attempts: 5, learners: 4 });
    expect(JSON.stringify(r)).not.toMatch(/"ana"|"ben"|"cai"|"dee"/);
    expect(resolve.stats).toMatchObject({ attempts: 4, learners: 3, completedRate: 0.75, avgScore: 69.5, medianDurationSec: 65, guidedShare: 0.25 });
    expect(resolve.stats.passRate).toBeCloseTo(2 / 3); // ana#1 and ben passed; cai failed; ana#2 awaiting
    expect(resolve.stats.masteredRate).toBeCloseTo(2 / 3); // ana (92 ≥ 85) and ben (86 ≥ 85) of 3 learners
  });

  it("shows score bands, paths, trouble spots and where unfinished runs stopped", () => {
    expect(resolve.scoreBins).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 1, 1]);
    expect(resolve.paths).toEqual([{ name: "Main path", count: 3 }, { name: "Quick resolve", count: 1 }]);
    expect(resolve.troubleSteps[0]).toEqual({ step: "Set the status to Resolved.", count: 2 });
    expect(resolve.stoppedAt).toEqual([{ step: "Set the status to Resolved.", count: 1 }]); // stopped before step 5
  });

  it("gives rubric results at the point level", () => {
    expect(resolve.rubricWeight).toBe(40);
    expect(resolve.avgPointsScore).toBe(80);
    expect(resolve.pointsLost).toEqual({ errors: 20, hints: 0, overtime: 0, basedOn: 3 });
    const byLabel = Object.fromEntries(resolve.rubric.map((c) => [c.label, c]));
    // Completed: weight 2 of 4 in a 40% rubric = 20 points; met 3/3
    expect(byLabel["Completed"]).toMatchObject({ pointsWorth: 20, met: 3, notMet: 0, awaiting: 0, metRate: 1, avgPointsEarned: 20 });
    // Professional notes: 10 points; met 1, not met 1, awaiting 1 → 50% → 5 points on average
    expect(byLabel["Professional notes"]).toMatchObject({ pointsWorth: 10, met: 1, notMet: 1, awaiting: 1, metRate: 0.5, avgPointsEarned: 5, manual: true });
    expect(byLabel["No mistakes"]).toMatchObject({ pointsWorth: 10, metRate: 1 / 3, avgPointsEarned: 3.3 });
  });

  it("averages where points are gained and lost along the steps", () => {
    const sim2 = SimulationSchema.parse(sample);
    const steps = sim2.scenarios.find((s) => s.id === "resolve-printer")!.steps;
    const runs = [
      at({ userId: "p1", score: 85, errors: 1, hintsUsed: 1, penalties: [{ kind: "error", stepNo: 5, step: steps[4].instruction }, { kind: "hint", stepNo: 5, step: steps[4].instruction }] }),
      at({ userId: "p2", score: 100 }),
      at({ userId: "p3", score: 90, errors: 1, penalties: [] }), // older: step not recorded, left out
    ];
    const f = analyzeSimulation(sim2, runs).scenarios.find((s) => s.scenarioId === "resolve-printer")!.flow;
    expect(f.basedOn).toBe(2);
    const s5 = f.steps.find((l) => l.stepNo === 5)!;
    expect(s5).toMatchObject({ label: steps[4].instruction, avgLost: 7.5, lostShare: 0.5, errors: 1, hints: 1 });
    expect(f.steps).toHaveLength(steps.length);
    expect(f.steps[0].avgGained).toBeCloseTo(100 / steps.length, 1);
  });

  it("can leave out guided runs", () => {
    expect(analyzeSimulation(sim, attempts, false).overall.attempts).toBe(4);
  });

  it("filters by date and groups by week, filling empty weeks", () => {
    const xs = [at({ finishedAt: "2026-11-02T10:00:00Z" }), at({ finishedAt: "2026-11-05T10:00:00Z", score: 50, passed: false }), at({ finishedAt: "2026-11-19T10:00:00Z" })];
    expect(inDateRange(xs, "2026-11-05", "2026-11-19")).toHaveLength(2);
    expect(inDateRange(xs, undefined, "2026-11-04")).toHaveLength(1);
    const w = weekly(xs);
    expect(w.map((x) => [x.week, x.attempts])).toEqual([["2026-11-02", 2], ["2026-11-09", 0], ["2026-11-16", 1]]);
    expect(w[0]).toMatchObject({ avgScore: 70, passRate: 0.5 });
  });

  it("exports the figures as CSV, safely", () => {
    const csv = performanceCsv("Help desk", analyzeSimulation(sim, attempts));
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^Scenario,Type,Item,Attempts,Learners/);
    expect(lines[1]).toMatch(/^Help desk,Course,,5,4,80,/);
    expect(csv).toContain(",Criterion,Professional notes,3,,,,,,5,,,50,10");
    expect(csv).toContain(",Step,5. Set the status to Resolved.,");
    expect(csv).not.toMatch(/ana|ben|cai|dee/);
    // Formula-looking text is neutralised; commas and quotes are quoted.
    expect(overviewCsv([{ title: '=HYPERLINK("x"), y', scenarios: 1, stats: analyzeSimulation(sim, []).overall }])).toContain(`"'=HYPERLINK(""x""), y"`);
  });
});
