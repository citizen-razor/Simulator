/**
 * Quality: how builders check that simulations score properly (shared/health.ts).
 *   #/quality          every simulation's health at a glance
 *   #/quality/<simId>  automatic checks (every path auto-played), warning signs from results,
 *                      and recent attempts to review: each with its points breakdown and audit
 *                      trail; AI-judged marks can be corrected with a note.
 * Builders see attempts as "Learner A, B…"; Admin-Builders also see names.
 */
import { Fragment, useEffect, useState } from "react";
import type { Health, Level } from "../../shared/health";
import { api, type ReviewAttempt } from "../api";
import { TranscriptView } from "../components/ConversationPanel";
import { AttemptPointsFlow } from "../components/PointsFlow";

const STATUS: Record<Health["status"], { label: string; icon: string; cls: string }> = {
  healthy: { label: "Healthy", icon: "✓", cls: "good" },
  check: { label: "Worth checking", icon: "!", cls: "neutral" },
  problems: { label: "Problems", icon: "✕", cls: "bad" },
};
const LEVEL: Record<Level, { label: string; icon: string }> = {
  error: { label: "Problem", icon: "✕" },
  warning: { label: "Check", icon: "!" },
  info: { label: "Note", icon: "i" },
};

export default function Quality({ simulationId }: { simulationId?: string }) {
  return simulationId ? <SimQuality id={simulationId} /> : <Overview />;
}

function StatusBadge({ status }: { status: Health["status"] }) {
  const s = STATUS[status];
  return <span className={`status ${s.cls}`}><span aria-hidden>{s.icon}</span> {s.label}</span>;
}

