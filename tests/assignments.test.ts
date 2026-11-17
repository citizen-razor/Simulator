import { describe, expect, it } from "vitest";
import { assignmentStatus, meetsRequirement, type Assignment } from "../shared/assignments";
import type { Attempt } from "../shared/schema";

let n = 0;
const attempt = (p: Partial<Attempt>): Attempt => ({
  id: `att-${++n}`,
  trainee: "Priya",
  simulationId: "sim",
  simulationTitle: "Helpdesk",
  scenarioId: "sc",
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
  passed: true,
  mistakes: [],
  troubleSteps: [], penalties: [], log: [],
  finishedAt: "2026-11-10T10:00:00Z",
  grading: { schemeId: "standard", schemeName: "Standard", passScore: 60, masteryScore: 80, pointsScore: 90, rubricWeight: 0, rubric: [], overtimeSec: 0 },
  ...p,
});

const asg = (p: Partial<Assignment> = {}): Assignment => ({
  id: "asg-1",
  trainee: " priya ",
  simulationId: "sim",
  scenarioId: "sc",
  simulationTitle: "Helpdesk",
  scenarioTitle: "Resolve ticket",
  requirement: "pass",
  dueDate: "2026-11-20",
  note: "",
  createdAt: "2026-11-05T00:00:00Z",
  ...p,
});

describe("assignment requirements", () => {
  it("complete accepts guided runs; pass needs Scenario mode; master needs solo at the mastery mark", () => {
    const guided = attempt({ mode: "guided", assisted: true, score: 100 });
    expect(meetsRequirement(guided, "complete")).toBe(true);
    expect(meetsRequirement(guided, "pass")).toBe(false);
    expect(meetsRequirement(attempt({ assisted: true }), "pass")).toBe(true);
    expect(meetsRequirement(attempt({ assisted: true }), "master")).toBe(false);
    expect(meetsRequirement(attempt({ score: 79, passed: true }), "master")).toBe(false);
    expect(meetsRequirement(attempt({ score: 80 }), "master")).toBe(true);
    expect(meetsRequirement(attempt({ completed: false }), "complete")).toBe(false);
    expect(meetsRequirement(attempt({ passed: null }), "pass")).toBeNull(); // awaiting trainer marking
  });
});

describe("assignment status", () => {
  it("is done by the first qualifying attempt (names match loosely)", () => {
    const s = assignmentStatus(asg(), [attempt({ score: 40, passed: false, finishedAt: "2026-11-06T00:00:00Z" }), attempt({ finishedAt: "2026-11-12T00:00:00Z" })], "2026-11-14");
    expect(s).toMatchObject({ state: "done", doneAt: "2026-11-12T00:00:00Z", attempts: 2, bestScore: 90, doneBeforeAssigned: false });
  });

  it("gives credit for work done before it was assigned", () => {
    const earlier = attempt({ finishedAt: "2026-11-01T00:00:00Z", score: 100 });
    for (const requirement of ["complete", "pass", "master"] as const) {
      expect(assignmentStatus(asg({ requirement }), [earlier], "2026-11-14")).toMatchObject({
        state: "done",
        doneAt: "2026-11-01T00:00:00Z",
        doneBeforeAssigned: true,
        attempts: 1,
      });
    }
  });

  it("still needs the requirement to be met: no credit for a scenario not yet taken or not good enough", () => {
    expect(assignmentStatus(asg({ requirement: "master" }), [], "2026-11-14").state).toBe("open");
    expect(assignmentStatus(asg({ requirement: "master" }), [attempt({ score: 70 })], "2026-11-14").state).toBe("open");
    expect(assignmentStatus(asg({ requirement: "master" }), [attempt({ mode: "guided", assisted: true, score: 100 })], "2026-11-14").state).toBe("open");
  });

  it("tracks due dates and pending marking", () => {
    expect(assignmentStatus(asg(), [], "2026-11-14")).toMatchObject({ state: "open", daysLeft: 6 });
    expect(assignmentStatus(asg(), [], "2026-11-18")).toMatchObject({ state: "due-soon", daysLeft: 2 });
    expect(assignmentStatus(asg(), [], "2026-11-21")).toMatchObject({ state: "overdue", daysLeft: -1 });
    expect(assignmentStatus(asg({ dueDate: null }), [], "2030-01-01").state).toBe("open");
    expect(assignmentStatus(asg(), [attempt({ passed: null })], "2026-11-21").state).toBe("awaiting");
  });
});
