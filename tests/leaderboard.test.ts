import { describe, expect, it } from "vitest";
import { mainBoard, scenarioBoard, withUserIds } from "../shared/leaderboard";
import type { Attempt } from "../shared/schema";

let n = 0;
const at = (userId: string | undefined, scenarioId: string, score: number, p: Partial<Attempt> = {}): Attempt => ({
  id: `a${++n}`, userId, trainee: p.trainee ?? "", simulationId: "sim", simulationTitle: "Sim", scenarioId, scenarioTitle: scenarioId,
  mode: "scenario", assisted: false, completed: true, score, errors: 0, hintsUsed: 0, durationSec: 100, stepsCompleted: 5,
  stepsTotal: 5, pathName: "", passed: true, mistakes: [], troubleSteps: [], penalties: [], finishedAt: `2026-11-${10 + (n % 9)}T00:00:00Z`, ...p,
});
const people = [{ id: "ana", name: "Ana" }, { id: "ben", name: "Ben" }, { id: "cai", name: "Cai" }, { id: "dee", name: "Dee" }];

describe("leaderboard", () => {
  const attempts = [
    at("ana", "s1", 90), at("ana", "s2", 85), // 2 mastered, avg 87.5 → 88
    at("ben", "s1", 95), at("ben", "s2", 60), // 1 mastered
    at("cai", "s1", 95), at("cai", "s2", 60), // ties with Ben
    at("dee", "s1", 100, { mode: "guided", assisted: true }), // guided only: attempted, 0 mastered, no solo avg
  ];

  it("ranks by scenarios mastered, then average solo score; ties share a rank", () => {
    expect(mainBoard(people, attempts).map((r) => [r.rank, r.name, r.mastered, r.avgSolo])).toEqual([
      [1, "Ana", 2, 88],
      [2, "Ben", 1, 78],
      [2, "Cai", 1, 78],
      [4, "Dee", 0, null],
    ]);
  });

  it("narrows to a team or a set of scenarios", () => {
    expect(mainBoard(people, attempts, { onlyUserIds: new Set(["ben", "dee"]) }).map((r) => r.name)).toEqual(["Ben", "Dee"]);
    expect(mainBoard(people, attempts, { inScope: (a) => a.scenarioId === "s2" }).map((r) => [r.name, r.mastered])).toEqual([["Ana", 1], ["Ben", 0], ["Cai", 0]]);
  });

  it("scenario board: best solo score, then fastest", () => {
    const list = [...attempts, at("ana", "s1", 95, { durationSec: 80 }), at("ben", "s1", 95, { durationSec: 120 })];
    expect(scenarioBoard(people, list, "sim", "s1").map((r) => [r.rank, r.name, r.best, r.durationSec])).toEqual([
      [1, "Ana", 95, 80],
      [2, "Ben", 95, 100],
      [2, "Cai", 95, 100],
    ]);
  });

  it("matches older name-only attempts to people (only when the name is unique)", () => {
    const old = [at(undefined, "s1", 90, { trainee: " ana " }), at(undefined, "s1", 90, { trainee: "Ghost" })];
    expect(withUserIds(old, people).map((a) => a.userId)).toEqual(["ana", undefined]);
    expect(withUserIds(old, [...people, { id: "ana2", name: "ANA" }]).map((a) => a.userId)).toEqual([undefined, undefined]);
  });
});

describe("results saved under typed names", () => {
  it("lists only names that match no one or several people", async () => {
    const { unlinkedNames } = await import("../shared/leaderboard");
    const people = [{ id: "u1", name: "Sam Lee" }, { id: "u2", name: "Alex Kim" }, { id: "u3", name: "alex kim" }] as Parameters<typeof unlinkedNames>[1];
    const base = { id: "x", simulationId: "s", simulationTitle: "", scenarioId: "c", scenarioTitle: "", mode: "scenario" as const, assisted: false, completed: true, score: 90, errors: 0, hintsUsed: 0, durationSec: 1, stepsCompleted: 1, stepsTotal: 1, pathName: "", passed: true, mistakes: [], troubleSteps: [], penalties: [] };
    const rows = unlinkedNames(
      [
        { ...base, trainee: "Sam Lee", finishedAt: "2026-01-01" }, // matches one person: linked automatically
        { ...base, trainee: "Alex Kim", finishedAt: "2026-01-02" }, // two people
        { ...base, trainee: "Robin", finishedAt: "2026-01-03" },
        { ...base, trainee: "robin ", finishedAt: "2026-01-04" },
        { ...base, trainee: "Robin", userId: "u1", finishedAt: "2026-01-05" }, // already has an account
      ],
      people,
    );
    expect(rows).toEqual([
      { trainee: "Robin", attempts: 2, last: "2026-01-04", candidates: [] },
      { trainee: "Alex Kim", attempts: 1, last: "2026-01-02", candidates: ["u2", "u3"] },
    ]);
  });
});
