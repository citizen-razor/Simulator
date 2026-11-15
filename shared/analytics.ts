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
import { breakdown, stepTitles, stepsRecorded, type FlowLine } from "./breakdown";
import { isSolo, masteryMark } from "./progress";
import { reportingTree, type User } from "./people";
import { withUserIds } from "./leaderboard";
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

/** One line of the average points flow: per attempt, in points of the final score. */
export interface FlowAverage {
  key: string;
  kind: FlowLine["kind"];
  label: string;
  stepNo?: number;
  avgGained: number;
  avgLost: number;
  avgMissed: number;
  /** Share of attempts that lost points (or missed them) on this line (0–1). */
  lostShare: number;
  errors: number;
  hints: number;
}

export interface PointsFlowAverage {
  /** Attempts the averages are based on (those that recorded the step of every error and hint). */
  basedOn: number;
  steps: FlowAverage[];
  adjustments: FlowAverage[];
  rubric: FlowAverage[];
  avgScore: number | null;
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
  /** Where points are gained and lost along the scenario, on average. */
  flow: PointsFlowAverage;
}

export interface WeekStats {
  /** Monday the week starts (YYYY-MM-DD, UTC). */
  week: string;
  attempts: number;
  learners: number;
  avgScore: number | null;
  passRate: number | null;
}

export interface SimulationAnalysis {
  /** Set when a team filter leaves too few learners to show without identifying someone. */
  hidden?: boolean;
  overall: Stats;
  /** Week by week, oldest first, including empty weeks in between. */
  weekly: WeekStats[];
  scenarios: ScenarioAnalysis[];
}

/**
 * Team filters show nothing for fewer learners than this: with a known team, figures for one or
 * two people would effectively be their individual results, which Builders don't see.
 */
export const MIN_TEAM_LEARNERS = 3;

/** Attempts by people in a leader's reporting tree (any depth). Older name-only attempts are matched by name first. */
export function teamAttempts(attempts: Attempt[], people: Pick<User, "id" | "name" | "managerId" | "active">[], leaderId: string): Attempt[] {
  const team = reportingTree(people, leaderId);
  return withUserIds(attempts, people).filter((a) => !!a.userId && team.has(a.userId));
}

/** Attempts finished between two dates (YYYY-MM-DD, inclusive; either may be left out). */
export function inDateRange<A extends Pick<Attempt, "finishedAt">>(attempts: A[], from?: string, to?: string): A[] {
  return attempts.filter((a) => {
    const day = a.finishedAt.slice(0, 10);
    return (!from || day >= from) && (!to || day <= to);
  });
}

const weekStart = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

export function weekly(attempts: Attempt[]): WeekStats[] {
  if (!attempts.length) return [];
  const byWeek = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const w = weekStart(a.finishedAt);
    byWeek.set(w, [...(byWeek.get(w) ?? []), a]);
  }
  const weeks = [...byWeek.keys()].sort();
  const out: WeekStats[] = [];
  for (let d = new Date(`${weeks[0]}T00:00:00Z`); d.toISOString().slice(0, 10) <= weeks[weeks.length - 1]; d.setUTCDate(d.getUTCDate() + 7)) {
    const w = d.toISOString().slice(0, 10);
    const s = stats(byWeek.get(w) ?? []);
    out.push({ week: w, attempts: s.attempts, learners: s.learners, avgScore: s.avgScore, passRate: s.passRate });
  }
  return out;
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
    flow: flowAverage(sim, scenarioId, mine),
  };
}

/** Average each breakdown line across attempts, grouped by step text (paths can differ) or line type. */
export function flowAverage(sim: Pick<Simulation, "scenarios">, scenarioId: string, attempts: Attempt[]): PointsFlowAverage {
  const used = attempts.filter(stepsRecorded);
  const groups = new Map<string, { line: FlowLine; order: number; gained: number; lost: number; missed: number; hit: number; errors: number; hints: number }>();
  const add = (section: string, l: FlowLine, order: number) => {
    const key = `${section}:${l.kind === "step" ? l.label : l.kind === "criterion" ? l.key : l.kind}`;
    const g = groups.get(key) ?? { line: l, order, gained: 0, lost: 0, missed: 0, hit: 0, errors: 0, hints: 0 };
    g.order = Math.min(g.order, order);
    g.gained += l.gained;
    g.lost += l.lost;
    g.missed += l.missed;
    if (l.lost > 0 || l.missed > 0) g.hit++;
    g.errors += l.errors ?? 0;
    g.hints += l.hints ?? 0;
    groups.set(key, g);
  };
  for (const a of used) {
    const b = breakdown(a, stepTitles(sim, scenarioId, a.pathName));
    b.steps.forEach((l) => add("steps", l, l.stepNo ?? 0));
    b.adjustments.forEach((l, i) => add("adjustments", l, i));
    b.rubric.forEach((l, i) => add("rubric", l, i));
  }
  const n = used.length || 1;
  const out = (section: string) =>
    [...groups.entries()]
      .filter(([k]) => k.startsWith(`${section}:`))
      .sort((x, y) => x[1].order - y[1].order)
      .map(([key, g]) => ({
        key,
        kind: g.line.kind,
        label: g.line.label,
        stepNo: g.line.kind === "step" ? g.order : undefined,
        avgGained: Math.round((g.gained / n) * 10) / 10,
        avgLost: Math.round((g.lost / n) * 10) / 10,
        avgMissed: Math.round((g.missed / n) * 10) / 10,
        lostShare: g.hit / n,
        errors: g.errors,
        hints: g.hints,
      }));
  return {
    basedOn: used.length,
    steps: out("steps"),
    adjustments: out("adjustments"),
    rubric: out("rubric"),
    avgScore: used.length ? Math.round((used.reduce((s, a) => s + a.score, 0) / used.length) * 10) / 10 : null,
  };
}

