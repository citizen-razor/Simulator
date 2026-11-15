import { useCallback, useEffect, useRef, useState } from "react";
import {
  createSession,
  currentStep,
  findElement,
  getScenario,
  getScreen,
  interact,
  interpolate,
  leadingPath,
  newId,
  scoreSession,
  switchMode,
  takeHint,
  type Feedback,
  type InteractionEvent,
  type Mode,
  type SessionState,
} from "../../shared/engine";
import { MAIN_PATH_ID, scenarioPaths, type Simulation, type SimElement, type Step, type Transcript } from "../../shared/schema";
import { activeConversation, conversationOnly, fill } from "../../shared/conversation";
import { ConversationPanel } from "../components/ConversationPanel";
import { api } from "../api";
import { PlayScreen } from "../components/ScreenView";
import { navigate } from "../router";
import { activeRubric, evaluateObjectives, finalScore as combineScore, gradeSession, resolveScheme, settleUnmarked, timeLeft, type GradeResult } from "../../shared/grading";
import { STANDARD_SCHEME, type GradingScheme } from "../../shared/library";
import { sessionPersonaVariables, type PersonaLibrary } from "../../shared/personas";
import { meetsRequirement, REQUIREMENT_TEXT, type Assignment } from "../../shared/assignments";
import { useAuth } from "../lib/auth";
import { PointsFlow, stepTitles } from "../components/PointsFlow";
import { breakdown } from "../../shared/breakdown";

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "open", label: "Open world", blurb: "Explore freely. Nothing is scored." },
  { id: "guided", label: "Guided", blurb: "Step-by-step coaching. Wrong moves are blocked." },
  { id: "scenario", label: "Scenario", blurb: "Complete the goal on your own. Scored." },
];

interface Toast extends Feedback {
  id: number;
}

