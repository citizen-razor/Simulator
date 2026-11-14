/**
 * Trainee progress. #/progress lists every named trainee; #/progress/<name> shows one
 * trainee's status per scenario, score trends, and the steps they struggle with.
 * All figures come from saved attempts (see shared/progress.ts for the definitions).
 */
import { useEffect, useMemo, useState } from "react";
import { MASTERY_SCORE, summarizeTrainee, summarizeTrainees, type ScenarioStatus } from "../../shared/progress";
import type { Attempt } from "../../shared/schema";
import { api } from "../api";
import { ScoreTrend } from "../components/ScoreTrend";

const STATUS: Record<ScenarioStatus, { icon: string; label: string; cls: string; help: string }> = {
  mastered: { icon: "✓", label: "Mastered", cls: "good", help: `Completed on their own with a score of ${MASTERY_SCORE} or more` },
  passed: { icon: "◐", label: "Passed", cls: "ok", help: `Completed on their own, but below ${MASTERY_SCORE}` },
  assisted: { icon: "◌", label: "With help", cls: "neutral", help: "Only completed with guided help so far" },
  incomplete: { icon: "○", label: "Not yet", cls: "neutral", help: "Attempted but not completed" },
};

const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString() : "–");

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="muted">–</span>;
  if (value === 0) return <span className="muted">±0</span>;
  return <span className={value > 0 ? "trend-up" : "trend-down"}>{value > 0 ? `▲ +${value}` : `▼ ${value}`}</span>;
}

export default function Progress({ name }: { name?: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.attempts().then(setAttempts).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!attempts) return <div className="page muted">Loading…</div>;
  return name ? <TraineeDetail name={name} attempts={attempts} /> : <Overview attempts={attempts} />;
}

function Overview({ attempts }: { attempts: Attempt[] }) {
  const trainees = useMemo(() => summarizeTrainees(attempts), [attempts]);
  const unnamed = attempts.filter((a) => !a.trainee).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Trainee progress</h1>
          <p className="muted">
            A scenario is <b>mastered</b> when a trainee completes it in Scenario mode, without guided help, scoring {MASTERY_SCORE} or more.
          </p>
        </div>
      </div>
      {trainees.length === 0 ? (
        <div className="empty">
          <p>No trainee results yet. When someone plays a Guided or Scenario run, they're asked for their name and their progress appears here.</p>
        </div>
      ) : (
        <table className="results-table">
          <thead>
            <tr><th>Trainee</th><th>Mastered</th><th>Avg solo score</th><th>Attempts</th><th>Practice time</th><th>Last active</th></tr>
          </thead>
          <tbody>
            {trainees.map((t) => (
              <tr key={t.name} className="clickable" onClick={() => (window.location.hash = `#/progress/${encodeURIComponent(t.name)}`)}>
                <td><a href={`#/progress/${encodeURIComponent(t.name)}`}><b>{t.name}</b></a></td>
                <td>{t.mastered} of {t.scenarios.length} attempted</td>
                <td>{t.avgSolo ?? <span className="muted">–</span>}</td>
                <td>{t.attempts}</td>
                <td>{fmtDuration(t.practiceSec)}</td>
                <td>{fmtDate(t.lastActive)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {unnamed > 0 && <p className="muted small">{unnamed} older attempt{unnamed > 1 ? "s" : ""} without a trainee name {unnamed > 1 ? "aren't" : "isn't"} included.</p>}
    </div>
  );
}

function TraineeDetail({ name, attempts }: { name: string; attempts: Attempt[] }) {
  const t = useMemo(() => summarizeTrainee(name, attempts), [name, attempts]);
  const recent = useMemo(
    () => attempts.filter((a) => a.trainee === name).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 10),
    [name, attempts],
  );
  if (t.attempts === 0) {
    return (
      <div className="page">
        <a href="#/progress">← All trainees</a>
        <div className="empty"><p>No attempts found for “{name}”.</p></div>
      </div>
    );
  }
  const guided = attempts.filter((a) => a.trainee === name && (a.mode === "guided" || a.assisted)).length;
  return (
    <div className="page">
      <a href="#/progress">← All trainees</a>
      <h1 className="trainee-name">{t.name}</h1>
      <p className="muted">Last active {fmtDate(t.lastActive)}</p>

      <div className="tiles">
        <div className="tile"><span className="muted small">Scenarios mastered</span><b>{t.mastered}<small> / {t.scenarios.length}</small></b></div>
        <div className="tile"><span className="muted small">Average solo score</span><b>{t.avgSolo ?? "–"}</b></div>
        <div className="tile"><span className="muted small">Attempts</span><b>{t.attempts}</b><span className="muted small">{guided} with guided help</span></div>
        <div className="tile"><span className="muted small">Practice time</span><b>{fmtDuration(t.practiceSec)}</b></div>
      </div>

      <h2 className="section">By scenario</h2>
      <table className="results-table progress-table">
        <thead>
          <tr><th>Scenario</th><th>Status</th><th>Scores over time</th><th>Best solo</th><th>Latest solo</th><th>Change</th><th>Attempts</th></tr>
        </thead>
        <tbody>
          {t.scenarios.map((sc) => {
            const st = STATUS[sc.status];
            return (
              <tr key={sc.key}>
                <td>
                  <b>{sc.scenarioTitle}</b>
                  <div className="muted small">{sc.simulationTitle}</div>
                </td>
                <td><span className={`status ${st.cls}`} title={st.help}>{st.icon} {st.label}</span></td>
                <td><ScoreTrend attempts={sc.attempts} /></td>
                <td>{sc.bestSolo ?? <span className="muted">–</span>}</td>
                <td>{sc.latestSolo ?? <span className="muted">–</span>}</td>
                <td><Trend value={sc.trend} /></td>
                <td>
                  {sc.attempts.length}
                  {sc.guidedRuns > 0 && <div className="muted small">{sc.guidedRuns} guided</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small legend-note">
        In the charts, <span className="legend-dot" /> solo runs (joined by a line), <span className="legend-dot hollow" /> runs with guided help,
        and the dashed line is the mastery score ({MASTERY_SCORE}). Hover a dot for details.
      </p>

      <h2 className="section">Where {t.name} struggles</h2>
      {t.trouble.length === 0 ? (
        <p className="muted">No errors or hints recorded yet{attempts.some((a) => a.trainee === name && a.troubleSteps.length === 0 && a.errors > 0) ? " (older attempts didn't record which step went wrong)" : ""}.</p>
      ) : (
        <ol className="trouble">
          {t.trouble.map((s) => (
            <li key={s.scenarioTitle + s.step}>
              <b>{s.step}</b> <span className="muted">in {s.scenarioTitle}</span>
              <span className="trouble-count">{s.count} error{s.count === 1 ? "" : "s"} or hint{s.count === 1 ? "" : "s"}</span>
            </li>
          ))}
        </ol>
      )}

      <h2 className="section">Recent attempts</h2>
      <table className="results-table">
        <thead><tr><th>When</th><th>Scenario</th><th>Mode</th><th>Result</th><th>Score</th></tr></thead>
        <tbody>
          {recent.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.finishedAt).toLocaleString()}</td>
              <td>{a.scenarioTitle}{a.pathName && <span className="muted small"> · {a.pathName}</span>}</td>
              <td>{a.mode}{a.assisted && a.mode === "scenario" ? " (assisted)" : ""}</td>
              <td>{a.completed ? "✓ Completed" : `${a.stepsCompleted}/${a.stepsTotal} steps`}</td>
              <td><b>{a.score}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small"><a href="#/results">All results</a></p>
    </div>
  );
}
