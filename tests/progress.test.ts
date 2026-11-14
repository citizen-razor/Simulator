import { describe, expect, it } from "vitest";
import { MASTERY_SCORE, summarizeTrainee, summarizeTrainees, topicProgress } from "../shared/progress";
import type { Attempt } from "../shared/schema";

let n = 0;
function attempt(p: Partial<Attempt>): Attempt {
  n++;
  return {
    id: `att-${n}`,
    trainee: "Sam",
    simulationId: "sim-1",
    simulationTitle: "Helpdesk",
    scenarioId: "sc-a",
    scenarioTitle: "Resolve ticket",
    mode: "scenario",
    assisted: false,
    completed: true,
    score: 90,
    errors: 0,
    hintsUsed: 0,
    durationSec: 60,
    stepsCompleted: 5,
    stepsTotal: 5,
    pathName: "",
    passed: null,
    mistakes: [],
    troubleSteps: [],
    finishedAt: `2026-11-${String(10 + n).padStart(2, "0")}T10:00:00Z`,
    ...p,
  };
}

describe("trainee progress", () => {
  it("classifies each scenario by its best unassisted result", () => {
    const list = [
      attempt({ scenarioId: "mastered", score: MASTERY_SCORE }),
      attempt({ scenarioId: "passed", score: 60 }),
      attempt({ scenarioId: "assisted", mode: "guided", assisted: true, score: 100 }),
      attempt({ scenarioId: "assisted", assisted: true, score: 95 }), // switched to guided mid-run
      attempt({ scenarioId: "incomplete", completed: false, score: 30 }),
    ];
    const s = summarizeTrainee("Sam", list);
    const status = Object.fromEntries(s.scenarios.map((x) => [x.scenarioId, x.status]));
    expect(status).toEqual({ mastered: "mastered", passed: "passed", assisted: "assisted", incomplete: "incomplete" });
    expect(s.mastered).toBe(1);
    // Least progress listed first.
    expect(s.scenarios.map((x) => x.status)).toEqual(["incomplete", "assisted", "passed", "mastered"]);
  });

  it("tracks improvement across solo runs and ignores guided runs for scoring", () => {
    const list = [
      attempt({ score: 40, completed: false }),
      attempt({ mode: "guided", assisted: true, score: 100 }),
      attempt({ score: 70 }),
      attempt({ score: 85 }),
    ];
    const [sc] = summarizeTrainee("Sam", list).scenarios;
    expect(sc.trend).toBe(45);
    expect(sc.bestSolo).toBe(85);
    expect(sc.latestSolo).toBe(85);
    expect(sc.guidedRuns).toBe(1);
    expect(summarizeTrainee("Sam", list).avgSolo).toBe(65); // (40+70+85)/3
  });

  it("finds the steps a trainee struggles with most", () => {
    const list = [
      attempt({ troubleSteps: ["Set the priority.", "Set the priority."] }),
      attempt({ troubleSteps: ["Set the priority.", "Open the ticket."] }),
    ];
    expect(summarizeTrainee("Sam", list).trouble).toEqual([
      { step: "Set the priority.", scenarioTitle: "Resolve ticket", count: 3 },
      { step: "Open the ticket.", scenarioTitle: "Resolve ticket", count: 1 },
    ]);
  });

  it("lists named trainees, most recently active first, skipping unnamed attempts", () => {
    const list = [attempt({ trainee: "Ana" }), attempt({ trainee: "" }), attempt({ trainee: "Ben" })];
    expect(summarizeTrainees(list).map((t) => t.name)).toEqual(["Ben", "Ana"]);
  });
});

describe("progress by topic", () => {
  it("counts mastery per topic through simulation tags, and uses each attempt's own mastery mark", () => {
    const list = [
      attempt({ simulationId: "s1", scenarioId: "a", score: 85 }),
      attempt({ simulationId: "s1", scenarioId: "b", score: 60 }),
      attempt({ simulationId: "s2", scenarioId: "c", score: 75, grading: { schemeId: "lenient", schemeName: "Lenient", passScore: 50, masteryScore: 70, pointsScore: 75, rubricWeight: 0, rubric: [], overtimeSec: 0 } }),
    ];
    const summary = summarizeTrainee("Sam", list);
    const topics = [
      { id: "cs", name: "Customer service", tags: [{ id: "refunds" }] },
      { id: "it", name: "IT", tags: [{ id: "vpn" }] },
      { id: "hr", name: "HR", tags: [{ id: "leave" }] },
    ];
    const out = topicProgress(summary, { s1: ["refunds"], s2: ["refunds", "vpn"] }, topics);
    expect(out).toEqual([
      { topicId: "cs", topicName: "Customer service", attempted: 3, mastered: 2 },
      { topicId: "it", topicName: "IT", attempted: 1, mastered: 1 },
    ]);
  });
});