function Overview() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.quality>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.quality().then(setRows).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="page">
      <h1>Quality</h1>
      <p className="muted">
        Is each simulation scoring properly? Every scenario path is played automatically and must finish at full points; results are checked for warning
        signs. Open a simulation to see the details and review individual attempts.
      </p>
      {error && <div className="alert error">{error}</div>}
      {!rows ? (
        !error && <p className="muted">Checking…</p>
      ) : !rows.length ? (
        <div className="empty"><p>No simulations yet.</p></div>
      ) : (
        <table className="results-table">
          <thead><tr><th>Simulation</th><th>Health</th><th>Problems</th><th>To check</th><th>Paths tested</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => (location.hash = `#/quality/${r.id}`)}>
                <td><a href={`#/quality/${r.id}`}>{r.title}</a></td>
                <td><StatusBadge status={r.status} /></td>
                <td>{r.errors || "–"}</td>
                <td>{r.warnings || "–"}</td>
                <td>{r.paths}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SimQuality({ id }: { id: string }) {
  const [title, setTitle] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.simQuality>> | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [scenario, setScenario] = useState("");
  const [onlyAi, setOnlyAi] = useState(false);
  const load = () => api.simQuality(id).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    api.get(id).then((s) => setTitle(s.title)).catch(() => undefined);
    load();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const replace = (a: ReviewAttempt) => setData((d) => d && { ...d, attempts: d.attempts.map((x) => (x.id === a.id ? a : x)) });
  const scenarios = data ? [...new Map(data.attempts.map((a) => [a.scenarioId, a.scenarioTitle])).entries()] : [];
  const shown = (data?.attempts ?? []).filter((a) => (!scenario || a.scenarioId === scenario) && (!onlyAi || a.grading?.rubric.some((c) => c.ai)));

  return (
    <div className="page">
      <p className="small"><a href="#/quality">← All simulations</a></p>
      <div className="row">
        <h1>{title || "Quality"}</h1>
        <span className="spacer" />
        <a className="btn" href={`#/play/${id}?test=1`}>🧪 Test it</a>
        <a className="btn" href={`#/performance/${id}`}>Performance</a>
        <a className="btn" href={`#/edit/${id}`}>Edit</a>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!data ? (
        !error && <p className="muted">Checking…</p>
      ) : (
        <>
          <section className="panel">
            <div className="row">
              <h2 className="tight">Automatic checks</h2>
              <span className="spacer" />
              <StatusBadge status={data.health.status} />
            </div>
            {data.health.paths.length > 0 && (
              <>
                <p className="muted small">Each path is played by a "perfect trainee" who does exactly what every step says. It should finish with no errors and full points.</p>
                <table className="results-table path-checks">
                  <thead><tr><th>Scenario</th><th>Path</th><th>Result</th></tr></thead>
                  <tbody>
                    {data.health.paths.map((p, i) => (
                      <tr key={i}>
                        <td>{p.scenario}</td>
                        <td>{p.path}</td>
                        <td>
                          <span className={`status ${p.ok ? "good" : p.score === null ? "bad" : "neutral"}`}>{p.ok ? "✓ Plays through" : p.score === null ? "✕ Can't be completed cleanly" : "! Check"}</span>
                          <div className="muted small">{p.detail}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {data.health.problems.length === 0 ? (
              <p className="small">No problems found.</p>
            ) : (
              <ul className="problems">
                {data.health.problems.filter((p) => !p.fromPath).map((p, i) => (
                  <li key={i} className={`problem ${p.level}`}>
                    <span className="problem-icon" aria-hidden>{LEVEL[p.level].icon}</span>
                    <span><b>{LEVEL[p.level].label}</b> · {p.where !== "Simulation" && <span className="muted">{p.where}: </span>}{p.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <h2 className="section">Review attempts</h2>
          <p className="muted small">
            Open an attempt to check its score by hand: the points breakdown, every action and how it was scored, and any conversation. If you disagree with an
            AI-judged mark, change it with a note; the score updates and the learner sees that a person reviewed it.
            {data.total > data.attempts.length && ` Showing the latest ${data.attempts.length} of ${data.total}.`}
          </p>
          <div className="date-range">
            {scenarios.length > 1 && (
              <label>
                Scenario
                <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                  <option value="">All</option>
                  {scenarios.map(([sid, t]) => <option key={sid} value={sid}>{t}</option>)}
                </select>
              </label>
            )}
            <label><input type="checkbox" checked={onlyAi} onChange={(e) => setOnlyAi(e.target.checked)} /> Only attempts with AI-judged marks</label>
          </div>
          {!shown.length ? (
            <div className="empty"><p>No attempts to review yet.</p></div>
          ) : (
            <table className="results-table">
              <thead><tr><th>Learner</th><th>Scenario</th><th>Mode</th><th>Score</th><th>Result</th><th>When</th></tr></thead>
              <tbody>
                {shown.map((a) => (
                  <Fragment key={a.id}>
                    <tr className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                      <td><b>{a.learner}</b>{a.name && <span className="muted small"> · {a.name}</span>}</td>
                      <td>{a.scenarioTitle}</td>
                      <td>{a.mode}{a.assisted && a.mode === "scenario" ? " (assisted)" : ""}</td>
                      <td><b>{a.score}</b>{a.grading?.rubric.some((c) => c.review) && <span className="badge subtle" title="A person corrected an AI mark">reviewed</span>}</td>
                      <td>{a.passed === null ? "–" : a.passed ? "✓ Pass" : "✕ Fail"}</td>
                      <td>{new Date(a.finishedAt).toLocaleString()} <span className="muted small">{open === a.id ? "▾" : "▸"}</span></td>
                    </tr>
                    {open === a.id && (
                      <tr className="detail">
                        <td colSpan={6}>
                          <div className="flow-wrap">
                            {a.grading?.rubric.some((c) => c.ai) && <AiReview attempt={a} onUpdated={replace} />}
                            <AttemptPointsFlow attempt={a} />
                            {a.conversation && <TranscriptView conversation={a.conversation} />}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

/** Check and correct the AI's marks on one attempt. */
function AiReview({ attempt, onUpdated }: { attempt: ReviewAttempt; onUpdated: (a: ReviewAttempt) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const criteria = attempt.grading!.rubric.filter((c) => c.ai);
  const save = async (criterionId: string, met: boolean) => {
    setBusy(true);
    setError("");
    try {
      onUpdated(await api.reviewMark(attempt.id, criterionId, met, note));
      setEditing(null);
      setNote("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="ai-review panel">
      <b>AI-judged marks</b>
      <p className="muted small">Read the conversation below, then confirm or correct each mark.</p>
      <ul className="flow">
        {criteria.map((c) => (
          <li key={c.id} className={`flow-line ${c.met ? "met" : "missed"}`}>
            <span className="flow-icon" aria-hidden>{c.met ? "✓" : "✕"}</span>
            <span className="flow-label">
              {c.label}
              {c.reason && <div className="flow-reason small">AI: {c.reason}</div>}
              {c.review && <div className="flow-review small">👤 Corrected: {c.review.note} <span className="muted">(AI said {c.review.originalMet ? "met" : "not met"})</span></div>}
              {editing === c.id && (
                <div className="review-form">
                  <textarea rows={2} maxLength={500} value={note} placeholder="Why? The learner sees this note." onChange={(e) => setNote(e.target.value)} aria-label="Review note" />
                  <div className="row">
                    <button className="btn sm" disabled={busy || !note.trim()} onClick={() => save(c.id, !c.met)}>Mark {c.met ? "not met" : "met"}</button>
                    <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                  </div>
                </div>
              )}
            </span>
            <span className="flow-pts">
              {editing !== c.id && <button className="link-btn add" onClick={() => { setEditing(c.id); setNote(""); }}>Change</button>}
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="text-error small">{error}</p>}
    </div>
  );
}