/** Analyse a simulation. `includeGuided` false = Scenario-mode attempts only. */
export function analyzeSimulation(sim: Pick<Simulation, "scenarios">, attempts: Attempt[], includeGuided = true): SimulationAnalysis {
  const used = includeGuided ? attempts : attempts.filter((a) => a.mode === "scenario");
  const ids = [...new Set([...sim.scenarios.map((s) => s.id), ...used.map((a) => a.scenarioId)])];
  return { overall: stats(used), weekly: weekly(used), scenarios: ids.map((id) => analyzeScenario(sim, id, used)) };
}

// ------------------------------------------------------------------ CSV export

const pct = (x: number | null | undefined) => (x === null || x === undefined ? "" : String(Math.round(x * 1000) / 10));
/** One spreadsheet cell; text starting with = + - @ is prefixed so spreadsheets don't run it as a formula. */
function cell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "Scenario", "Type", "Item", "Attempts", "Learners", "Completed %", "Passed %", "Mastered %", "Average score",
  "Average points earned", "Average points lost", "Attempts losing points %", "Met rate %", "Worth (points)",
] as const;

/**
 * The course's figures as one CSV, one row per thing measured: the course and each scenario
 * (rates and averages), each week, each step and penalty (points earned and lost), and each
 * rubric criterion (worth, met rate, average earned). Aggregate only, like the page.
 */
export function performanceCsv(title: string, a: SimulationAnalysis): string {
  type Row = Partial<Record<(typeof CSV_COLUMNS)[number], string | number | null>>;
  const rows: Row[] = [];
  const statRow = (scenario: string, type: string, s: Stats): Row => ({
    Scenario: scenario, Type: type, Item: "", Attempts: s.attempts, Learners: s.learners, "Completed %": pct(s.completedRate),
    "Passed %": pct(s.passRate), "Mastered %": pct(s.masteredRate), "Average score": s.avgScore,
  });
  rows.push(statRow(title, "Course", a.overall));
  for (const w of a.weekly) rows.push({ Scenario: title, Type: "Week", Item: w.week, Attempts: w.attempts, Learners: w.learners, "Average score": w.avgScore, "Passed %": pct(w.passRate) });
  for (const sc of a.scenarios) {
    rows.push(statRow(sc.title, "Scenario", sc.stats));
    for (const l of [...sc.flow.steps, ...sc.flow.adjustments]) {
      rows.push({
        Scenario: sc.title, Type: l.kind === "step" ? "Step" : "Penalty", Item: l.stepNo !== undefined ? `${l.stepNo}. ${l.label}` : l.label,
        Attempts: sc.flow.basedOn, "Average points earned": l.avgGained, "Average points lost": l.avgLost, "Attempts losing points %": pct(l.lostShare),
      });
    }
    for (const c of sc.rubric) {
      rows.push({
        Scenario: sc.title, Type: "Criterion", Item: c.label, Attempts: c.met + c.notMet + c.awaiting, "Met rate %": pct(c.metRate),
        "Average points earned": c.avgPointsEarned, "Worth (points)": c.pointsWorth,
      });
    }
  }
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}

/** The all-courses list as CSV: one row per simulation. */
export function overviewCsv(rows: { title: string; scenarios: number; stats: Stats }[]): string {
  const head = ["Simulation", "Scenarios", "Attempts", "Learners", "Completed %", "Passed %", "Mastered %", "Average score"];
  const body = rows.map((r) =>
    [r.title, r.scenarios, r.stats.attempts, r.stats.learners, pct(r.stats.completedRate), pct(r.stats.passRate), pct(r.stats.masteredRate), r.stats.avgScore].map(cell).join(","),
  );
  return [head.join(","), ...body].join("\r\n") + "\r\n";
}
