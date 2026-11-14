/**
 * Assigning scenarios (#/assignments). Admin-Builders assign to anyone; leaders to people
 * in their reporting tree (the server enforces both). You see the assignments of people you
 * may see. Status comes from their attempts.
 */
import { useEffect, useMemo, useState } from "react";
import { assignmentStatus, byUrgency, localToday, REQUIREMENT_TEXT, Requirements, type Assignment, type AssignmentState, type Requirement } from "../../shared/assignments";
import type { Attempt, Simulation } from "../../shared/schema";
import { api, type DirectoryPerson, type SimSummary } from "../api";
import { AssignmentBadge, dueText, REQUIREMENT_SHORT } from "../components/AssignmentBits";
import { useAuth } from "../lib/auth";
import { reportingTree } from "../../shared/people";

export default function Assignments() {
  const auth = useAuth();
  const isAdmin = auth.isAdmin;
  const canAssign = auth.isAdmin || auth.isLeader;
  const [directory, setDirectory] = useState<DirectoryPerson[]>([]);
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [error, setError] = useState("");
  const [who, setWho] = useState("");
  const [stateFilter, setStateFilter] = useState<AssignmentState | "">("");

  const load = () =>
    Promise.all([api.assignments(), api.attempts(), api.list(), api.directory()])
      .then(([a, t, s, d]) => {
        setDirectory(d);
        setAssignments(a);
        setAttempts(t);
        setSims(s);
      })
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const today = localToday();
  const rows = useMemo(
    () =>
      (assignments ?? [])
        .map((assignment) => ({ assignment, status: assignmentStatus(assignment, attempts, today) }))
        .filter((r) => (!who || r.assignment.trainee.toLowerCase() === who.toLowerCase()) && (!stateFilter || r.status.state === stateFilter))
        .sort(byUrgency),
    [assignments, attempts, today, who, stateFilter],
  );
  // Who you may assign to: Admin-Builders, anyone active; leaders, their reporting tree.
  const assignable = useMemo(() => {
    if (!auth.user) return [];
    const tree = reportingTree(directory, auth.user.id);
    return directory.filter((p) => p.active && (isAdmin || tree.has(p.id))).sort((a, b) => a.name.localeCompare(b.name));
  }, [directory, auth.user, isAdmin]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of assignments ?? []) {
      const s = assignmentStatus(a, attempts, today).state;
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [assignments, attempts, today]);

  const remove = async (a: Assignment) => {
    if (!confirm(`Remove this assignment for ${a.trainee}? Their results are kept.`)) return;
    try {
      await api.deleteAssignment(a.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Assignments</h1>
          <p className="muted">
            Ask trainees to complete, pass or master a scenario by a date. Status updates from their results, including work they did
            on their own before it was assigned.
          </p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {canAssign && <AssignForm sims={sims} assignable={assignable} leader={!isAdmin} onCreated={load} />}

      {assignments && assignments.length > 0 && (
        <>
          <div className="row filter-row">
            <label className="field inline">
              <span>Trainee</span>
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Everyone</option>
                {[...new Set(assignments.map((a) => a.trainee))].sort().map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <div className="state-filters">
              {(["overdue", "due-soon", "awaiting", "open", "done"] as AssignmentState[]).map((s) => (
                <button key={s} className={`tag-toggle ${stateFilter === s ? "on" : ""}`} onClick={() => setStateFilter(stateFilter === s ? "" : s)}>
                  {{ overdue: "Overdue", "due-soon": "Due soon", awaiting: "Awaiting marking", open: "To do", done: "Done" }[s]} ({counts[s] ?? 0})
                </button>
              ))}
            </div>
          </div>
          <table className="results-table">
            <thead>
              <tr><th>Trainee</th><th>Scenario</th><th>Needs to</th><th>Due</th><th>Status</th><th>Attempts</th>{canAssign && <th />}</tr>
            </thead>
            <tbody>
              {rows.map(({ assignment: a, status }) => (
                <tr key={a.id}>
                  <td>{a.userId ? <a href={`#/progress/${encodeURIComponent(a.userId)}`}>{a.trainee}</a> : a.trainee}</td>
                  <td>
                    <b>{a.scenarioTitle}</b>
                    <div className="muted small">{a.simulationTitle}</div>
                    {a.note && <div className="small">“{a.note}”</div>}
                  </td>
                  <td title={REQUIREMENT_TEXT[a.requirement]}>{REQUIREMENT_SHORT[a.requirement]}</td>
                  <td className="small">{dueText(a.dueDate, status)}</td>
                  <td>
                    <AssignmentBadge status={status} />
                    {status.doneAt && (
                      <div className="muted small">
                        {new Date(status.doneAt).toLocaleDateString()}
                        {status.doneBeforeAssigned && " · already done before it was assigned"}
                      </div>
                    )}
                  </td>
                  <td>
                    {status.attempts}
                    {status.bestScore !== null && <div className="muted small">best {status.bestScore}</div>}
                  </td>
                  {canAssign && <td><button className="btn sm ghost danger" onClick={() => remove(a)} aria-label="Remove assignment">✕</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">Nothing matches these filters.</p>}
        </>
      )}
      {assignments?.length === 0 && <div className="empty"><p>No assignments yet.{canAssign ? "" : " Leaders and Admin-Builders create them."}</p></div>}
    </div>
  );
}

function AssignForm({ sims, assignable, leader, onCreated }: { sims: SimSummary[]; assignable: DirectoryPerson[]; leader: boolean; onCreated: () => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [simId, setSimId] = useState("");
  const [sim, setSim] = useState<Simulation | null>(null);
  const [scenarioId, setScenarioId] = useState("");
  const [requirement, setRequirement] = useState<Requirement>("pass");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setSim(null);
    setScenarioId("");
    if (simId) api.get(simId).then((s) => {
      setSim(s);
      setScenarioId(s.scenarios[0]?.id ?? "");
    }).catch((e) => setError(e.message));
  }, [simId]);


  const submit = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const created = await api.createAssignments({ userIds: chosen, simulationId: simId, scenarioId, requirement, dueDate: dueDate || null, note });
      setMsg(`Assigned to ${created.length} ${created.length === 1 ? "person" : "people"}.`);
      setChosen([]);
      setNote("");
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = chosen.length > 0 && simId && scenarioId;
  const nameOf = (id: string) => assignable.find((p) => p.id === id)?.name ?? id;
  return (
    <section className="panel assign-form">
      <h3>New assignment</h3>
      <div className="field">
        <span>People</span>
        <div className="tag-row">
          {chosen.map((id) => (
            <span key={id} className="tag">
              {nameOf(id)}
              <button className="link-btn" aria-label={`Remove ${nameOf(id)}`} onClick={() => setChosen(chosen.filter((x) => x !== id))}>✕</button>
            </span>
          ))}
          <select value="" aria-label="Add a person" onChange={(e) => e.target.value && setChosen([...chosen, e.target.value])}>
            <option value="">+ Add a person…</option>
            {assignable.filter((p) => !chosen.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {assignable.length > 1 && (
            <button type="button" className="link-btn add" onClick={() => setChosen(assignable.map((p) => p.id))}>
              {leader ? "Add my whole team" : "Add everyone"} ({assignable.length})
            </button>
          )}
        </div>
        <small className="muted">
          {leader ? "You can assign to anyone who reports to you, directly or further down." : "Admin-Builders can assign to anyone in the organisation."}
        </small>
      </div>
      <div className="field-grid">
        <label className="field">
          <span>Simulation</span>
          <select value={simId} onChange={(e) => setSimId(e.target.value)}>
            <option value="">Choose…</option>
            {sims.filter((s) => s.scenarios > 0).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Scenario</span>
          <select value={scenarioId} disabled={!sim} onChange={(e) => setScenarioId(e.target.value)}>
            {!sim && <option value="">Choose a simulation first</option>}
            {sim?.scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <label className="field">
          <span>They need to</span>
          <select value={requirement} onChange={(e) => setRequirement(e.target.value as Requirement)}>
            {Requirements.map((r) => <option key={r} value={r}>{REQUIREMENT_TEXT[r]}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Due date (optional)</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Note for the trainee (optional)</span>
        <input value={note} maxLength={500} placeholder="e.g. Needed before you start on the support desk" onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <div className="alert error">{error}</div>}
      {msg && <div className="alert info">{msg}</div>}
      <button className="btn primary" disabled={!ready || busy} onClick={submit}>
        {busy ? "Assigning…" : `Assign${chosen.length > 1 ? ` to ${chosen.length} people` : ""}`}
      </button>
    </section>
  );
}
