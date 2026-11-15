/**
 * A trainee's own assignments (#/my), most urgent first, with a Start button for each.
 * Shows the signed-in person's own assignments.
 */
import { useEffect, useMemo, useState } from "react";
import { assignmentStatus, byUrgency, localToday, REQUIREMENT_TEXT, type Assignment } from "../../shared/assignments";
import type { Attempt } from "../../shared/schema";
import { api } from "../api";
import { AssignmentBadge, dueText } from "../components/AssignmentBits";
import { useAuth } from "../lib/auth";

export default function MyTraining() {
  const auth = useAuth();
  const me = auth.user!;
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    // Leaders also receive their team's assignments; this page is just your own.
    Promise.all([api.assignments(), api.attempts()])
      .then(([a, t]) => {
        setAssignments(a.filter((x) => x.userId === me.id));
        setAttempts(t.filter((x) => x.userId === me.id));
      })
      .catch((e) => setError(e.message));
  }, [me.id]);

  const today = localToday();
  const rows = useMemo(
    () => (assignments ?? []).map((assignment) => ({ assignment, status: assignmentStatus(assignment, attempts, today) })).sort(byUrgency),
    [assignments, attempts, today],
  );

  const todo = rows.filter((r) => r.status.state !== "done");
  const done = rows.filter((r) => r.status.state === "done");
  return (
    <div className="page narrow">
      <div className="page-head">
        <div>
          <h1>My training</h1>
          <p className="muted">What's been assigned to you, most urgent first.</p>
        </div>
        <a className="btn" href={`#/progress/${me.id}`}>My progress</a>
      </div>
      {error && <div className="alert error">{error}</div>}
      {!assignments ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="empty"><p>Nothing assigned to you yet. You can still practise anything in the <a href="#/">Library</a>.</p></div>
      ) : (
        <>
          <h2 className="section">To do ({todo.length})</h2>
          {todo.length === 0 && <p className="muted">All caught up. 🎉</p>}
          <div className="assignment-list">
            {todo.map(({ assignment: a, status }) => (
              <article key={a.id} className={`panel assignment ${status.state}`}>
                <div className="assignment-main">
                  <div className="row tight-top"><AssignmentBadge status={status} /><span className="muted small">{dueText(a.dueDate, status)}</span></div>
                  <h3>{a.scenarioTitle}</h3>
                  <p className="muted small">{a.simulationTitle} · {REQUIREMENT_TEXT[a.requirement]}</p>
                  {a.note && <p className="small">“{a.note}”</p>}
                  {status.attempts > 0 && <p className="muted small">{status.attempts} attempt{status.attempts === 1 ? "" : "s"} so far · best {status.bestScore}</p>}
                </div>
                <div className="assignment-actions">
                  <a className="btn primary" href={`#/play/${a.simulationId}?mode=scenario&scenario=${encodeURIComponent(a.scenarioId)}&assignment=${a.id}`}>Start</a>
                  <a className="btn ghost sm" href={`#/play/${a.simulationId}?mode=guided&scenario=${encodeURIComponent(a.scenarioId)}&assignment=${a.id}`}>Practise with guidance</a>
                </div>
              </article>
            ))}
          </div>
          {done.length > 0 && (
            <>
              <h2 className="section">Done ({done.length})</h2>
              <div className="assignment-list">
                {done.map(({ assignment: a, status }) => (
                  <article key={a.id} className="panel assignment done">
                    <div className="assignment-main">
                      <div className="row tight-top"><AssignmentBadge status={status} /><span className="muted small">on {new Date(status.doneAt!).toLocaleDateString()}{status.doneBeforeAssigned ? ", before it was assigned" : ""}</span></div>
                      <h3>{a.scenarioTitle}</h3>
                      <p className="muted small">{a.simulationTitle} · best score {status.bestScore}</p>
                    </div>
                    <div className="assignment-actions">
                      <a className="btn ghost sm" href={`#/play/${a.simulationId}?mode=scenario&scenario=${encodeURIComponent(a.scenarioId)}`}>Practise again</a>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
