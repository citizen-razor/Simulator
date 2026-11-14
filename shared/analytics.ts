/**
 * Course performance for builders: how a simulation and its scenarios are doing overall.
 * Everything here is aggregate. The result contains counts and averages, never who did
 * what, so builders can improve a course without seeing individual learners' results.
 *
 * Rubric "points": a criterion is worth  rubricWeight% × (its weight ÷ the rubric's total
 * weight)  points of the final 100. "Average earned" is that worth × how often it was met
 * (among attempts where it has been decided; trainer-marked ones awaiting marking are
 * counted separately).
 */
import { isSolo, masteryMark } from "./progress";
import type { Attempt, Simulation } from "./schema";

export interface Stats {
  attempts: number;
  learners: number;
  /** Share of attempts completed (0–1). */
  completedRate: number;
  /** Share of decided attempts that passed (0–1); null if none are decided yet. */
  passRate: number | null;
  /** Share of learners who mastered it (completed solo at the mastery mark) (0–1). */
  masteredRate: number;
  avgScore: number | null;
  medianDurationSec: number | null;
  /** Share of attempts that used guided help (0–1). */
  guidedShare: number;
}

export interface CriterionStats {
  key: string;
  label: string;
  schemeName: string;
  manual: boolean;
  /** Points of the final 100 this criterion is worth (averaged if the scheme changed). */
  pointsWorth: number;
  met: number;
  notMet: number;
  awaiting: number;
  /** met ÷ (met + notMet); null when nothing is decided yet. */
  metRate: number | null;
  /** Average points earned from this criterion per decided attempt. */
  avgPointsEarned: number | null;
}

export interface ScenarioAnalysis {
  scenarioId: string;
  title: string;
  stats: Stats;
  /** Counts of attempts by score band: [0–9, 10–19, …, 90–100]. */
  scoreBins: number[];
  paths: { name: string; count: number }[];
  /** Steps ordered by how often learners made errors or took hints there. */
  troubleSteps: { step: string; count: number }[];
  /** Where unfinished attempts stopped: the step they didn't get past. */
  stoppedAt: { step: string; count: number }[];
  /** Average points lost per attempt (only attempts that recorded it). */
  pointsLost: { errors: number; hints: number; overtime: number; basedOn: number } | null;
  /** Average points-part and rubric-part results (only attempts graded with a rubric). */
  rubricWeight: number | null;
  avgPointsScore: number | null;
  rubric: CriterionStats[];
}

export interface SimulationAnalysis {
  overall: Stats;
  scenarios: ScenarioAnalysis[];
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null);
const round1 = (x: number | null) => (x === null ? null : Math.round(x * 10) / 10);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
const who = (a: Attempt) => a.userId ?? `name:${a.trainee.trim().toLowerCase()}`;

export function stats(attempts: Attempt[]): Stats {
  const learners = new Set(attempts.map(who));
  const decided = attempts.filter((a) => a.passed !== null && a.passed !== undefined);
  const masteredBy = new Set(attempts.filter((a) => isSolo(a) && a.completed && a.score >= masteryMark(a)).map(who));
  return {
    attempts: attempts.length,
    learners: learners.size,
    completedRate: attempts.length ? attempts.filter((a) => a.completed).length / attempts.length : 0,
    passRate: decided.length ? decided.filter((a) => a.passed).length / decided.length : null,
    masteredRate: learners.size ? masteredBy.size / learners.size : 0,
    avgScore: round1(mean(attempts.map((a) => a.score))),
    medianDurationSec: median(attempts.map((a) => a.durationSec)),
    guidedShare: attempts.length ? attempts.filter((a) => !isSolo(a)).length / attempts.length : 0,
  };
}

