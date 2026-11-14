/**
 * Grading: applies a GradingScheme (shared/library.ts) to a play session.
 *
 *   final score = points × (1 − w) + rubric × w        where w = rubricWeight / 100
 *
 *   points  100 for completion (partial runs by progress), minus the scheme's error and
 *           hint penalties, minus the overtime penalty past the time limit (0–100)
 *   rubric  % of rubric weight met. Criteria a trainer must mark ("manual") count once
 *           marked; until then the score is provisional and pass/fail is unknown (null).
 *   passed  completed AND final score ≥ the scheme's pass mark
 *
 * Open-world objectives use the same checks but are just a live checklist, never scored.
 */
import { checkAll, getScenario, scoreSession, type SessionState } from "./engine";
import {
  DEFAULT_SCHEME_ID,
  STANDARD_SCHEME,
  type Check,
  type Criterion,
  type GradingScheme,
  type Objective,
} from "./library";
import type { Attempt, Simulation } from "./schema";

type AttemptGrading = NonNullable<Attempt["grading"]>;

/** Scenario's own scheme → the simulation's scheme → Standard. Unknown ids fall back the same way. */
export function resolveScheme(sim: Simulation, scenarioId: string | null, library: GradingScheme[]): GradingScheme {
  const find = (id: string | null | undefined) => (id ? library.find((s) => s.id === id) : undefined);
  const sc = getScenario(sim, scenarioId);
  return find(sc?.gradingSchemeId) ?? find(sim.grading.schemeId) ?? find(DEFAULT_SCHEME_ID) ?? STANDARD_SCHEME;
}

/** A criterion's or objective's check, with this simulation's screen/state targets applied. */
export function boundCheck(sim: Simulation, item: { id: string; check: Check }): Check {
  const b = sim.grading.bindings.find((x) => x.itemId === item.id);
  if (!b) return item.check;
  if (item.check.type === "screen") return { ...item.check, screenId: b.screenId ?? item.check.screenId };
  if (item.check.type === "state") return { ...item.check, conditions: b.conditions ?? item.check.conditions };
  return item.check;
}

/** Checks whose target isn't set for this simulation, so they can never pass. Shown in the editor. */
export function unboundChecks(sim: Simulation, scheme: GradingScheme): string[] {
  const missing: string[] = [];
  for (const item of [...scheme.rubric, ...scheme.objectives]) {
    const c = boundCheck(sim, item);
    if (c.type === "screen" && !sim.screens.some((s) => s.id === c.screenId)) missing.push(item.label);
    if (c.type === "state" && !(c.conditions ?? []).length) missing.push(item.label);
  }
  return missing;
}

export interface CheckContext {
  completed: boolean;
  errors: number;
  hints: number;
  durationSec: number;
  timeLimitSec: number | null;
  visited: string[];
  screenCount: number;
  vars: Record<string, string>;
}

/** true / false, or null for checks a trainer must mark. */
export function evaluateCheck(check: Check, ctx: CheckContext): boolean | null {
  switch (check.type) {
    case "completed":
      return ctx.completed;
    case "maxErrors":
      return ctx.errors <= (check.n ?? 0);
    case "noHints":
      return ctx.hints === 0;
    case "withinTime":
      return ctx.timeLimitSec === null || ctx.durationSec <= ctx.timeLimitSec;
    case "coverage":
      return ctx.screenCount > 0 && (100 * new Set(ctx.visited).size) / ctx.screenCount >= (check.n ?? 100);
    case "screen":
      return !!check.screenId && ctx.visited.includes(check.screenId);
    case "state":
      return (check.conditions ?? []).length > 0 && checkAll(check.conditions, ctx.vars);
    case "manual":
      return null;
  }
}

function contextFor(sim: Simulation, state: SessionState, scheme: GradingScheme, now: number): CheckContext {
  const end = state.finishedAt ?? now;
  return {
    completed: state.completed,
    errors: state.errors,
    hints: state.hintsUsed,
    durationSec: Math.round((end - state.startedAt) / 1000),
    timeLimitSec: scheme.points.timeLimitSec,
    visited: state.visited,
    screenCount: sim.screens.length,
    vars: state.vars,
  };
}

/** Combine points and rubric into the final score and pass/fail. Also used after a trainer marks criteria. */
export function finalScore(g: Pick<AttemptGrading, "pointsScore" | "rubricWeight" | "rubric" | "passScore">, completed: boolean) {
  const decided = g.rubric.filter((c) => c.met !== null);
  const pending = g.rubric.length - decided.length;
  const totalWeight = decided.reduce((n, c) => n + c.weight, 0);
  const w = g.rubric.length && g.rubricWeight > 0 ? g.rubricWeight / 100 : 0;
  // With nothing marked yet, show the points score as the provisional result.
  const rubricPct = totalWeight > 0 ? (100 * decided.filter((c) => c.met).reduce((n, c) => n + c.weight, 0)) / totalWeight : null;
  const score = Math.round(rubricPct === null || w === 0 ? g.pointsScore : g.pointsScore * (1 - w) + rubricPct * w);
  const passed = pending > 0 && w > 0 ? null : completed && score >= g.passScore;
  return { score, passed, pendingManual: pending };
}

export interface GradeResult extends AttemptGrading {
  score: number;
  passed: boolean | null;
  pendingManual: number;
}

/** Grade a session against a scheme (live during play, and when the attempt is saved). */
export function gradeSession(sim: Simulation, state: SessionState, scheme: GradingScheme, now = Date.now()): GradeResult {
  const ctx = contextFor(sim, state, scheme, now);
  const base = scoreSession(sim, state, now, scheme.points);
  const limit = scheme.points.timeLimitSec;
  const overtimeSec = limit !== null ? Math.max(0, ctx.durationSec - limit) : 0;
  const overtimePenalty = Math.ceil(overtimeSec / 60) * scheme.points.overtimePenaltyPerMin;
  const pointsScore = Math.max(0, base.score - overtimePenalty);
  const rubric = scheme.rubric.map((c: Criterion) => ({
    id: c.id,
    label: c.label,
    weight: c.weight,
    manual: c.check.type === "manual",
    met: evaluateCheck(boundCheck(sim, c), ctx),
  }));
  const grading: AttemptGrading = {
    schemeId: scheme.id,
    schemeName: scheme.name,
    passScore: scheme.points.passScore,
    masteryScore: scheme.points.masteryScore,
    pointsScore,
    rubricWeight: scheme.rubricWeight,
    rubric,
    overtimeSec,
    pointsLost: {
      errors: state.errors * scheme.points.errorPenalty,
      hints: state.hintsUsed * scheme.points.hintPenalty,
      overtime: overtimePenalty,
      perError: scheme.points.errorPenalty,
      perHint: scheme.points.hintPenalty,
    },
  };
  return { ...grading, ...finalScore(grading, state.completed) };
}

/** Open-world objectives with whether each is met right now. */
export function evaluateObjectives(sim: Simulation, state: SessionState, scheme: GradingScheme, now = Date.now()) {
  const ctx = contextFor(sim, state, scheme, now);
  return scheme.objectives.map((o: Objective) => ({ id: o.id, label: o.label, met: evaluateCheck(boundCheck(sim, o), ctx) === true }));
}

/** Seconds left on the clock (negative = overtime), or null with no time limit. */
export function timeLeft(state: SessionState, scheme: GradingScheme, now = Date.now()): number | null {
  const limit = scheme.points.timeLimitSec;
  if (limit === null) return null;
  return limit - Math.round(((state.finishedAt ?? now) - state.startedAt) / 1000);
}
