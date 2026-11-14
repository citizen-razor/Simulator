/**
 * Trainers assign scenarios to trainees (#/assignments). Creating and removing needs
 * admin mode; everyone can view. Status comes from the trainees' attempts.
 */
import { useEffect, useMemo, useState } from "react";
import { assignmentStatus, byUrgency, localToday, REQUIREMENT_TEXT, Requirements, type Assignment, type AssignmentState, type Requirement } from "../../shared/assignments";
import type { Attempt, Simulation } from "../../shared/schema";
import { api, type SimSummary } from "../api";
import { AdminBar } from "../components/AdminGate";
import { AssignmentBadge, dueText, REQUIREMENT_SHORT } from "../components/AssignmentBits";
import { useAdmin } from "../lib/admin";

export default function Assignments() {
  const { isAdmin } = useAdmin();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [error, setError] = useState("");
  const [who, setWho] = useState("");
  const [stateFilter, setStateFilter] = useState<AssignmentState | "">("");

  const load = () =>
    Promise.all([api.assignments(), api.attempts(), api.list()])
      .then(([a, t, s]) => {
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
  const knownTrainees = useMemo(
    () => [...new Set([...attempts.map((a) => a.trainee), ...(assignments ?? []).map((a) => a.trainee)].filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [attempts, assignments],
  );
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
            Ask trainees to complete, pass or master a scenario by a date. Status updates from their results; only attempts made after
            the assignment is given count.
          </p>
        </div>
      </div>
      <AdminBar what="assignments" />
      {error && <div className="alert error">{error}</div>}
      {isAdmin && <AssignForm sims={sims} knownTrainees={knownTrainees} onCreated={load} />}

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
              <tr><th>Trainee</th><th>Scenario</th><th>Needs to</th><th>Due</th><th>Status</th><th>Attempts</th>{isAdmin && <th />}</tr>
            </thead>
            <tbody>
              {rows.map(({ assignment: a, status }) => (
                <tr key={a.id}>
                  <td><a href={`#/progress/${encodeURIComponent(a.trainee)}`}>{a.trainee}</a></td>
                  <td>
                    <b>{a.scenarioTitle}</b>
                    <div className="muted small">{a.simulationTitle}</div>
                    {a.note && <div className="small">“{a.note}”</div>}
                  </td>
                  <td title={REQUIREMENT_TEXT[a.requirement]}>{REQUIREMENT_SHORT[a.requirement]}</td>
                  <td className="small">{dueText(a.dueDate, status)}</td>
                  <td>
                    <AssignmentBadge status={status} />
                    {status.doneAt && <div className="muted small">{new Date(status.doneAt).toLocaleDateString()}</div>}
                  </td>
                  <td>
                    {status.attempts}
                    {status.bestScore !== null && <div className="muted small">best {status.bestScore}</div>}
                    {status.earlierAttempts > 0 && (
                      <div className="muted small" title="Attempts from before this was assigned don't count toward it">+{status.earlierAttempts} earlier, not counted</div>
                    )}
                  </td>
                  {isAdmin && <td><button className="btn sm ghost danger" onClick={() => remove(a)} aria-label="Remove assignment">✕</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="muted">Nothing matches these filters.</p>}
        </>
      )}
      {assignments?.length === 0 && <div className="empty"><p>No assignments yet.{isAdmin ? "" : " An admin can create them."}</p></div>}
    </div>
  );
}

function AssignForm({ sims, knownTrainees, onCreated }: { sims: SimSummary[]; knownTrainees: string[]; onCreated: () => void }) {
  const [trainees, setTrainees] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState("");
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

  const addName = (raw: string) => {
    const names = raw.split(",").map((n) => n.trim()).filter(Boolean);
    setTrainees((t) => [...t, ...names.filter((n) => !t.some((x) => x.toLowerCase() === n.toLowerCase()))]);
    setNameDraft("");
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    setMsg("");
    const pending = nameDraft.trim() ? [...trainees, nameDraft.trim()] : trainees;
    try {
      const created = await api.createAssignments({ trainees: pending, simulationId: simId, scenarioId, requirement, dueDate: dueDate || null, note });
      setMsg(`Assigned to ${created.length} trainee${created.length === 1 ? "" : "s"}.`);
      setTrainees([]);
      setNameDraft("");
      setNote("");
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ready = (trainees.length > 0 || nameDraft.trim()) && simId && scenarioId;
  return (
    <section className="panel assign-form">
      <h3>New assignment</h3>
      <div className="field">
        <span>Trainees</span>
        <div className="tag-row">
          {trainees.map((t) => (
            <span key={t} className="tag">
              {t}
              <button className="link-btn" aria-label={`Remove ${t}`} onClick={() => setTrainees(trainees.filter((x) => x !== t))}>✕</button>
            </span>
          ))}
          <input
            list="known-trainees"
            value={nameDraft}
            placeholder="Type a name, press Enter"
            aria-label="Add trainee"
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addName(nameDraft);
              }
            }}
            onBlur={() => nameDraft.trim() && addName(nameDraft)}
          />
          <datalist id="known-trainees">{knownTrainees.map((t) => <option key={t} value={t} />)}</datalist>
        </div>
        <small className="muted">Use the same name the trainee enters when they play. Capital letters and spaces don't matter.</small>
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
        {busy ? "Assigning…" : `Assign${trainees.length > 1 ? ` to ${trainees.length} trainees` : ""}`}
      </button>
    </section>
  );
}
