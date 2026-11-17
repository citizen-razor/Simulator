/**
 * A run's audit trail (shared/schema.ts AuditEvent): every action in order, how it was scored,
 * and what it cost, so a person can check a score step by step.
 */
import type { Breakdown } from "../../shared/breakdown";
import type { AuditEvent } from "../../shared/schema";

const OUTCOME: Record<AuditEvent["outcome"], { label: string; icon: string; tone: string }> = {
  step: { label: "Step done", icon: "✓", tone: "good" },
  error: { label: "Wrong control", icon: "✕", tone: "bad" },
  "wrong-value": { label: "Wrong value", icon: "✕", tone: "bad" },
  ignored: { label: "Not the next step (no penalty)", icon: "·", tone: "neutral" },
  hint: { label: "Hint", icon: "💡", tone: "warn" },
  free: { label: "Not scored", icon: "·", tone: "neutral" },
  guided: { label: "Switched to guided help", icon: "↪", tone: "warn" },
};

const fmt = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function AuditTrail({ log, b, live = false }: { log: AuditEvent[]; b: Pick<Breakdown, "perError" | "perHint" | "pointsShare">; live?: boolean }) {
  if (!log.length) {
    return <p className="muted small">{live ? "Nothing yet. Each action appears here with how it was scored." : "This attempt was saved before actions were recorded."}</p>;
  }
  const cost = (e: AuditEvent) =>
    e.outcome === "error" || e.outcome === "wrong-value" ? (b.perError * b.pointsShare) / 100 : e.outcome === "hint" ? (b.perHint * b.pointsShare) / 100 : 0;
  const rows = live ? [...log].reverse() : log;
  return (
    <ol className={`audit-trail ${live ? "live" : ""}`}>
      {rows.map((e, i) => {
        const o = OUTCOME[e.outcome];
        const c = cost(e);
        return (
          <li key={live ? log.length - i : i} className={`audit-${o.tone}`}>
            <span className="audit-time muted small">{clock(e.at)}</span>
            <span className="audit-icon" aria-hidden>{o.icon}</span>
            <span className="audit-body">
              <b>{o.label}</b>
              {e.target && <> · {e.target}</>}
              {e.value !== undefined && <> = <code>{e.value || "(empty)"}</code></>}
              {e.screen && <span className="muted small"> on {e.screen}</span>}
              {e.step && (
                <div className="muted small">
                  {e.outcome === "step" ? `Step ${e.stepNo}: ${e.step}` : `Expected step ${e.stepNo}: ${e.step}`}
                </div>
              )}
            </span>
            <span className="audit-pts">{c ? <span className="pts-loss">−{fmt(c)}</span> : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
