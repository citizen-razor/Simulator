/**
 * "Where your points came from": an attempt's score as a ledger in step order, so learners
 * see where they gained and lost points, and builders see how a scenario is graded.
 *
 * Every number is in points of the FINAL score (out of 100), so the lines add up to the
 * score (give or take rounding):
 * "Missed" (a step not reached, a criterion not met) is shown but never subtracted; only
 * penalties are.
 *   - each completed step earns its share of the points part (100 ÷ steps × the points
 *     part's weight); a completed run earns all of them
 *   - each error or hint costs the scheme's penalty × the points part's weight, on the step
 *     where it happened
 *   - going over the time limit, and the points part's floor of 0, are their own lines
 *   - each rubric criterion earns its share of the rubric weight when met; trainer-marked
 *     ones awaiting marking show what they're worth
 * Mirrors finalScore() in grading.ts: until at least one rubric criterion is decided, the
 * score is the points part alone.
 */
import { scenarioPaths, type Attempt, type Simulation } from "./schema";

export interface FlowLine {
  key: string;
  kind: "step" | "unrecorded" | "overtime" | "floor" | "criterion";
  label: string;
  stepNo?: number;
  /** Points of the final score gained, and deducted (penalties), on this line (both ≥ 0). */
  gained: number;
  lost: number;
  /** Points on offer here that weren't earned (a step not reached, a criterion not met). Not a deduction. */
  missed: number;
  /** Step lines: whether the step was completed, and the errors and hints made there. */
  done?: boolean;
  errors?: number;
  hints?: number;
  /** Criterion lines. */
  met?: boolean | null;
  worth?: number;
  manual?: boolean;
  /** Conversation criteria judged by AI, with the reason given to the learner. */
  ai?: boolean;
  reason?: string;
  /** A person corrected the AI's mark: their note, and what the AI had said. */
  review?: { originalMet: boolean | null; note: string };
}

export interface Breakdown {
  /** Share of the final score from the points part and from the rubric (percent; sum to 100). */
  pointsShare: number;
  rubricShare: number;
  steps: FlowLine[];
  /** Overtime, the floor of 0, and penalties from older attempts that didn't record their step. */
  adjustments: FlowLine[];
  rubric: FlowLine[];
  total: number;
  /** Penalties per error and per hint, in points-part units (before weighting). */
  perError: number;
  perHint: number;
  /** False for older attempts that didn't record which step each penalty happened on. */
  stepsRecorded: boolean;
}

type AttemptLike = Pick<
  Attempt,
  "score" | "completed" | "errors" | "hintsUsed" | "stepsCompleted" | "stepsTotal" | "grading" | "penalties"
>;

const r1 = (x: number) => Math.round(x * 10) / 10;
// Standard scheme penalties, used for attempts that predate recording them.
const STANDARD = { error: 10, hint: 5 };

/** Whether the attempt recorded the step of every error and hint. */
export const stepsRecorded = (a: AttemptLike) => (a.penalties?.length ?? 0) === a.errors + a.hintsUsed;

