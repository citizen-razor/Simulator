/**
 * Libraries → Tools: the systems the organisation simulates (shared/tools.ts). Builders and
 * Admin-Builders can create and edit tools, start a simulation on one, and move simulations
 * between tools (e.g. to merge copies of the same system), after checking their scenarios
 * still play through on the target tool.
 */
import { useEffect, useState } from "react";
import type { PathCheck } from "../../shared/health";
import { api, assetUrl, type SimSummary, type ToolSummary } from "../api";
import { navigate } from "../router";

export function ToolLibraryPanel() {
  const [tools, setTools] = useState<ToolSummary[] | null>(null);
  const [error, setError] = useState("");
  const [moving, setMoving] = useState<string | null>(null);
  const load = () => api.tools().then(setTools).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const newTool = async () => {
    const name = prompt("Name of the system you want to simulate (e.g. \"Helpdesk portal\"):")?.trim();
    if (!name) return;
    try {
      const t = await api.createTool({ name, description: "", startScreenId: "screen-1", variables: [], screens: [{ id: "screen-1", name: "Screen 1", imageAssetId: null, aspect: 1.6, elements: [] }] });
      navigate(`/tool/${t.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const newSimulation = async (t: ToolSummary) => {
    const title = prompt(`Title of the new simulation on "${t.name}":`, `${t.name} practice`)?.trim();
    if (!title) return;
    try {
      const sim = await api.newSimulationOnTool(t.id, title);
      navigate(`/edit/${sim.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (t: ToolSummary) => {
    if (!confirm(`Delete the tool "${t.name}"? This can't be undone.`)) return;
    try {
      await api.deleteTool(t.id);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!tools) return <p className="muted">{error || "Loading…"}</p>;
  const sameName = (t: ToolSummary) => tools.filter((x) => x.name.trim().toLowerCase() === t.name.trim().toLowerCase()).length - 1;
  return (
    <>
      <p className="muted small">
        A tool is a system you simulate: its screens, controls and what they do. Every simulation uses one tool and adds its own scenarios, grading, personas and
        data. Change a tool once and every simulation using it updates; before you save, each of their scenarios is played through to show what the change affects.
      </p>
      {error && <div className="alert error">{error}</div>}
      <div className="row">
        <button className="btn primary sm" onClick={newTool}>+ New tool</button>
        <span className="muted small">Or create one with AI from screenshots or a video on the Create page.</span>
      </div>
      {!tools.length ? (
        <div className="empty"><p>No tools yet.</p></div>
      ) : (
        <div className="tool-list">
          {tools.map((t) => (
            <section key={t.id} className="panel tool-card">
              <div className="tool-head">
                {t.cover ? <img src={assetUrl(t.cover)} alt="" className="tool-thumb" /> : <div className="tool-thumb blank" aria-hidden>▢</div>}
                <div className="tool-meta">
                  <h3>
                    {t.name}
                    {sameName(t) > 0 && (
                      <span className="badge subtle" title="Probably copies of the same system: move their simulations onto one tool so a single update reaches them all">
                        {sameName(t)} other{sameName(t) === 1 ? "" : "s"} with this name
                      </span>
                    )}
                  </h3>
                  {t.description && <p className="muted small">{t.description}</p>}
                  <p className="small">
                    {t.screens} screen{t.screens === 1 ? "" : "s"} · {t.usedBy.length ? `used by ${t.usedBy.length} simulation${t.usedBy.length === 1 ? "" : "s"}` : "not used yet"}
                    {t.updatedAt && <span className="muted"> · updated {new Date(t.updatedAt).toLocaleDateString()}</span>}
                  </p>
                  {t.usedBy.length > 0 && (
                    <p className="small used-by">{t.usedBy.map((s, i) => <span key={s.id}>{i > 0 && ", "}<a href={`#/edit/${s.id}`}>{s.title}</a></span>)}</p>
                  )}
                </div>
              </div>
              <div className="row">
                <a className="btn sm" href={`#/tool/${t.id}`}>Edit screens</a>
                <button className="btn sm ghost" onClick={() => newSimulation(t)}>+ Simulation on this tool</button>
                <button className={`btn sm ghost ${moving === t.id ? "on" : ""}`} onClick={() => setMoving(moving === t.id ? null : t.id)}>Move simulations here…</button>
                <span className="spacer" />
                {!t.usedBy.length && <button className="btn sm ghost danger" onClick={() => remove(t)}>Delete</button>}
              </div>
              {moving === t.id && <MoveHere target={t} onDone={() => { setMoving(null); load(); }} />}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/** Move simulations from other tools onto this one, after checking their scenarios still work. */
function MoveHere({ target, onDone }: { target: ToolSummary; onDone: () => void }) {
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [simId, setSimId] = useState("");
  const [check, setCheck] = useState<{ paths: PathCheck[]; issues: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    api.list().then((all) => setSims(all.filter((s) => s.toolId !== target.id))).catch(() => undefined);
  }, [target.id]);
  const run = async (apply: boolean) => {
    setBusy(true);
    setError("");
    try {
      const r = await api.moveToTool(simId, target.id, apply);
      if (apply) onDone();
      else setCheck(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const failing = check ? check.paths.filter((p) => !p.ok) : [];
  return (
    <div className="move-here">
      <p className="small">
        Moving a simulation onto <b>{target.name}</b> makes its scenarios use this tool's screens. Its old tool stays in the library (delete it here once nothing
        uses it). Check first: each scenario is played through on this tool.
      </p>
      <div className="row">
        <select value={simId} aria-label="Simulation to move" onChange={(e) => { setSimId(e.target.value); setCheck(null); }}>
          <option value="">Choose a simulation…</option>
          {sims.map((s) => <option key={s.id} value={s.id}>{s.title} (now on {s.toolName})</option>)}
        </select>
        <button className="btn sm" disabled={!simId || busy} onClick={() => run(false)}>Check</button>
      </div>
      {check && (
        <div className="move-result">
          {failing.length === 0 && check.issues.length === 0 ? (
            <p className="small"><span className="status good">✓ All {check.paths.length} path{check.paths.length === 1 ? "" : "s"} play through on this tool</span></p>
          ) : (
            <>
              <p className="small"><span className="status bad">✕ {failing.length + check.issues.length} problem{failing.length + check.issues.length === 1 ? "" : "s"} on this tool</span></p>
              <ul className="small">
                {failing.map((p, i) => <li key={i}>{p.scenario} · {p.path}: {p.detail}</li>)}
                {check.issues.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </>
          )}
          <button className={`btn sm ${failing.length || check.issues.length ? "danger" : "primary"}`} disabled={busy} onClick={() => run(true)}>
            {failing.length || check.issues.length ? "Move anyway" : "Move it"}
          </button>
        </div>
      )}
      {error && <p className="text-error small">{error}</p>}
    </div>
  );
}
