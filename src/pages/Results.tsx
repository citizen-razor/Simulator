import { Fragment, useEffect, useMemo, useState } from "react";
import type { Attempt } from "../../shared/schema";
import { api } from "../api";
import { useAdmin } from "../lib/admin";
import { AdminBar } from "../components/AdminGate";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export default function Results({ simulationId }: { simulationId?: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [who, setWho] = useState<string>("__all");

  useEffect(() => {
    api.attempts(simulationId).then(setAttempts).catch((e) => setError(e.message));
  }, [simulationId]);

  const trainees = useMemo(() => [...new Set((attempts ?? []).map((a) => a.trainee))].sort(), [attempts]);
  const shown = useMemo(
    () =>
      (attempts ?? [])
        .filter((a) => who === "__all" || a.trainee === who)
        .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)),
    [attempts, who],
  );

  const byScenario = useMemo(() => {
    const groups = new Map<string, { title: string; sim: string; list: Attempt[] }>();
    for (const a of shown) {
      const key = `${a.simulationId}/${a.scenarioId}`;
      if (!groups.has(key)) groups.set(key, { title: a.scenarioTitle, sim: a.simulationTitle, list: [] });
      groups.get(key)!.list.push(a);
    }
    return [...groups.values()];
  }, [shown]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Results</h1>
          <p className="muted">
            Scores from Guided and Scenario runs. "Assisted" means guided mode was used during the attempt.
            {simulationId && <> <a href="#/results">Show all simulations</a></>}
          </p>
        </div>
        {trainees.length > 0 && (
          <label className="field inline">
            <span>Trainee</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="__all">Everyone</option>
              {trainees.map((t) => <option key={t} value={t}>{t || "(no name)"}</option>)}
            </select>
          </label>
        )}
      </div>
      {error && <div className="alert error">{error}</div>}
      {(attempts ?? []).some((a) => a.grading?.rubric.some((c) => c.manual)) && <AdminBar what="trainer-marked criteria" />}
      {attempts?.length === 0 && <div className="empty"><p>No attempts yet. Play a scenario to see results here.</p></div>}

      {byScenario.length > 0 && (
        <div className="card-grid stats-grid">
          {byScenario.map((g) => {
            const unassisted = g.list.filter((a) => !a.assisted && a.completed);
            const best = unassisted.length ? Math.max(...unassisted.map((a) => a.score)) : null;
            return (
              <div key={g.sim + g.title} className="panel">
                <div className="muted small">{g.sim}</div>
                <h3>{g.title}</h3>
                <div className="stats">
                  <div><span className="muted small">Attempts</span><b>{g.list.length}</b></div>
                  <div><span className="muted small">Completed</span><b>{Math.round((100 * g.list.filter((a) => a.completed).length) / g.list.length)}%</b></div>
                  <div><span className="muted small">Avg score</span><b>{Math.round(g.list.reduce((n, a) => n + a.score, 0) / g.list.length)}</b></div>
                  <div><span className="muted small">Best solo</span><b>{best ?? "–"}</b></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {shown.length > 0 && (
        <table className="results-table">
          <thead>
            <tr><th>When</th><th>Trainee</th><th>Simulation</th><th>Scenario</th><th>Mode</th><th>Result</th><th>Score</th><th>Pass</th><th>Errors</th><th>Hints</th><th>Time</th></tr>
          </thead>
          <tbody>
            {shown.map((a) => (
              <Fragment key={a.id}>
                <tr className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <td>{new Date(a.finishedAt).toLocaleString()}</td>
                  <td>
                    {a.trainee ? (
                      <a href={`#/progress/${encodeURIComponent(a.trainee)}`} onClick={(e) => e.stopPropagation()}>{a.trainee}</a>
                    ) : (
                      <span className="muted">–</span>
                    )}
                  </td>
                  <td>{a.simulationTitle}</td>
                  <td>{a.scenarioTitle}</td>
                  <td>{a.mode}{a.assisted && a.mode === "scenario" ? " (assisted)" : ""}</td>
                  <td>{a.completed ? "✓ Completed" : `${a.stepsCompleted}/${a.stepsTotal} steps`}</td>
                  <td><b>{a.score}</b></td>
                  <td><PassCell attempt={a} /></td>
                  <td>{a.errors}</td>
                  <td>{a.hintsUsed}</td>
                  <td>{fmt(a.durationSec)}</td>
                </tr>
                {open === a.id && (
                  <tr className="detail">
                    <td colSpan={11}>
                      {a.grading && <RubricDetail attempt={a} onUpdated={(u) => setAttempts((xs) => xs!.map((x) => (x.id === u.id ? u : x)))} />}
                      {a.data && (
                        <p className="small run-data">
                          <b>This run's data:</b>{" "}
                          {Object.entries(a.data).map(([k, v]) => <span key={k} className="chip">{k} = {v}</span>)}
                        </p>
                      )}
                      <b className="small">Mistakes</b>
                      {a.mistakes.length ? <ul>{a.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul> : <p className="muted">No mistakes recorded.</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function PassCell({ attempt: a }: { attempt: Attempt }) {
  if (!a.grading) return <span className="muted">–</span>;
  if (a.passed === null) return <span className="status neutral" title="A trainer needs to mark rubric items">⏳ To mark</span>;
  return a.passed ? <span className="status good">✓ Pass</span> : <span className="status bad">✕ Fail</span>;
}

/** The attempt's grading breakdown; admins can mark the criteria a trainer has to judge. */
function RubricDetail({ attempt: a, onUpdated }: { attempt: Attempt; onUpdated: (a: Attempt) => void }) {
  const { isAdmin } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const g = a.grading!;
  const mark = async (id: string, met: boolean | null) => {
    setBusy(true);
    setError("");
    try {
      onUpdated(await api.markAttempt(a.id, { [id]: met }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hasManual = g.rubric.some((c) => c.manual);
  return (
    <div className="rubric-detail">
      <p className="small">
        <b>{g.schemeName}</b> grading · points {g.pointsScore}
        {g.rubric.length > 0 && g.rubricWeight > 0 && ` (${100 - g.rubricWeight}%) + rubric (${g.rubricWeight}%)`} · pass mark {g.passScore}
        {g.overtimeSec > 0 && ` · ${fmt(g.overtimeSec)} over time`}
      </p>
      {g.rubric.length > 0 && (
        <ul className="checklist rubric-result">
          {g.rubric.map((c) => (
            <li key={c.id} className={c.met === true ? "met" : c.met === false ? "missed" : "pending"}>
              <span aria-hidden>{c.met === true ? "✓" : c.met === false ? "✕" : "⏳"}</span> {c.label}
              <span className="muted small"> · weight {c.weight}{c.manual ? " · trainer-marked" : " · automatic"}</span>
              {c.manual && isAdmin && (
                <span className="mark-buttons">
                  <button className={`btn sm ${c.met === true ? "primary" : ""}`} disabled={busy} onClick={() => mark(c.id, true)}>Met</button>
                  <button className={`btn sm ${c.met === false ? "danger" : ""}`} disabled={busy} onClick={() => mark(c.id, false)}>Not met</button>
                  {c.met !== null && <button className="btn sm ghost" disabled={busy} onClick={() => mark(c.id, null)}>Clear</button>}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {hasManual && !isAdmin && <p className="muted small">Unlock admin mode (top of this page) to mark trainer-marked criteria.</p>}
      {error && <p className="text-error small">{error}</p>}
    </div>
  );
}
