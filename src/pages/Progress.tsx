/**
 * Progress. #/progress lists the people you may see (Admin-Builders: everyone; leaders:
 * their reporting tree); #/progress/<userId> shows one person. The server only sends
 * attempts you may see; this page keys them by person (account id).
 * trainee's status per scenario, score trends, and the steps they struggle with.
 * All figures come from saved attempts (see shared/progress.ts for the definitions).
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { MASTERY_SCORE, summarizeTrainee, topicProgress, type ScenarioStatus } from "../../shared/progress";
import type { Taxonomy } from "../../shared/library";
import { assignmentStatus, byUrgency, localToday, type Assignment } from "../../shared/assignments";
import { canView, reportingTree } from "../../shared/people";
import { useAuth } from "../lib/auth";
import type { DirectoryPerson } from "../api";
import { AssignmentBadge, dueText, REQUIREMENT_SHORT } from "../components/AssignmentBits";
import type { Attempt } from "../../shared/schema";
import { api } from "../api";
import { ScoreTrend } from "../components/ScoreTrend";
import { AttemptPointsFlow } from "../components/PointsFlow";
import { TranscriptView } from "../components/ConversationPanel";
import { Redirect } from "../components/Redirect";

const STATUS: Record<ScenarioStatus, { icon: string; label: string; cls: string; help: string }> = {
  mastered: { icon: "✓", label: "Mastered", cls: "good", help: "Completed on their own, at or above the grading scheme's mastery mark" },
  passed: { icon: "◐", label: "Passed", cls: "ok", help: "Completed on their own, but below the mastery mark" },
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

export default function Progress({ userId }: { userId?: string }) {
  const auth = useAuth();
  const [directory, setDirectory] = useState<DirectoryPerson[] | null>(null);
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [error, setError] = useState("");
  const [simTags, setSimTags] = useState<Record<string, string[]>>({});
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ topics: [] });
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  useEffect(() => {
    api.assignments().then(setAssignments).catch(() => undefined);
    api.directory().then(setDirectory).catch(() => setDirectory([]));
    api.attempts().then(setAttempts).catch((e) => setError(e.message));
    api.list().then((sims) => setSimTags(Object.fromEntries(sims.map((s) => [s.id, s.tagIds])))).catch(() => undefined);
    api.taxonomy().then(setTaxonomy).catch(() => undefined);
  }, []);

  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!attempts || !directory || !auth.user) return <div className="page muted">Loading…</div>;
  // Key everything by account id; the progress maths groups by the "trainee" field.
  const keyed = attempts.filter((a) => a.userId).map((a) => ({ ...a, trainee: a.userId! }));
  const keyedAssignments = assignments.filter((a) => a.userId).map((a) => ({ ...a, trainee: a.userId! }));
  const nameOf = (id: string) => directory.find((p) => p.id === id)?.name ?? "Unknown";

  if (userId) {
    if (!canView({ id: auth.user.id, roles: auth.roles }, directory, userId)) {
      return <Redirect to={`#/progress/${auth.user.id}`} />;
    }
    return (
      <TraineeDetail
        name={userId}
        displayName={nameOf(userId)}
        attempts={keyed}
        simTags={simTags}
        taxonomy={taxonomy}
        assignments={keyedAssignments.filter((a) => a.trainee === userId)}
        canSeeOthers={auth.isAdmin || auth.isLeader}
      />
    );
  }
  if (!auth.isAdmin && !auth.isLeader) return <Redirect to={`#/progress/${auth.user.id}`} />;
  const team = auth.isAdmin
    ? directory.filter((p) => p.active && p.id !== auth.user!.id)
    : directory.filter((p) => reportingTree(directory, auth.user!.id).has(p.id));
  return <Overview people={team} attempts={keyed} assignments={keyedAssignments} isAdmin={auth.isAdmin} myId={auth.user.id} />;
}

function Overview({ people, attempts, assignments, isAdmin, myId }: { people: DirectoryPerson[]; attempts: Attempt[]; assignments: Assignment[]; isAdmin: boolean; myId: string }) {
  // Everyone you may see, including people who haven't tried anything yet.
  const trainees = useMemo(
    () =>
      people
        .map((p) => ({ ...summarizeTrainee(p.id, attempts), display: p.name }))
        .sort((a, b) => b.lastActive.localeCompare(a.lastActive) || a.display.localeCompare(b.display)),
    [people, attempts],
  );
  const today = localToday();
  const assignmentSummary = (name: string) => {
    const mine = assignments.filter((a) => a.trainee === name).map((a) => assignmentStatus(a, attempts, today));
    if (!mine.length) return <span className="muted">–</span>;
    const done = mine.filter((s) => s.state === "done").length;
    const overdue = mine.filter((s) => s.state === "overdue").length;
    return (
      <>
        {done} of {mine.length} done
        {overdue > 0 && <span className="status bad small-status">{overdue} overdue</span>}
      </>
    );
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{isAdmin ? "Progress" : "My team"}</h1>
          <p className="muted">
            {isAdmin ? "Everyone in the organisation." : "Everyone who reports to you, directly or further down."} A scenario is{" "}
            <b>mastered</b> when it's completed in Scenario mode, without guided help, at or above its grading scheme's mastery mark
            ({MASTERY_SCORE} with Standard grading).
          </p>
        </div>
        <a className="btn" href={`#/progress/${myId}`}>My progress</a>
      </div>
      {trainees.length === 0 ? (
        <div className="empty">
          <p>{isAdmin ? "Nobody else in the organisation yet. Add people on the People page." : "Nobody reports to you yet."}</p>
        </div>
      ) : (
        <table className="results-table">
          <thead>
            <tr><th>Trainee</th><th>Assignments</th><th>Mastered</th><th>Avg solo score</th><th>Attempts</th><th>Practice time</th><th>Last active</th></tr>
          </thead>
          <tbody>
            {trainees.map((t) => (
              <tr key={t.name} className="clickable" onClick={() => (window.location.hash = `#/progress/${encodeURIComponent(t.name)}`)}>
                <td><a href={`#/progress/${encodeURIComponent(t.name)}`}><b>{t.display}</b></a>{t.attempts === 0 && <div className="muted small">No attempts yet</div>}</td>
                <td>{assignmentSummary(t.name)}</td>
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
    </div>
  );
}

function TraineeDetail({ name, displayName, attempts, simTags, taxonomy, assignments, canSeeOthers }: {
  /** The person's account id (attempts are keyed by it). */
  name: string;
  displayName: string;
  attempts: Attempt[];
  simTags: Record<string, string[]>;
  taxonomy: Taxonomy;
  assignments: Assignment[];
  /** Leaders and Admin-Builders get links back to everyone and to Results. */
  canSeeOthers: boolean;
}) {
  const today = localToday();
  const [open, setOpen] = useState<string | null>(null);
  const assigned = useMemo(
    () => assignments.map((assignment) => ({ assignment, status: assignmentStatus(assignment, attempts, today) })).sort(byUrgency),
    [assignments, attempts, today],
  );
  const t = useMemo(() => summarizeTrainee(name, attempts), [name, attempts]);
  const byTopic = useMemo(() => topicProgress(t, simTags, taxonomy.topics), [t, simTags, taxonomy]);
  const recent = useMemo(
    () => attempts.filter((a) => a.trainee === name).sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).slice(0, 10),
    [name, attempts],
  );
  if (t.attempts === 0) {
    return (
      <div className="page">
        {canSeeOthers && <a href="#/progress">← All trainees</a>}
        <div className="empty"><p>{displayName} hasn't attempted any scenarios yet.</p></div>
      </div>
    );
  }
  const guided = attempts.filter((a) => a.trainee === name && (a.mode === "guided" || a.assisted)).length;
  return (
    <div className="page">
      {canSeeOthers && <a href="#/progress">← All trainees</a>}
      <h1 className="trainee-name">{displayName}</h1>
      <p className="muted">Last active {fmtDate(t.lastActive)}</p>

      <div className="tiles">
        <div className="tile"><span className="muted small">Scenarios mastered</span><b>{t.mastered}<small> / {t.scenarios.length}</small></b></div>
        <div className="tile"><span className="muted small">Average solo score</span><b>{t.avgSolo ?? "–"}</b></div>
        <div className="tile"><span className="muted small">Attempts</span><b>{t.attempts}</b><span className="muted small">{guided} with guided help</span></div>
        <div className="tile"><span className="muted small">Practice time</span><b>{fmtDuration(t.practiceSec)}</b></div>
      </div>

      {assigned.length > 0 && (
        <>
          <h2 className="section">Assignments</h2>
          <table className="results-table">
            <thead><tr><th>Scenario</th><th>Needs to</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {assigned.map(({ assignment: a, status }) => (
                <tr key={a.id}>
                  <td><b>{a.scenarioTitle}</b><div className="muted small">{a.simulationTitle}</div></td>
                  <td>{REQUIREMENT_SHORT[a.requirement]}</td>
                  <td className="small">{dueText(a.dueDate, status)}</td>
                  <td><AssignmentBadge status={status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {byTopic.length > 0 && (
        <>
          <h2 className="section">By topic</h2>
          <div className="topic-bars">
            {byTopic.map((tp) => (
              <div key={tp.topicId} className="topic-bar">
                <span className="topic-bar-name">{tp.topicName}</span>
                <div className="progress" role="img" aria-label={`${tp.mastered} of ${tp.attempted} mastered`}>
                  <span style={{ width: `${(100 * tp.mastered) / tp.attempted}%` }} />
                </div>
                <span className="muted small">{tp.mastered} of {tp.attempted} mastered</span>
              </div>
            ))}
          </div>
        </>
      )}

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
        and the dashed line is the mastery mark. Hover a dot for details.
      </p>

      <h2 className="section">Where {displayName} struggles</h2>
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
      <p className="muted small">Click an attempt to see where its points were gained and lost.</p>
      <table className="results-table">
        <thead><tr><th>When</th><th>Scenario</th><th>Mode</th><th>Result</th><th>Score</th></tr></thead>
        <tbody>
          {recent.map((a) => (
            <Fragment key={a.id}>
              <tr className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                <td>{new Date(a.finishedAt).toLocaleString()}</td>
                <td>{a.scenarioTitle}{a.pathName && <span className="muted small"> · {a.pathName}</span>}</td>
                <td>{a.mode}{a.assisted && a.mode === "scenario" ? " (assisted)" : ""}</td>
                <td>{a.completed ? "✓ Completed" : `${a.stepsCompleted}/${a.stepsTotal} steps`}</td>
                <td><b>{a.score}</b> <span className="muted small">{open === a.id ? "▾" : "▸"}</span></td>
              </tr>
              {open === a.id && (
                <tr className="detail">
                  <td colSpan={5}>
                    <div className="flow-wrap"><AttemptPointsFlow attempt={a} /></div>
                    {a.conversation && <div className="flow-wrap"><TranscriptView conversation={a.conversation} /></div>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {canSeeOthers && <p className="muted small"><a href="#/results">All results</a></p>}
    </div>
  );
}