export function breakdown(a: AttemptLike, stepTitles: string[] = []): Breakdown {
  const g = a.grading;
  const lost = g?.pointsLost;
  const perError = lost?.perError ?? (lost && a.errors ? lost.errors / a.errors : STANDARD.error);
  const perHint = lost?.perHint ?? (lost && a.hintsUsed ? lost.hints / a.hintsUsed : STANDARD.hint);

  // Rubric weighting, exactly as finalScore() applies it.
  const rubric = g?.rubric ?? [];
  const decided = rubric.filter((c) => c.met !== null);
  const decidedWeight = decided.reduce((n, c) => n + c.weight, 0);
  const allWeight = rubric.reduce((n, c) => n + c.weight, 0);
  const w = g && rubric.length && g.rubricWeight > 0 && decidedWeight > 0 ? g.rubricWeight / 100 : 0;
  const scale = 1 - w;

  // Steps: share of the points part for each completed step, penalties where they happened.
  const n = Math.max(a.stepsTotal, 0);
  const done = a.completed ? n : Math.min(a.stepsCompleted, n);
  const recorded = stepsRecorded(a);
  const events = recorded ? a.penalties ?? [] : [];
  const steps: FlowLine[] = [];
  for (let i = 1; i <= Math.max(n, 1); i++) {
    const here = events.filter((e) => Math.min(Math.max(e.stepNo, 1), Math.max(n, 1)) === i);
    const errors = here.filter((e) => e.kind === "error").length;
    const hints = here.length - errors;
    const isDone = n ? i <= done : a.completed;
    steps.push({
      key: `step-${i}`,
      kind: "step",
      stepNo: i,
      label: stepTitles[i - 1] ?? here[0]?.step ?? (n ? `Step ${i}` : "Complete the scenario"),
      done: isDone,
      gained: isDone ? (100 / Math.max(n, 1)) * scale : 0,
      missed: isDone ? 0 : (100 / Math.max(n, 1)) * scale,
      lost: (errors * perError + hints * perHint) * scale,
      errors,
      hints,
    });
  }

  const adjustments: FlowLine[] = [];
  if (!recorded && a.errors + a.hintsUsed > 0) {
    adjustments.push({
      key: "unrecorded",
      kind: "unrecorded",
      label: `${a.errors} error${a.errors === 1 ? "" : "s"} and ${a.hintsUsed} hint${a.hintsUsed === 1 ? "" : "s"} (step not recorded)`,
      gained: 0,
      missed: 0,
      lost: (a.errors * perError + a.hintsUsed * perHint) * scale,
      errors: a.errors,
      hints: a.hintsUsed,
    });
  }
  const overtime = lost?.overtime ?? 0;
  if (overtime > 0) adjustments.push({ key: "overtime", kind: "overtime", label: "Over the time limit", gained: 0, missed: 0, lost: overtime * scale });

  // The points part can't go below 0: give back what the penalties took beyond that.
  const pointsScore = g ? g.pointsScore : a.score;
  const raw = [...steps, ...adjustments].reduce((s, l) => s + l.gained - l.lost, 0) / (scale || 1);
  if (raw < 0 && pointsScore === 0) {
    adjustments.push({ key: "floor", kind: "floor", label: "The points part can't go below 0", gained: -raw * scale, missed: 0, lost: 0 });
  }

  const rubricLines: FlowLine[] = rubric.map((c) => {
    const pending = c.met === null;
    const worth = pending
      ? (g!.rubricWeight * c.weight) / (allWeight || 1)
      : w
        ? (w * 100 * c.weight) / decidedWeight
        : 0;
    return {
      key: `crit-${c.id}`,
      kind: "criterion",
      label: c.label,
      met: c.met,
      manual: c.manual,
      ai: c.ai,
      reason: c.reason,
      review: c.review ? { originalMet: c.review.originalMet, note: c.review.note } : undefined,
      worth: r1(worth),
      gained: c.met === true ? worth : 0,
      missed: c.met === false ? worth : 0,
      lost: 0,
    };
  });

  const round = (l: FlowLine) => ({ ...l, gained: r1(l.gained), lost: r1(l.lost), missed: r1(l.missed) });
  return {
    pointsShare: Math.round(scale * 100),
    rubricShare: Math.round(w * 100),
    steps: steps.map(round),
    adjustments: adjustments.map(round),
    rubric: rubricLines.map(round),
    total: a.score,
    perError: r1(perError),
    perHint: r1(perHint),
    stepsRecorded: recorded,
  };
}

/** Step instructions for the path an attempt took, with its random values filled in (unknown ones left as {{name}}). */
export function stepTitles(sim: Pick<Simulation, "scenarios">, scenarioId: string, pathName: string, vars: Record<string, string> = {}): string[] {
  const sc = sim.scenarios.find((s) => s.id === scenarioId);
  if (!sc) return [];
  const paths = scenarioPaths(sc);
  const path = paths.find((p) => p.name === pathName) ?? paths[0];
  return path.steps.map((st) => st.instruction.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (m, name: string) => vars[name] ?? m));
}