function countBy<T>(items: T[], key: (t: T) => string): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const it of items) m.set(key(it), (m.get(key(it)) ?? 0) + 1);
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function rubricStats(attempts: Attempt[]): CriterionStats[] {
  const groups = new Map<string, { label: string; schemeName: string; manual: boolean; worth: number[]; met: number; notMet: number; awaiting: number }>();
  for (const a of attempts) {
    const g = a.grading;
    if (!g || !g.rubric.length) continue;
    const total = g.rubric.reduce((n, c) => n + c.weight, 0);
    for (const c of g.rubric) {
      const key = `${g.schemeId}/${c.id}`;
      const entry = groups.get(key) ?? { label: c.label, schemeName: g.schemeName, manual: c.manual, worth: [], met: 0, notMet: 0, awaiting: 0 };
      entry.label = c.label;
      entry.worth.push(total > 0 ? (g.rubricWeight * c.weight) / total : 0);
      if (c.met === true) entry.met++;
      else if (c.met === false) entry.notMet++;
      else entry.awaiting++;
      groups.set(key, entry);
    }
  }
  return [...groups.entries()].map(([key, e]) => {
    const decided = e.met + e.notMet;
    const worth = mean(e.worth) ?? 0;
    return {
      key,
      label: e.label,
      schemeName: e.schemeName,
      manual: e.manual,
      pointsWorth: Math.round(worth * 10) / 10,
      met: e.met,
      notMet: e.notMet,
      awaiting: e.awaiting,
      metRate: decided ? e.met / decided : null,
      avgPointsEarned: decided ? Math.round(((worth * e.met) / decided) * 10) / 10 : null,
    };
  });
}

export function analyzeScenario(sim: Pick<Simulation, "scenarios">, scenarioId: string, attempts: Attempt[]): ScenarioAnalysis {
  const sc = sim.scenarios.find((s) => s.id === scenarioId);
  const mine = attempts.filter((a) => a.scenarioId === scenarioId);
  const steps = sc?.steps ?? [];
  const bins = Array.from({ length: 10 }, () => 0);
  for (const a of mine) bins[Math.min(9, Math.floor(Math.max(0, a.score) / 10))]++;
  const recorded = mine.filter((a) => a.grading?.pointsLost);
  const withRubric = mine.filter((a) => a.grading && a.grading.rubric.length);
  return {
    scenarioId,
    title: sc?.title ?? mine[0]?.scenarioTitle ?? scenarioId,
    stats: stats(mine),
    scoreBins: bins,
    paths: (sc?.alternatePaths.length ? countBy(mine, (a) => a.pathName || "Main path") : []).map((x) => ({ name: x.key, count: x.count })),
    troubleSteps: countBy(mine.flatMap((a) => a.troubleSteps), (s) => s).map((x) => ({ step: x.key, count: x.count })),
    stoppedAt: countBy(
      mine.filter((a) => !a.completed),
      (a) => steps[a.stepsCompleted]?.instruction ?? (a.stepsCompleted >= a.stepsTotal ? "After the last step (success checks)" : `Step ${a.stepsCompleted + 1}`),
    ).map((x) => ({ step: x.key, count: x.count })),
    pointsLost: recorded.length
      ? {
          errors: round1(mean(recorded.map((a) => a.grading!.pointsLost!.errors)))!,
          hints: round1(mean(recorded.map((a) => a.grading!.pointsLost!.hints)))!,
          overtime: round1(mean(recorded.map((a) => a.grading!.pointsLost!.overtime)))!,
          basedOn: recorded.length,
        }
      : null,
    rubricWeight: withRubric.length ? round1(mean(withRubric.map((a) => a.grading!.rubricWeight))) : null,
    avgPointsScore: withRubric.length ? round1(mean(withRubric.map((a) => a.grading!.pointsScore))) : null,
    rubric: rubricStats(mine),
  };
}

/** Analyse a simulation. `includeGuided` false = Scenario-mode attempts only. */
export function analyzeSimulation(sim: Pick<Simulation, "scenarios">, attempts: Attempt[], includeGuided = true): SimulationAnalysis {
  const used = includeGuided ? attempts : attempts.filter((a) => a.mode === "scenario");
  const ids = [...new Set([...sim.scenarios.map((s) => s.id), ...used.map((a) => a.scenarioId)])];
  return { overall: stats(used), scenarios: ids.map((id) => analyzeScenario(sim, id, used)) };
}
