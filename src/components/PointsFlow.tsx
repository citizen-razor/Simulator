/**
 * "Where your points came from": an attempt's score as a ledger in step order
 * (shared/breakdown.ts). Shown on the end-of-run summary, on a person's progress page and
 * on Results, so learners see where they gained and lost points and how they're graded.
 */
import { useEffect, useState } from "react";
import { breakdown, stepTitles, type Breakdown, type FlowLine } from "../../shared/breakdown";
export { stepTitles };
import type { Attempt, Simulation } from "../../shared/schema";
import { api } from "../api";

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

function Line({ l }: { l: FlowLine }) {
  const penalties = [
    l.errors ? `${l.errors} error${l.errors === 1 ? "" : "s"}` : "",
    l.hints ? `${l.hints} hint${l.hints === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");
  const icon =
    l.kind === "criterion" ? (l.met === true ? "✓" : l.met === false ? "✕" : "⏳") :
    l.kind === "step" ? (l.done ? "✓" : "○") : l.gained > 0 ? "+" : "!";
  const state =
    l.kind === "criterion" ? (l.met === true ? "met" : l.met === false ? "missed" : "pending") :
    l.kind === "step" ? (l.done ? "met" : "missed") : l.lost > 0 ? "missed" : "met";
  return (
    <li className={`flow-line ${state}`}>
      <span className="flow-icon" aria-hidden>{icon}</span>
      <span className="flow-label">
        {l.stepNo !== undefined && <span className="muted">Step {l.stepNo} · </span>}
        {l.label}
        {l.kind === "step" && !l.done && <span className="muted small"> (not reached)</span>}
        {l.kind === "criterion" && l.manual && <span className="muted small"> (trainer-marked)</span>}
        {l.kind === "criterion" && l.ai && <span className="muted small"> (conversation, judged by AI)</span>}
        {l.reason && <div className="flow-reason small">{l.reason}</div>}
      </span>
      <span className="flow-pts">
        {l.gained > 0 && <span className="pts-gain">+{fmt(l.gained)}</span>}
        {l.lost > 0 && <span className="pts-loss" title={penalties || undefined}>−{fmt(l.lost)}{penalties && <small> {penalties}</small>}</span>}
        {l.missed > 0 && <span className="pts-missed">{fmt(l.missed)} missed</span>}
        {l.kind === "criterion" && l.met === null && <span className="pts-pending">⏳ up to {fmt(l.worth ?? 0)}</span>}
        {l.gained === 0 && l.lost === 0 && l.missed === 0 && !(l.kind === "criterion" && l.met === null) && <span className="muted">0</span>}
      </span>
    </li>
  );
}

export function PointsFlow({ b, compact = false }: { b: Breakdown; compact?: boolean }) {
  const losses = b.steps.filter((l) => l.lost > 0).length + b.adjustments.filter((l) => l.lost > 0).length;
  // In compact mode, only show steps where something happened (plus a summary line).
  const quiet = b.steps.filter((l) => l.done && l.lost === 0);
  const shownSteps = compact && b.steps.length > 4 ? b.steps.filter((l) => !(l.done && l.lost === 0)) : b.steps;
  // From the exact share, not the rounded lines, so 7 clean steps of 60 show +60, not +60.2.
  const quietGain = (quiet.length * b.pointsShare) / Math.max(1, b.steps.length);
  return (
    <div className="points-flow">
      <p className="muted small">
        {b.rubricShare > 0 ? `Steps make up ${b.pointsShare} of the 100 points and the rubric ${b.rubricShare}. ` : ""}
        Each error costs {fmt((b.perError * b.pointsShare) / 100)} and each hint {fmt((b.perHint * b.pointsShare) / 100)}.
        {!b.stepsRecorded && " This attempt didn't record which step each error or hint was on."}
      </p>
      <h4>Steps{losses === 0 && b.steps.every((l) => l.done) ? ": no points lost" : ""}</h4>
      <ul className="flow">
        {compact && shownSteps.length < b.steps.length && quiet.length > 0 && (
          <li className="flow-line met">
            <span className="flow-icon" aria-hidden>✓</span>
            <span className="flow-label">{quiet.length} step{quiet.length === 1 ? "" : "s"} done cleanly</span>
            <span className="flow-pts"><span className="pts-gain">+{fmt(Math.round(quietGain * 10) / 10)}</span></span>
          </li>
        )}
        {shownSteps.map((l) => <Line key={l.key} l={l} />)}
        {b.adjustments.map((l) => <Line key={l.key} l={l} />)}
      </ul>
      {b.rubric.length > 0 && (
        <>
          <h4>Rubric</h4>
          <ul className="flow">{b.rubric.map((l) => <Line key={l.key} l={l} />)}</ul>
          {b.rubric.some((l) => l.met === null) && (
            <p className="muted small">
              {b.rubricShare > 0
                ? "Until a trainer marks it, the other criteria share the rubric's points, so this score may change."
                : "Until a trainer marks the rubric, the score is the steps alone, so it may change."}
            </p>
          )}
        </>
      )}
      <p className="flow-total"><span>Score</span><b>{b.total} / 100</b></p>
    </div>
  );
}

const simCache = new Map<string, Promise<Simulation>>();

/** The breakdown for a saved attempt (loads the simulation for step names). */
export function AttemptPointsFlow({ attempt, compact }: { attempt: Attempt; compact?: boolean }) {
  const [titles, setTitles] = useState<string[] | null>(null);
  useEffect(() => {
    if (!simCache.has(attempt.simulationId)) simCache.set(attempt.simulationId, api.get(attempt.simulationId));
    simCache
      .get(attempt.simulationId)!
      .then((sim) => setTitles(stepTitles(sim, attempt.scenarioId, attempt.pathName, attempt.data ?? {})))
      .catch(() => setTitles([]));
  }, [attempt]);
  if (!titles) return <p className="muted small">Loading…</p>;
  return <PointsFlow b={breakdown(attempt, titles)} compact={compact} />;
}
