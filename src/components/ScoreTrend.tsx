/**
 * A small chart of one scenario's scores over a trainee's attempts.
 * - x: attempt number (oldest left); y: score 0–100
 * - solid dots joined by a line: solo Scenario-mode runs (what mastery is judged on)
 * - hollow dots: runs with guided help (shown, but not joined, since they aren't comparable)
 * - dashed line: the mastery score
 * Hovering a dot shows its date, mode and score. The same numbers appear in the table beside it.
 */
import { useState } from "react";
import { isSolo, MASTERY_SCORE } from "../../shared/progress";
import type { Attempt } from "../../shared/schema";

const W = 168;
const H = 44;
const PAD = 6;

export function ScoreTrend({ attempts }: { attempts: Attempt[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const x = (i: number) => (attempts.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (attempts.length - 1));
  const y = (score: number) => PAD + ((100 - score) * (H - 2 * PAD)) / 100;
  const soloPts = attempts.map((a, i) => ({ a, i })).filter(({ a }) => isSolo(a));
  const line = soloPts.map(({ a, i }) => `${x(i)},${y(a.score)}`).join(" ");
  const h = hover !== null ? attempts[hover] : null;

  return (
    <div className="trend">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Scores over ${attempts.length} attempts: ${attempts.map((a) => a.score).join(", ")}`}>
        <line className="trend-pass" x1={PAD} x2={W - PAD} y1={y(MASTERY_SCORE)} y2={y(MASTERY_SCORE)} />
        {soloPts.length > 1 && <polyline className="trend-line" points={line} />}
        {attempts.map((a, i) => (
          <g key={a.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle className={isSolo(a) ? "trend-dot" : "trend-dot hollow"} cx={x(i)} cy={y(a.score)} r={4} />
            {/* Larger invisible target so small dots are easy to hover. */}
            <circle cx={x(i)} cy={y(a.score)} r={9} fill="transparent" />
          </g>
        ))}
      </svg>
      {h && (
        <div className="trend-tip" style={{ left: x(hover!) }}>
          <b>{h.score}</b> · {isSolo(h) ? "solo" : "with guided help"}
          {h.completed ? "" : " · not finished"}
          <br />
          <span className="muted">{new Date(h.finishedAt).toLocaleDateString()}</span>
        </div>
      )}
    </div>
  );
}