function formatTime(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function recordedStep(el: SimElement, value?: string): Step {
  const label = el.label || el.id;
  if (value === undefined) return { id: newId("step"), elementId: el.id, instruction: `Click "${label}".`, expect: "any" };
  if (el.kind === "select") return { id: newId("step"), elementId: el.id, instruction: `Set ${label} to "${value}".`, expect: "eq", value };
  if (el.kind === "checkbox") {
    return { id: newId("step"), elementId: el.id, instruction: `${value === "true" ? "Check" : "Uncheck"} "${label}".`, expect: "eq", value };
  }
  return { id: newId("step"), elementId: el.id, instruction: `Fill in ${label}.`, hint: value ? `e.g. "${value}"` : undefined, expect: "any" };
}

export default function Player({ id, query }: { id: string; query: URLSearchParams }) {
  const recordInto = query.get("record");
  const recordPath = query.get("path") || MAIN_PATH_ID;
  const [sim, setSim] = useState<Simulation | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>(recordInto ? "open" : ((query.get("mode") as Mode) || "open"));
  const [session, setSession] = useState<SessionState | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showHotspots, setShowHotspots] = useState(false);
  const [showState, setShowState] = useState(false);
  const [hint, setHint] = useState("");
  const [summary, setSummary] = useState<null | { completed: boolean; grade: GradeResult; durationSec: number; judging?: boolean }>(null);
  // Conversation with the AI customer (scenarios that have one).
  const [transcript, setTranscript] = useState<Transcript>([]);
  const [convBusy, setConvBusy] = useState(false);
  const [convFailed, setConvFailed] = useState(false);
  const [customerLeft, setCustomerLeft] = useState(false);
  const [wrapUp, setWrapUp] = useState(false);
  const runRef = useRef(0);
  const [schemes, setSchemes] = useState<GradingScheme[]>([STANDARD_SCHEME]);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [personaLib, setPersonaLib] = useState<PersonaLibrary>({ templates: [], personas: [] });
  /** After a run launched from an assignment: did it satisfy it? (null = awaiting marking) */
  const [assignmentMet, setAssignmentMet] = useState<boolean | null | undefined>(undefined);
  const [recording, setRecording] = useState<Step[]>([]);
  const auth = useAuth();
  // Attempts are saved under the signed-in account (the server sets this; it's sent for display).
  const trainee = auth.user?.name ?? "";
  const [, tick] = useState(0);
  const toastId = useRef(0);

  useEffect(() => {
    api.grading().then((g) => setSchemes(g.schemes)).catch(() => undefined);
    const asgId = query.get("assignment");
    if (asgId) api.assignment(asgId).then(setAssignment).catch(() => undefined);
    // Personas fill the run's variables, so they load before the first session starts.
    Promise.all([api.get(id), api.personas().catch(() => ({ templates: [], personas: [] }) as PersonaLibrary)])
      .then(([s, lib]) => {
        setSim(s);
        setPersonaLib(lib);
        const want = recordInto ?? query.get("scenario");
        const scenarioId = getScenario(s, want)?.id ?? ((query.get("mode") ?? "open") !== "open" ? s.scenarios[0]?.id ?? null : null);
        setSession(createSession(s, scenarioId, Date.now(), undefined, sessionPersonaVariables(s, scenarioId, lib)));
        if (!scenarioId && !recordInto) setMode("open");
      })
      .catch((e) => setError(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Timer refresh while a scored run is in progress.
  useEffect(() => {
    if (mode === "open" || !session?.scenarioId || session.finished) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [mode, session?.scenarioId, session?.finished]);

  const convScenario = sim && session ? getScenario(sim, session.scenarioId) : null;
  const conv = mode !== "open" && !recordInto ? activeConversation(convScenario) : null;

  /** Ask the customer for their next message, given the conversation so far. */
  const askCustomer = (t: Transcript) => {
    if (!sim || !session || !convScenario) return;
    const run = session.startedAt;
    setConvBusy(true);
    setConvFailed(false);
    api
      .conversationReply({ simulationId: sim.id, scenarioId: convScenario.id, transcript: t, vars: session.generated })
      .then((r) => {
        if (runRef.current !== run) return; // a newer run started meanwhile
        setTranscript([...t, { from: "customer", text: r.say }]);
        if (r.ended) setCustomerLeft(true);
      })
      .catch((e) => {
        if (runRef.current !== run) return;
        setConvFailed(true);
        pushToasts([{ tone: "error", text: e.message }]);
      })
      .finally(() => runRef.current === run && setConvBusy(false));
  };

  // Each new run starts a fresh conversation: the customer's opening line, or Claude opens in character.
  // (In development, React starts the page twice, so you may see two opening requests; the
  // first run's reply is ignored. The built app makes one.)
  useEffect(() => {
    runRef.current = session?.startedAt ?? 0;
    setTranscript([]);
    setCustomerLeft(false);
    setWrapUp(false);
    setConvFailed(false);
    setConvBusy(false);
    if (!conv || !session) return;
    if (conv.opening.trim()) setTranscript([{ from: "customer", text: fill(conv.opening, session.vars) }]);
    else askCustomer([]);
  }, [session?.startedAt, !!conv]); // eslint-disable-line react-hooks/exhaustive-deps

  const pushToasts = useCallback((fb: Feedback[]) => {
    if (!fb.length) return;
    const items = fb.map((f) => ({ ...f, id: ++toastId.current }));
    setToasts((t) => [...t, ...items].slice(-4));
    for (const it of items) setTimeout(() => setToasts((t) => t.filter((x) => x.id !== it.id)), it.tone === "error" ? 5000 : 3000);
  }, []);

  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!sim || !session) return <div className="page muted">Loading…</div>;

  const scenario = getScenario(sim, session.scenarioId);
  const screen = getScreen(sim, session.screenId) ?? sim.screens[0];
  const step = mode === "open" ? null : currentStep(sim, session);
  const stepTarget = step ? findElement(sim, step.elementId) : null;
  const scheme = resolveScheme(sim, session.scenarioId, schemes);
  const score = scoreSession(sim, session, Date.now(), scheme.points);
  const clock = timeLeft(session, scheme);
  const objectives = mode === "open" && !recordInto ? evaluateObjectives(sim, session, scheme) : [];

  /** A fresh run: new random values, this scenario's personas. */
  const newRun = (scenarioId: string | null) => createSession(sim, scenarioId, Date.now(), undefined, sessionPersonaVariables(sim, scenarioId, personaLib));

  const finish = async (s: SessionState, completed: boolean, m: Mode) => {
    const sc = getScenario(sim, s.scenarioId);
    const convNow = m !== "open" && !recordInto ? activeConversation(sc) : null;
    // A conversation-only scenario is complete when the learner ends the conversation.
    if (convNow && sc && conversationOnly(sc) && completed !== false) {
      s = { ...s, completed: true, finished: true, finishedAt: s.finishedAt ?? Date.now() };
      completed = true;
      setSession(s);
    }
    const result = scoreSession(sim, s, Date.now(), scheme.points);
    let grade = gradeSession(sim, s, scheme);
    const toJudge = grade.rubric.some((c) => c.ai);
    setSummary({ completed, grade, durationSec: result.durationSec, judging: toJudge });
    if (toJudge && sc) {
      try {
        const { results } = await api.conversationJudge({ simulationId: sim.id, scenarioId: sc.id, transcript, vars: s.generated });
        const rubric = grade.rubric.map((c) => {
          const r = results.find((x) => x.id === c.id);
          return r ? { ...c, met: r.met, reason: r.reason } : c;
        });
        grade = { ...grade, rubric, ...combineScore({ ...grade, rubric }, completed) };
      } catch (e) {
        pushToasts([{ tone: "error", text: `Couldn't check the conversation (${(e as Error).message}). Those criteria are left out of this score.` }]);
      }
      // Anything the AI couldn't judge is left out, so the result never waits.
      const settled = settleUnmarked({ grading: grade, completed, score: grade.score, passed: grade.passed }, { manual: false });
      grade = { ...settled.grading!, score: settled.score, passed: settled.passed, pendingManual: settled.grading!.rubric.filter((c) => c.met === null).length };
      setSummary({ completed, grade, durationSec: result.durationSec });
    }
    if (!sc || m === "open" || recordInto) return;
    const { score: finalScore, passed, pendingManual: _pending, ...grading } = grade;
    api
      .addAttempt({
        trainee,
        simulationId: sim.id,
        simulationTitle: sim.title,
        scenarioId: sc.id,
        scenarioTitle: sc.title,
        mode: m === "guided" ? "guided" : "scenario",
        assisted: s.assisted || m === "guided",
        completed,
        score: finalScore,
        passed,
        grading,
        errors: s.errors,
        hintsUsed: s.hintsUsed,
        durationSec: result.durationSec,
        stepsCompleted: result.stepsCompleted,
        stepsTotal: result.stepsTotal,
        pathName: sc.alternatePaths.length ? result.pathName : "",
        mistakes: s.mistakes,
        troubleSteps: s.troubleSteps,
        penalties: s.penalties,
        conversation: convNow ? { channel: convNow.channel, customer: s.vars[`${convNow.role}.name`] || "Customer", messages: transcript } : undefined,
        data: Object.keys(s.generated).length ? s.generated : undefined,
        seed: Object.keys(s.generated).length ? s.seed : undefined,
        finishedAt: new Date().toISOString(),
      })
      .then((saved) => {
        if (assignment && assignment.scenarioId === sc.id) setAssignmentMet(meetsRequirement(saved, assignment.requirement));
      })
      .catch((e) => pushToasts([{ tone: "error", text: `Couldn't save result: ${e.message}` }]));
  };

  const handle = (ev: InteractionEvent) => {
    if (summary) return;
    if (recordInto) {
      const found = findElement(sim, ev.elementId);
      if (found) setRecording((r) => [...r, recordedStep(found.element, ev.type === "commit" ? ev.value : undefined)]);
    }
    const r = interact(sim, session, mode, ev);
    setSession(r.state);
    pushToasts(r.feedback);
    if (r.completedStep || r.blocked) setHint("");
    if (r.state.completed && !session.completed) {
      // With a customer on the line, the learner wraps up and ends the conversation themselves.
      if (conv) setWrapUp(true);
      else finish(r.state, true, mode);
    }
  };

  const say = (text: string) => {
    const t: Transcript = [...transcript, { from: "learner", text }];
    setTranscript(t);
    if (!customerLeft) askCustomer(t);
  };

  const changeMode = (m: Mode) => {
    let s = session;
    if (m !== "open" && !s.scenarioId && sim.scenarios.length) s = newRun(sim.scenarios[0].id);
    setSession(switchMode(s, m));
    setMode(m);
    setHint("");
  };

  const changeScenario = (scenarioId: string | null) => {
    setSession(newRun(scenarioId));
    setSummary(null);
    setHint("");
    if (!scenarioId) setMode("open");
  };

  const restart = (m: Mode = mode) => {
    setAssignmentMet(undefined);
    setSession(newRun(session.scenarioId));
    setMode(m);
    setSummary(null);
    setHint("");
  };

  const askHint = () => {
    const r = takeHint(sim, session);
    setSession(r.state);
    setHint(r.hint);
  };

  const saveRecording = async () => {
    const fresh = await api.get(sim.id);
    const target = getScenario(fresh, recordInto);
    if (!target) return;
    const path = target.alternatePaths.find((p) => p.id === recordPath);
    (path ? path.steps : target.steps).push(...recording);
    await api.save(fresh);
    navigate(`/edit/${sim.id}?scenario=${target.id}${path ? `&path=${path.id}` : ""}`);
  };

  const elapsed = Math.round((Date.now() - session.startedAt) / 1000);
  const judged = mode !== "open" && !!scenario;
  const noScenarios = sim.scenarios.length === 0;

  return (
    <div className="player">
      <div className="player-bar">
        <div className="player-title">
          <b>{sim.title}</b>
          <span className="muted small">{screen.name}</span>
        </div>
        {!recordInto && (
          <div className="segmented" role="tablist" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={mode === m.id}
                className={mode === m.id ? "on" : ""}
                disabled={m.id !== "open" && noScenarios}
                title={m.id !== "open" && noScenarios ? "Add a scenario in the editor to use this mode" : m.blurb}
                onClick={() => changeMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
        <div className="row">
          {!recordInto && sim.scenarios.length > 0 && (
            <select value={session.scenarioId ?? ""} onChange={(e) => changeScenario(e.target.value || null)} aria-label="Scenario">
              {mode === "open" && <option value="">No scenario</option>}
              {sim.scenarios.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          )}
          <button className="btn sm" onClick={() => restart()}>↺ Restart</button>
          {auth.isBuilder && <a className="btn sm ghost" href={`#/edit/${sim.id}`}>Edit</a>}
        </div>
      </div>

      <div className="player-body">
        <div className="stage">
          {mode === "guided" && stepTarget && stepTarget.screen.id !== screen.id && (
            <div className="alert info stage-banner">
              The next step is on the <b>{stepTarget.screen.name}</b> screen.
              <button
                className="btn sm"
                onClick={() =>
                  setSession({
                    ...session,
                    screenId: stepTarget.screen.id,
                    history: [...session.history, stepTarget.screen.id],
                    visited: session.visited.includes(stepTarget.screen.id) ? session.visited : [...session.visited, stepTarget.screen.id],
                  })
                }
              >
                Take me there
              </button>
            </div>
          )}
          <div className="stage-inner">
            <PlayScreen
              screen={screen}
              vars={session.vars}
              highlightId={mode === "guided" ? step?.elementId : null}
              focusHighlight={mode === "guided"}
              revealHotspots={showHotspots || mode === "guided"}
              onActivate={(el) => handle({ type: "activate", elementId: el.id })}
              onCommit={(el, value) => handle({ type: "commit", elementId: el.id, value })}
            />
            <div className="toasts" aria-live="polite">
              {toasts.map((t) => (
                <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
              ))}
            </div>
          </div>
        </div>

        <aside className="side">
          {recordInto ? (
            <RecordingPanel
              scenarioTitle={
                (getScenario(sim, recordInto)?.title ?? recordInto) +
                (recordPath !== MAIN_PATH_ID ? ` (${getScenario(sim, recordInto)?.alternatePaths.find((p) => p.id === recordPath)?.name ?? recordPath})` : "")
              }
              steps={recording}
              onRemove={(i) => setRecording((r) => r.filter((_, j) => j !== i))}
              onSave={saveRecording}
              onCancel={() => navigate(`/edit/${sim.id}`)}
            />
          ) : (
            <>
              <p className="muted small">{MODES.find((m) => m.id === mode)!.blurb}</p>
              {judged && scenario && (
                <section className="panel">
                  <h3>{scenario.title}</h3>
                  <p><b>Goal:</b> {interpolate(scenario.goal, session.vars)}</p>
                  {scenario.briefing && <p className="muted">{interpolate(scenario.briefing, session.vars)}</p>}
                  {session.assisted && mode === "scenario" && <p className="badge">Assisted run</p>}
                  {assignment && assignment.scenarioId === scenario.id && (
                    <p className="assignment-note small">
                      📋 <b>Assigned to you:</b> {REQUIREMENT_TEXT[assignment.requirement].toLowerCase()}
                      {assignment.dueDate && ` by ${new Date(`${assignment.dueDate}T12:00:00`).toLocaleDateString()}`}.
                      {assignment.requirement !== "complete" && mode === "guided" && " Guided runs are practice; switch to Scenario mode to count."}
                    </p>
                  )}
                  <GradingInfo scheme={scheme} rubric={activeRubric(sim, scheme)} conversation={conv?.criteria ?? []} />
                </section>
              )}

              {conv && (
                <ConversationPanel
                  channel={conv.channel}
                  customer={session.vars[`${conv.role}.name`] || "Customer"}
                  transcript={transcript}
                  busy={convBusy}
                  failed={convFailed}
                  customerLeft={customerLeft}
                  wrapUp={wrapUp}
                  disabled={!!summary}
                  onSend={say}
                  onRetry={() => askCustomer(transcript)}
                  onEnd={() => {
                    if (!session.completed && scenario && !conversationOnly(scenario) && !confirm("The task isn't finished yet. End the run anyway?")) return;
                    finish(session, session.completed || (!!scenario && conversationOnly(scenario)), mode);
                  }}
                />
              )}

              {mode === "guided" && scenario && (
                <section className="panel">
                  {scenario.alternatePaths.length > 0 && (
                    <p className="muted small path-note">
                      Following: <b>{leadingPath(sim, session)!.name}</b>. This task has {scenarioPaths(scenario).length} valid ways; any of them counts.
                    </p>
                  )}
                  <ol className="steps">
                    {leadingPath(sim, session)!.steps.map((st, i) => (
                      <li key={st.id} className={i < session.stepIndex ? "done" : i === session.stepIndex ? "current" : ""}>
                        {interpolate(st.instruction, session.vars)}
                        {i === session.stepIndex && st.hint && <div className="hint">💡 {interpolate(st.hint, session.vars)}</div>}
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {mode === "scenario" && scenario && (
                <section className="panel stats">
                  <div><span className="muted small">Progress</span><b>{score.stepsCompleted}/{score.stepsTotal}</b></div>
                  <div><span className="muted small">Errors</span><b>{session.errors}</b></div>
                  {clock === null ? (
                    <div><span className="muted small">Time</span><b>{formatTime(session.finished ? score.durationSec : elapsed)}</b></div>
                  ) : clock >= 0 ? (
                    <div><span className="muted small">Time left</span><b className={clock < 30 ? "text-warn" : ""}>{formatTime(clock)}</b></div>
                  ) : (
                    <div><span className="muted small">Overtime</span><b className="text-error">+{formatTime(-clock)}</b></div>
                  )}
                  <div className="progress"><span style={{ width: `${(100 * score.stepsCompleted) / Math.max(1, score.stepsTotal)}%` }} /></div>
                  {hint && <div className="hint">💡 {hint}</div>}
                  <div className="row">
                    <button className="btn sm" onClick={askHint} disabled={session.finished}>Hint (−5)</button>
                    <button className="btn sm ghost" onClick={() => changeMode("guided")} disabled={session.finished}>Switch to guided</button>
                    <button className="btn sm ghost danger" onClick={() => finish(session, false, mode)} disabled={session.finished}>Give up</button>
                  </div>
                </section>
              )}

              {mode === "open" && (
                <section className="panel">
                  <h3>Explore</h3>
                  <p className="muted small">Try anything. The system reacts as it would for real.</p>
                  <div className="screen-list">
                    {sim.screens.map((s) => (
                      <span key={s.id} className={`chip ${session.history.includes(s.id) ? "visited" : ""} ${s.id === screen.id ? "here" : ""}`}>
                        {s.name}
                      </span>
                    ))}
                  </div>
                  <p className="muted small">
                    Visited {new Set(session.history).size} of {sim.screens.length} screens
                  </p>
                  {sim.scenarios.length > 0 && (
                    <button className="btn sm" onClick={() => changeMode("scenario")}>Try a scenario →</button>
                  )}
                </section>
              )}

              {objectives.length > 0 && (
                <section className="panel">
                  <h3>Objectives</h3>
                  <p className="muted small">Optional goals while you explore. They tick off by themselves.</p>
                  <ul className="checklist">
                    {objectives.map((o) => (
                      <li key={o.id} className={o.met ? "met" : ""}>
                        <span aria-hidden>{o.met ? "✓" : "○"}</span> {o.label}
                        <span className="sr-only">{o.met ? " (done)" : " (not yet)"}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="muted small">{objectives.filter((o) => o.met).length} of {objectives.length} done</p>
                </section>
              )}

              <section className="panel toggles">
                <label><input type="checkbox" checked={showHotspots} onChange={(e) => setShowHotspots(e.target.checked)} /> Outline clickable areas</label>
                <label><input type="checkbox" checked={showState} onChange={(e) => setShowState(e.target.checked)} /> Show system state</label>
                {showState && (
                  <table className="vars">
                    <tbody>
                      {Object.entries(session.vars).map(([k, v]) => (
                        <tr key={k}><td>{k}</td><td>{/pass/i.test(k) && v ? "•••" : v || <span className="muted">(empty)</span>}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </aside>
      </div>

      {summary && scenario && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>{summary.completed ? "Scenario complete" : "Scenario ended"}</h2>
            <p className="big-score">{summary.grade.score}<span>/100</span></p>
            <p>
              {summary.grade.passed === null ? (
                <span className="status neutral">⏳ Awaiting trainer marking</span>
              ) : summary.grade.passed ? (
                <span className="status good">✓ Passed</span>
              ) : (
                <span className="status bad">✕ Not passed</span>
              )}{" "}
              <span className="muted small">
                Pass mark {summary.grade.passScore} · {summary.grade.schemeName} grading
                {summary.grade.rubric.length > 0 && summary.grade.rubricWeight > 0 && ` · points ${summary.grade.pointsScore} (${100 - summary.grade.rubricWeight}%) + rubric (${summary.grade.rubricWeight}%)`}
                {summary.grade.overtimeSec > 0 && ` · ${formatTime(summary.grade.overtimeSec)} over time`}
              </span>
            </p>
            {assignmentMet !== undefined && (
              <p className={`alert ${assignmentMet ? "info" : "warn"} small`}>
                {assignmentMet === true
                  ? "📋 Assignment complete. Nice work!"
                  : assignmentMet === null
                    ? "📋 This may complete your assignment once a trainer marks it."
                    : `📋 Not enough for your assignment yet: ${REQUIREMENT_TEXT[assignment!.requirement].toLowerCase()}.`}{" "}
                <a href="#/my">My training</a>
              </p>
            )}
            {summary.judging ? (
              <p className="muted judging">⏳ Checking your conversation with the customer…</p>
            ) : (
            <details className="flow-details" open>
              <summary>Where your points came from</summary>
              <PointsFlow
                compact
                b={breakdown(
                  {
                    score: summary.grade.score,
                    completed: summary.completed,
                    errors: session.errors,
                    hintsUsed: session.hintsUsed,
                    stepsCompleted: score.stepsCompleted,
                    stepsTotal: score.stepsTotal,
                    grading: summary.grade,
                    penalties: session.penalties,
                  },
                  stepTitles(sim, scenario.id, score.pathName, session.vars),
                )}
              />
            </details>
            )}
            <p className="muted">
              {score.stepsCompleted} of {score.stepsTotal} steps · {session.errors} error{session.errors === 1 ? "" : "s"} · {session.hintsUsed} hint
              {session.hintsUsed === 1 ? "" : "s"} · {formatTime(summary.durationSec)}
              {(session.assisted || mode === "guided") && " · assisted"}
              {scenario.alternatePaths.length > 0 && ` · path: ${score.pathName}`}
            </p>
            {session.mistakes.length > 0 && (
              <div className="panel">
                <b>What to review</b>
                <ul>{session.mistakes.map((m, i) => <li key={i}>{m}</li>)}</ul>
              </div>
            )}
            <div className="row">
              <button className="btn primary" onClick={() => restart("scenario")}>Try again (scenario)</button>
              <button className="btn" onClick={() => restart("guided")}>Practice in guided mode</button>
              <button className="btn ghost" onClick={() => { setSummary(null); setMode("open"); }}>Keep exploring</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordingPanel({ scenarioTitle, steps, onRemove, onSave, onCancel }: {
  scenarioTitle: string;
  steps: Step[];
  onRemove: (i: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <section className="panel recording">
      <h3><span className="rec-dot" /> Recording steps</h3>
      <p className="muted small">
        Perform the task as an expert would. Each click or field entry becomes a step in <b>{scenarioTitle}</b>. You can edit
        wording and expected values in the editor afterwards.
      </p>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.id}>
            {s.instruction}
            <button className="link-btn" onClick={() => onRemove(i)} aria-label="Remove step">✕</button>
          </li>
        ))}
      </ol>
      {steps.length === 0 && <p className="muted small">No steps yet. Start interacting with the screen.</p>}
      <div className="row">
        <button className="btn primary sm" disabled={!steps.length} onClick={onSave}>Add {steps.length} step{steps.length === 1 ? "" : "s"} to scenario</button>
        <button className="btn sm ghost" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

/** Tells the trainee up front how this run is graded. */
function GradingInfo({ scheme, rubric, conversation }: { scheme: GradingScheme; rubric: GradingScheme["rubric"]; conversation: { id: string; label: string }[] }) {
  const p = scheme.points;
  return (
    <details className="grading-info">
      <summary className="small">How you're graded ({scheme.name})</summary>
      <ul className="small">
        <li>Finish the task for 100 points; −{p.errorPenalty} per mistake, −{p.hintPenalty} per hint.</li>
        {p.timeLimitSec !== null && (
          <li>Time limit {formatTime(p.timeLimitSec)}; −{p.overtimePenaltyPerMin} per minute over.</li>
        )}
        {rubric.length > 0 && (
          <li>
            {scheme.rubricWeight > 0 ? `${scheme.rubricWeight}% of the score comes from:` : "Also assessed:"}
            <ul>{rubric.map((c) => <li key={c.id}>{c.label}{c.check.type === "manual" ? " (marked by a trainer afterwards)" : ""}</li>)}</ul>
          </li>
        )}
        {conversation.length > 0 && (
          <li>
            In the conversation (judged by AI when you finish):
            <ul>{conversation.map((c) => <li key={c.id}>{c.label}</li>)}</ul>
          </li>
        )}
        <li>Pass mark {p.passScore}; {p.masteryScore}+ without help counts as mastered.</li>
      </ul>
    </details>
  );
}
