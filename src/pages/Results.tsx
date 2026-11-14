import { Fragment, useEffect, useMemo, useState } from "react";
import type { Attempt } from "../../shared/schema";
import { api } from "../api";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export default function Results({ simulationId }: { simulationId?: string }) {
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api.attempts(simulationId).then(setAttempts).catch((e) => setError(e.message));
  }, [simulationId]);

  const byScenario = useMemo(() => {
    const groups = new Map<string, { title: string; sim: string; list: Attempt[] }>();
    for (const a of attempts ?? []) {
      const key = `${a.simulationId}/${a.scenarioId}`;
      if (!groups.has(key)) groups.set(key, { title: a.scenarioTitle, sim: a.simulationTitle, list: [] });
      groups.get(key)!.list.push(a);
    }
    return [...groups.values()];
  }, [attempts]);

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
      </div>
      {error && <div className="alert error">{error}</div>}
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

      {attempts && attempts.length > 0 && (
        <table className="results-table">
          <thead>
            <tr><th>When</th><th>Simulation</th><th>Scenario</th><th>Mode</th><th>Result</th><th>Score</th><th>Errors</th><th>Hints</th><th>Time</th></tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <Fragment key={a.id}>
                <tr className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)}>
                  <td>{new Date(a.finishedAt).toLocaleString()}</td>
                  <td>{a.simulationTitle}</td>
                  <td>{a.scenarioTitle}</td>
                  <td>{a.mode}{a.assisted && a.mode === "scenario" ? " (assisted)" : ""}</td>
                  <td>{a.completed ? "✓ Completed" : `${a.stepsCompleted}/${a.stepsTotal} steps`}</td>
                  <td><b>{a.score}</b></td>
                  <td>{a.errors}</td>
                  <td>{a.hintsUsed}</td>
                  <td>{fmt(a.durationSec)}</td>
                </tr>
                {open === a.id && (
                  <tr className="detail">
                    <td colSpan={9}>
                      {a.mistakes.length ? <ul>{a.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul> : <span className="muted">No mistakes recorded.</span>}
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
