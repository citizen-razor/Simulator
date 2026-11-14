import { useEffect, useRef, useState } from "react";
import type { Simulation } from "../../shared/schema";
import { api, streamAi, type AiProgress, type AiResult } from "../api";
import { prepareFile, type Prepared, type PreparedImage } from "../lib/media";
import { navigate } from "../router";

interface Item {
  key: string;
  file: string;
  status: "processing" | "ready" | "error";
  progress?: number;
  parts: Prepared[];
  error?: string;
}

const ACCEPT = "image/*,video/*,.pdf,.docx,.txt,.md,.html,.htm,.css,.js,.jsx,.ts,.tsx,.json,.xml,.yaml,.yml,.csv,.py,.java,.cs,.go,.rb,.php,.sql,.vue,.svelte";

export default function Create() {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<{ model: string; aiConfigured: boolean } | null>(null);
  const [progress, setProgress] = useState<AiProgress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus({ model: "", aiConfigured: false }));
  }, []);
  const generating = progress !== null;
  useEffect(() => {
    if (!generating) return;
    const start = Date.now();
    setElapsed(0);
    const t = setInterval(() => setElapsed(Math.round((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [generating]);

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random()}`;
      setItems((xs) => [...xs, { key, file: file.name, status: "processing", parts: [] }]);
      const update = (patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
      prepareFile(file, (p) => update({ progress: p }))
        .then((parts) => update({ status: "ready", parts }))
        .catch((e) => update({ status: "error", error: e.message }));
    }
  };

  const parts = items.filter((i) => i.status === "ready").flatMap((i) => i.parts);
  const images = parts.filter((p): p is PreparedImage => p.kind === "image");
  const busy = items.some((i) => i.status === "processing");
  const tooManyImages = images.length > 40;

  const generate = async () => {
    setError("");
    setResult(null);
    try {
      const body = {
        title: title.trim() || undefined,
        notes,
        images: images.map(({ name, mediaType, data, width, height, source }) => ({ name, mediaType, data, width, height, source })),
        texts: parts.flatMap((p) => (p.kind === "text" ? [{ name: p.name, content: p.content }] : [])),
        pdfs: parts.flatMap((p) => (p.kind === "pdf" ? [{ name: p.name, data: p.data }] : [])),
        docx: parts.flatMap((p) => (p.kind === "docx" ? [{ name: p.name, data: p.data }] : [])),
      };
      setResult(await streamAi("/api/generate", body, setProgress));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  /** Without AI: one blank screen per uploaded image (or one wireframe screen), then open the editor. */
  const startManual = async () => {
    setError("");
    try {
      const screens: Simulation["screens"] = [];
      for (const [i, img] of images.entries()) {
        const { assetId } = await api.uploadAsset(img.mediaType, img.data);
        screens.push({ id: `screen-${i + 1}`, name: img.name.replace(/\.[a-z0-9]+$/i, ""), imageAssetId: assetId, aspect: img.width / img.height, elements: [] });
      }
      if (screens.length === 0) screens.push({ id: "screen-1", name: "Screen 1", imageAssetId: null, aspect: 1.6, elements: [] });
      const sim = await api.create({
        title: title.trim() || "Untitled simulation",
        description: notes.slice(0, 500),
        startScreenId: screens[0].id,
        variables: [],
        screens,
        scenarios: [],
      });
      navigate(`/edit/${sim.id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (result) {
    const s = result.simulation;
    return (
      <div className="page narrow">
        <h1>Draft ready: {s.title}</h1>
        <p className="muted">
          {s.screens.length} screens · {s.screens.reduce((n, x) => n + x.elements.length, 0)} elements · {s.scenarios.length} scenarios
        </p>
        {result.notes && (
          <div className="panel">
            <h3>Notes from the AI</h3>
            <p className="prewrap">{result.notes}</p>
          </div>
        )}
        {result.issues.length > 0 && (
          <div className="alert warn">
            <b>Check these in the editor:</b>
            <ul>{result.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        )}
        <div className="row">
          <a className="btn primary" href={`#/edit/${s.id}`}>Review in editor</a>
          <a className="btn" href={`#/play/${s.id}`}>Play it now</a>
        </div>
      </div>
    );
  }

  return (
    <div className="page narrow">
      <h1>Create a simulation</h1>
      <p className="muted">
        Add screenshots, screen recordings, source code or HTML, and procedure documents. The AI drafts screens,
        clickable controls, state and training scenarios. You then refine everything in the editor.
      </p>

      <label className="field">
        <span>Title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. CRM: handling a refund request" />
      </label>
      <label className="field">
        <span>What should trainees learn?</span>
        <textarea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Describe the system, who uses it, the tasks they must master, rules they must follow, and common mistakes. The more specific, the better the scenarios."
        />
      </label>

      <div
        className={`dropzone ${dragOver ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
      >
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        <b>Drop files here or click to browse</b>
        <span className="muted">Images · Videos (key frames extracted) · PDF · Word · HTML / source code · text</span>
      </div>

      {items.length > 0 && (
        <ul className="file-list">
          {items.map((it) => (
            <li key={it.key} className={it.status}>
              <div className="thumbs">
                {it.parts.filter((p): p is PreparedImage => p.kind === "image").slice(0, 8).map((p) => (
                  <img key={p.name} src={p.preview} alt="" title={p.source ?? p.name} />
                ))}
                {it.parts.length > 0 && it.parts[0].kind !== "image" && <span className="file-icon">{it.parts[0].kind.toUpperCase()}</span>}
              </div>
              <div className="grow">
                <div>{it.file}</div>
                <div className="muted small">
                  {it.status === "processing" && `Processing${it.progress ? ` ${Math.round(it.progress * 100)}%` : "…"}`}
                  {it.status === "error" && <span className="text-error">{it.error}</span>}
                  {it.status === "ready" && (it.parts.length > 1 ? `${it.parts.length} key frames` : "Ready")}
                </div>
              </div>
              <button className="btn sm ghost" onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {tooManyImages && <div className="alert warn">At most 40 images per generation. Remove some files or shorten videos.</div>}
      {error && <div className="alert error">{error}</div>}

      {progress ? (
        <div className="panel generating">
          <div className="spinner" />
          <div>
            <b>{progress.phase === "uploading" ? "Uploading…" : progress.phase === "thinking" ? "Analyzing your material…" : "Writing the simulation…"}</b>
            <div className="muted small">
              {elapsed}s elapsed{progress.chars ? ` · ${Math.round(progress.chars / 100) / 10}k characters` : ""}. This usually takes 1–3 minutes.
            </div>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            className="btn primary"
            disabled={busy || tooManyImages || !status?.aiConfigured || (parts.length === 0 && !notes.trim())}
            onClick={generate}
          >
            ✦ Generate with AI
          </button>
          <button className="btn" disabled={busy} onClick={startManual}>
            {images.length ? `Build manually from ${images.length} image${images.length > 1 ? "s" : ""}` : "Start blank"}
          </button>
        </div>
      )}
      {status && !status.aiConfigured && (
        <p className="muted small">
          AI generation is off because no API key is set. Copy <code>.env.example</code> to <code>.env</code>, add your
          ANTHROPIC_API_KEY, and restart the server. Manual building works without a key.
        </p>
      )}
    </div>
  );
}
