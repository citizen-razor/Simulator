/**
 * Trainee progress: turns the flat list of saved attempts into a per-trainee,
 * per-scenario picture for the Progress page.
 *
 * Definitions (kept in one place so they're easy to change):
 *   solo run   a Scenario-mode attempt with no guided help at any point
 *   mastered   a completed solo run scoring at least MASTERY_SCORE
 *   passed     a completed solo run below that score
 *   assisted   completed, but only with guided help
 *   incomplete attempted, never completed
 */
import type { Attempt } from "./schema";

export const MASTERY_SCORE = 80;

export type ScenarioStatus = "mastered" | "passed" | "assisted" | "incomplete";

export interface ScenarioProgress {
  key: string;
  simulationId: string;
  simulationTitle: string;
  scenarioId: string;
  scenarioTitle: string;
  /** Oldest first. */
  attempts: Attempt[];
  status: ScenarioStatus;
  /** Best completed solo score, if any. */
  bestSolo: number | null;
  /** Most recent solo score (completed or not), if any. */
  latestSolo: number | null;
  /** Latest solo score minus the first, when there are at least two solo runs. */
  trend: number | null;
  guidedRuns: number;
}

export interface TroubleSpot {
  step: string;
  scenarioTitle: string;
  count: number;
}

export interface TraineeSummary {
  name: string;
  attempts: number;
  lastActive: string;
  practiceSec: number;
  /** Average of solo scores, or null with no solo runs. */
  avgSolo: number | null;
  scenarios: ScenarioProgress[];
  mastered: number;
  /** Steps where the trainee most often made errors or took hints, most frequent first. */
  trouble: TroubleSpot[];
}

export const isSolo = (a: Attempt) => a.mode === "scenario" && !a.assisted;

const average = (xs: number[]) => (xs.length ? Math.round(xs.reduce((n, x) => n + x, 0) / xs.length) : null);

export function scenarioProgress(attempts: Attempt[]): ScenarioProgress {
  const list = [...attempts].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  const first = list[0];
  const solo = list.filter(isSolo);
  const soloDone = solo.filter((a) => a.completed);
  const bestSolo = soloDone.length ? Math.max(...soloDone.map((a) => a.score)) : null;
  const status: ScenarioStatus =
    bestSolo !== null && bestSolo >= MASTERY_SCORE
      ? "mastered"
      : bestSolo !== null
        ? "passed"
        : list.some((a) => a.completed)
          ? "assisted"
          : "incomplete";
  return {
    key: `${first.simulationId}/${first.scenarioId}`,
    simulationId: first.simulationId,
    simulationTitle: list[list.length - 1].simulationTitle,
    scenarioId: first.scenarioId,
    scenarioTitle: list[list.length - 1].scenarioTitle,
    attempts: list,
    status,
    bestSolo,
    latestSolo: solo.length ? solo[solo.length - 1].score : null,
    trend: solo.length >= 2 ? solo[solo.length - 1].score - solo[0].score : null,
    guidedRuns: list.filter((a) => !isSolo(a)).length,
  };
}

function troubleSpots(attempts: Attempt[], limit = 5): TroubleSpot[] {
  const counts = new Map<string, TroubleSpot>();
  for (const a of attempts) {
    for (const step of a.troubleSteps) {
      const key = `${a.simulationId}/${a.scenarioId}/${step}`;
      const spot = counts.get(key) ?? { step, scenarioTitle: a.scenarioTitle, count: 0 };
      spot.count++;
      counts.set(key, spot);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.step.localeCompare(b.step)).slice(0, limit);
}

export function summarizeTrainee(name: string, attempts: Attempt[]): TraineeSummary {
  const mine = attempts.filter((a) => a.trainee === name);
  const groups = new Map<string, Attempt[]>();
  for (const a of mine) {
    const key = `${a.simulationId}/${a.scenarioId}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const order: Record<ScenarioStatus, number> = { incomplete: 0, assisted: 1, passed: 2, mastered: 3 };
  const scenarios = [...groups.values()]
    .map(scenarioProgress)
    // Least progress first: that's what needs attention.
    .sort((a, b) => order[a.status] - order[b.status] || a.scenarioTitle.localeCompare(b.scenarioTitle));
  return {
    name,
    attempts: mine.length,
    lastActive: mine.reduce((m, a) => (a.finishedAt > m ? a.finishedAt : m), ""),
    practiceSec: mine.reduce((n, a) => n + a.durationSec, 0),
    avgSolo: average(mine.filter(isSolo).map((a) => a.score)),
    scenarios,
    mastered: scenarios.filter((s) => s.status === "mastered").length,
    trouble: troubleSpots(mine),
  };
}

/** One summary per named trainee, most recently active first. Attempts without a name are left out. */
export function summarizeTrainees(attempts: Attempt[]): TraineeSummary[] {
  const names = [...new Set(attempts.map((a) => a.trainee).filter(Boolean))];
  return names.map((n) => summarizeTrainee(n, attempts)).sort((a, b) => b.lastActive.localeCompare(a.lastActive));
}
