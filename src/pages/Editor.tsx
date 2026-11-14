import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lintSimulation, newId } from "../../shared/engine";
import { ElementKinds, FIELD_KINDS, type ElementKind, type Rect, type SimElement, type Simulation } from "../../shared/schema";
import { api, streamAi, type AiProgress } from "../api";
import { ElementInspector, ScenarioInspector, ScreenInspector, VariablesPanel } from "../components/Inspector";
import { EditScreen } from "../components/ScreenView";
import { alignScreen } from "../lib/align";
import { prepareImage } from "../lib/media";
import { navigate, setLeaveGuard } from "../router";

type Selection =
  | { kind: "screen" }
  | { kind: "element"; id: string }
  | { kind: "scenario"; id: string }
  | { kind: "variables" }
  | { kind: "settings" };

const DEFAULT_LABEL: Record<ElementKind, string> = {
  button: "Button",
  link: "Link",
  hotspot: "Clickable area",
  input: "Text field",
  textarea: "Notes",
  select: "Dropdown",
  checkbox: "Checkbox",
  text: "Label",
};

const isTyping = () => {
  const t = document.activeElement?.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT";
};

export default function Editor({ id }: { id: string }) {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [savedJson, setSavedJson] = useState("");
  const [error, setError] = useState("");
  const [screenId, setScreenId] = useState("");
  const [sel, setSel] = useState<Selection>({ kind: "screen" });
  const [drawKind, setDrawKind] = useState<ElementKind>("button");
  const [saving, setSaving] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [aiText, setAiText] = useState("");
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const [aiNotes, setAiNotes] = useState("");
  const [aiAvailable, setAiAvailable] = useState(false);
  const [aligning, setAligning] = useState(false);
  const [alignMsg, setAlignMsg] = useState<{ screenId: string; text: string } | null>(null);
  const undo = useRef<{ stack: Simulation[]; lastKey: string; lastAt: number }>({ stack: [], lastKey: "", lastAt: 0 });

  useEffect(() => {
    api.status().then((s) => setAiAvailable(s.aiConfigured)).catch(() => undefined);
    api
      .get(id)
      .then((s) => {
        setSim(s);
        setSavedJson(JSON.stringify(s));
        setScreenId(s.startScreenId);
        const q = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
        const sc = q.get("scenario");
        if (sc && s.scenarios.some((x) => x.id === sc)) setSel({ kind: "scenario", id: sc });
        else if (s.screens.every((x) => !x.imageAssetId)) setDrawKind("button");
        else setDrawKind("hotspot");
      })
      .catch((e) => setError(e.message));
  }, [id]);

  /** Apply a change. Rapid edits with the same key (e.g. typing in one field) share one undo entry. */
  const update = useCallback((fn: (draft: Simulation) => void, key = Math.random().toString()) => {
    setSim((prev) => {
      if (!prev) return prev;
      const u = undo.current;
      const now = Date.now();
      if (key !== u.lastKey || now - u.lastAt > 1500) u.stack = [...u.stack.slice(-49), prev];
      u.lastKey = key;
      u.lastAt = now;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const doUndo = useCallback(() => {
    const prev = undo.current.stack.pop();
    undo.current.lastKey = "";
    if (prev) setSim(prev);
  }, []);

  const dirty = !!sim && JSON.stringify(sim) !== savedJson;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  useEffect(() => {
    setLeaveGuard(() => !dirtyRef.current || confirm("You have unsaved changes. Leave without saving?"));
    return () => setLeaveGuard(null);
  }, []);
  const issues = useMemo(() => (sim ? lintSimulation(sim) : []), [sim]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!sim) return false;
    setSaving(true);
    setError("");
    try {
      const saved = await api.save(sim);
      setSim(saved);
      setSavedJson(JSON.stringify(saved));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [sim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !isTyping()) {
        e.preventDefault();
        doUndo();
      } else if ((e.key === "Delete" || e.key === "Backspace") && sel.kind === "element" && !isTyping()) {
        e.preventDefault();
        deleteElement(sel.id);
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  });

  if (error && !sim) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!sim) return <div className="page muted">Loading…</div>;

  const screen = sim.screens.find((s) => s.id === screenId) ?? sim.screens[0];
  const selectedEl = sel.kind === "element" ? screen.elements.find((e) => e.id === sel.id) : undefined;

  // ------------------------------------------------------------ mutations

  const addElement = (rect: Rect) => {
    const elId = newId(drawKind);
    const el: SimElement = { id: elId, label: DEFAULT_LABEL[drawKind], kind: drawKind, rect, rules: [] };
    if (drawKind === "select") el.options = ["Option 1", "Option 2"];
    update((d) => {
      d.screens.find((s) => s.id === screen.id)!.elements.push(el);
      if (FIELD_KINDS.includes(drawKind)) {
        el.bindVar = elId;
        d.variables.push({ name: elId, initial: drawKind === "checkbox" ? "false" : drawKind === "select" ? "Option 1" : "" });
      }
    });
    setSel({ kind: "element", id: elId });
  };

  function deleteElement(elId: string) {
    update((d) => {
      for (const s of d.screens) s.elements = s.elements.filter((e) => e.id !== elId);
    });
    setSel({ kind: "screen" });
  }

  const updateElement = (el: SimElement) =>
    update((d) => {
      const s = d.screens.find((x) => x.id === screen.id)!;
      s.elements = s.elements.map((e) => (e.id === el.id ? el : e));
    }, `el-${el.id}`);

  const imageToScreenPatch = async (file: File) => {
    const img = await prepareImage(file, file.name);
    const { assetId } = await api.uploadAsset(img.mediaType, img.data);
    return { imageAssetId: assetId, aspect: img.width / img.height };
  };

  const addScreen = async (file?: File) => {
    const sid = newId("screen");
    const patch = file ? await imageToScreenPatch(file).catch((e) => (setError(e.message), null)) : null;
    if (file && !patch) return;
    update((d) => {
      d.screens.push({
        id: sid,
        name: file ? file.name.replace(/\.[a-z0-9]+$/i, "") : `Screen ${d.screens.length + 1}`,
        imageAssetId: patch?.imageAssetId ?? null,
        aspect: patch?.aspect ?? 1.6,
        elements: [],
      });
    });
    setScreenId(sid);
    setSel({ kind: "screen" });
  };

  const askAi = async () => {
    setAiNotes("");
    setError("");
    try {
      const r = await streamAi(`/api/simulations/${sim.id}/refine`, { instruction: aiText, simulation: sim }, setAiProgress);
      update((d) => Object.assign(d, r.simulation));
      setAiNotes(r.notes || "Done. Review the changes, then Save (or press Ctrl+Z to undo).");
      setAiText("");
      if (!r.simulation.screens.some((s) => s.id === screenId)) setScreenId(r.simulation.startScreenId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAiProgress(null);
    }
  };

  const alignBoxes = async () => {
    setAligning(true);
    setAlignMsg(null);
    setError("");
    const target = screen;
    try {
      const { rects, notFound } = await alignScreen(target);
      const moved = Object.keys(rects).length;
      if (moved) {
        update((d) => {
          const sc = d.screens.find((x) => x.id === target.id);
          for (const el of sc?.elements ?? []) if (rects[el.id]) el.rect = rects[el.id];
        });
      }
      setAlignMsg({
        screenId: target.id,
        text: (moved ? `Adjusted ${moved} box${moved > 1 ? "es" : ""}. Save to keep, or Undo.` : "Boxes already line up.") +
          (notFound.length ? ` Not found in screenshot: ${notFound.join(", ")}.` : ""),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAligning(false);
    }
  };

  const goPlay = async (path: string) => {
    if (dirty && !(await save())) return; // stay put if saving failed
    navigate(path, { force: true });
  };

  // ------------------------------------------------------------ layout

  const inspector = (() => {
    if (sel.kind === "element" && selectedEl) {
      return <ElementInspector el={selectedEl} sim={sim} onChange={updateElement} onDelete={() => deleteElement(selectedEl.id)} />;
    }
    if (sel.kind === "scenario") {
      const sc = sim.scenarios.find((s) => s.id === sel.id);
      if (sc) {
        return (
          <ScenarioInspector
            scenario={sc}
            sim={sim}
            onChange={(next) => update((d) => { d.scenarios = d.scenarios.map((s) => (s.id === sc.id ? next : s)); }, `sc-${sc.id}`)}
            onDelete={() => {
              if (!confirm(`Delete scenario "${sc.title}"?`)) return;
              update((d) => { d.scenarios = d.scenarios.filter((s) => s.id !== sc.id); });
              setSel({ kind: "screen" });
            }}
            onRecord={() => goPlay(`/play/${sim.id}?record=${sc.id}`)}
            onPlay={(mode) => goPlay(`/play/${sim.id}?mode=${mode}&scenario=${sc.id}`)}
          />
        );
      }
    }
    if (sel.kind === "variables") {
      return <VariablesPanel sim={sim} onChange={(v) => update((d) => { d.variables = v; }, "vars")} />;
    }
    if (sel.kind === "settings") {
      return (
        <div className="inspector">
          <h3>Simulation</h3>
          <label className="field">
            <span>Title</span>
            <input value={sim.title} onChange={(e) => update((d) => { d.title = e.target.value; }, "title")} />
          </label>
          <label className="field">
            <span>Description</span>
            <textarea rows={4} value={sim.description} onChange={(e) => update((d) => { d.description = e.target.value; }, "desc")} />
          </label>
        </div>
      );
    }
    return (
      <ScreenInspector
        screen={screen}
        sim={sim}
        onChange={(next) => update((d) => { d.screens = d.screens.map((s) => (s.id === next.id ? next : s)); }, `screen-${screen.id}`)}
        onDelete={() => {
          if (!confirm(`Delete screen "${screen.name}" and its ${screen.elements.length} elements?`)) return;
          update((d) => {
            d.screens = d.screens.filter((s) => s.id !== screen.id);
            if (d.startScreenId === screen.id) d.startScreenId = d.screens[0].id;
          });
          setScreenId(sim.screens.find((s) => s.id !== screen.id)!.id);
        }}
        onReplaceImage={async (f) => {
          const patch = await imageToScreenPatch(f).catch((e) => (setError(e.message), null));
          if (patch) update((d) => Object.assign(d.screens.find((s) => s.id === screen.id)!, patch));
        }}
        onMakeStart={() => update((d) => { d.startScreenId = screen.id; })}
        onSelectElement={(eid) => setSel({ kind: "element", id: eid })}
      />
    );
  })();

  return (
    <div className="editor">
      <div className="editor-bar">
        <a href="#/" className="link-btn">← Library</a>
        <b className="editor-title">{sim.title}</b>
        {dirty ? <span className="badge warn">Unsaved</span> : <span className="muted small">Saved</span>}
        <span className="spacer" />
        {issues.length > 0 && (
          <button className="btn sm ghost warn" onClick={() => setShowIssues((v) => !v)}>⚠ {issues.length} issue{issues.length > 1 ? "s" : ""}</button>
        )}
        <button className="btn sm ghost" onClick={doUndo} disabled={!undo.current.stack.length} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="btn sm" onClick={() => goPlay(`/play/${sim.id}`)}>▶ Play</button>
        <button className="btn sm primary" onClick={save} disabled={!dirty || saving}>{saving ? "Saving…" : "Save"}</button>
      </div>
      {showIssues && issues.length > 0 && (
        <div className="alert warn issues"><ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul></div>
      )}
      {error && <div className="alert error">{error}</div>}

      <div className="editor-body">
        <aside className="editor-left">
          <button className={`nav-item ${sel.kind === "settings" ? "on" : ""}`} onClick={() => setSel({ kind: "settings" })}>⚙ Settings</button>
          <button className={`nav-item ${sel.kind === "variables" ? "on" : ""}`} onClick={() => setSel({ kind: "variables" })}>
            𝑥 Variables <span className="count">{sim.variables.length}</span>
          </button>
          <h4>Screens</h4>
          {sim.screens.map((s) => (
            <button
              key={s.id}
              className={`nav-item ${s.id === screen.id && (sel.kind === "screen" || sel.kind === "element") ? "on" : ""}`}
              onClick={() => { setScreenId(s.id); setSel({ kind: "screen" }); }}
            >
              {s.imageAssetId ? "▣" : "▢"} {s.name}
              {s.id === sim.startScreenId && <span className="count">start</span>}
            </button>
          ))}
          <div className="row tight">
            <button className="link-btn add" onClick={() => addScreen()}>+ blank</button>
            <label className="link-btn add">
              + from image
              <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && addScreen(e.target.files[0])} />
            </label>
          </div>
          <h4>Scenarios</h4>
          {sim.scenarios.map((s) => (
            <button key={s.id} className={`nav-item ${sel.kind === "scenario" && sel.id === s.id ? "on" : ""}`} onClick={() => setSel({ kind: "scenario", id: s.id })}>
              ◎ {s.title} <span className="count">{s.steps.length}</span>
            </button>
          ))}
          <button
            className="link-btn add"
            onClick={() => {
              const scId = newId("scenario");
              update((d) => {
                d.scenarios.push({ id: scId, title: "New scenario", goal: "", initialVars: [], steps: [], successCriteria: [] });
              });
              setSel({ kind: "scenario", id: scId });
            }}
          >
            + scenario
          </button>

          {aiAvailable && (
            <div className="ai-box">
              <h4>✦ Ask AI to change it</h4>
              <textarea
                rows={4}
                value={aiText}
                disabled={!!aiProgress}
                onChange={(e) => setAiText(e.target.value)}
                placeholder={'e.g. "Add a scenario where the customer has no order number" or "Make the email field required"'}
              />
              <button className="btn sm primary" disabled={!aiText.trim() || !!aiProgress} onClick={askAi}>
                {aiProgress ? (aiProgress.phase === "writing" ? `Writing… ${Math.round(aiProgress.chars / 1000)}k` : "Thinking…") : "Apply"}
              </button>
              {aiNotes && <p className="muted small prewrap">{aiNotes}</p>}
            </div>
          )}
        </aside>

        <section className="editor-center">
          <div className="canvas-toolbar">
            <span className="muted small">Draw:</span>
            {ElementKinds.map((k) => (
              <button key={k} className={`chip-btn ${drawKind === k ? "on" : ""}`} onClick={() => setDrawKind(k)}>{k}</button>
            ))}
            {aiAvailable && screen.imageAssetId && screen.elements.length > 0 && (
              <>
                <span className="spacer" />
                <button className="btn sm" onClick={alignBoxes} disabled={aligning} title="Ask AI to snap every box on this screen to the control it describes">
                  {aligning ? "Aligning…" : "✦ Align boxes to screenshot"}
                </button>
              </>
            )}
          </div>
          <EditScreen
            screen={screen}
            selectedId={selectedEl?.id ?? null}
            onSelect={(eid) => setSel(eid ? { kind: "element", id: eid } : { kind: "screen" })}
            onRectChange={(eid, rect) =>
              update((d) => {
                const el = d.screens.find((s) => s.id === screen.id)!.elements.find((e) => e.id === eid);
                if (el) el.rect = rect;
              }, `rect-${eid}`)
            }
            onCreate={addElement}
          />
          {alignMsg?.screenId === screen.id && <p className="small center">{alignMsg.text}</p>}
          <p className="muted small center">Drag on empty space to draw a <b>{drawKind}</b>. Drag an element to move it; use its corner to resize.</p>
        </section>

        <aside className="editor-right">{inspector}</aside>
      </div>
    </div>
  );
}
