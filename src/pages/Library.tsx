import { useEffect, useRef, useState } from "react";
import { findTag, type Taxonomy } from "../../shared/library";
import { api, assetUrl, exportUrl, type SimSummary } from "../api";

export default function Library() {
  const [sims, setSims] = useState<SimSummary[] | null>(null);
  const [error, setError] = useState("");
  const [imported, setImported] = useState<{ id: string; title: string; warnings: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ topics: [] });
  /** "" = everything; "topic:<id>" or "tag:<id>". */
  const [filter, setFilter] = useState("");
  useEffect(() => {
    api.taxonomy().then(setTaxonomy).catch(() => undefined);
  }, []);

  const load = () => api.list().then(setSims).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const remove = async (s: SimSummary) => {
    if (!confirm(`Delete "${s.title}"? This can't be undone.`)) return;
    await api.remove(s.id);
    load();
  };

  const importFile = async (file: File) => {
    setError("");
    setImported(null);
    if (file.size > 250_000_000) return setError(`${file.name} is too large to import (250 MB max).`);
    setImporting(true);
    try {
      let data: unknown;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error(`${file.name} isn't a simulation export (it's not valid JSON).`);
      }
      const { simulation, warnings } = await api.importSimulation(data);
      setImported({ id: simulation.id, title: simulation.title, warnings });
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const matches = (s: SimSummary) => {
    if (!filter) return true;
    const [kind, id] = filter.split(":");
    if (kind === "tag") return s.tagIds.includes(id);
    const topic = taxonomy.topics.find((t) => t.id === id);
    return !!topic && topic.tags.some((t) => s.tagIds.includes(t.id));
  };
  const visible = (sims ?? []).filter(matches);
  const usedTopics = taxonomy.topics.filter((t) => t.tags.some((tag) => (sims ?? []).some((s) => s.tagIds.includes(tag.id))));

  const duplicate = async (s: SimSummary) => {
    const full = await api.get(s.id);
    await api.create({ ...full, title: `${full.title} (copy)` });
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Simulations</h1>
          <p className="muted">Each simulation can be played in Open world, Guided, or Scenario mode.</p>
        </div>
        <div className="row">
          <label className={`btn ${importing ? "disabled" : ""}`} title="Import a .simulation.json file exported from this app">
            {importing ? "Importing…" : "⤒ Import"}
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              hidden
              disabled={importing}
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
            />
          </label>
          <a className="btn primary" href="#/new">+ New simulation</a>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {imported && (
        <div className={`alert ${imported.warnings.length ? "warn" : "info"}`}>
          Imported <b>{imported.title}</b>. <a href={`#/edit/${imported.id}`}>Open in editor</a>
          {imported.warnings.length > 0 && <ul>{imported.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
      {sims && sims.length === 0 && (
        <div className="empty">
          <p>No simulations yet.</p>
          <a className="btn primary" href="#/new">Create your first one</a>
        </div>
      )}
      {usedTopics.length > 0 && (
        <div className="filter-bar" role="toolbar" aria-label="Filter by topic or tag">
          <button className={`tag-toggle ${filter === "" ? "on" : ""}`} onClick={() => setFilter("")}>All</button>
          {usedTopics.map((topic) => (
            <span key={topic.id} className="filter-group">
              <button className={`tag-toggle topic ${filter === `topic:${topic.id}` ? "on" : ""}`} onClick={() => setFilter(`topic:${topic.id}`)}>
                {topic.name}
              </button>
              {topic.tags
                .filter((tag) => (sims ?? []).some((s) => s.tagIds.includes(tag.id)))
                .map((tag) => (
                  <button key={tag.id} className={`tag-toggle ${filter === `tag:${tag.id}` ? "on" : ""}`} onClick={() => setFilter(`tag:${tag.id}`)}>
                    {tag.name}
                  </button>
                ))}
            </span>
          ))}
        </div>
      )}
      {sims && sims.length > 0 && visible.length === 0 && <p className="muted">No simulations with that tag.</p>}
      <div className="card-grid">
        {visible.map((s) => (
          <article key={s.id} className="sim-card">
            <a className="sim-cover" href={`#/play/${s.id}`}>
              {s.cover ? <img src={assetUrl(s.cover)} alt="" /> : <span className="cover-placeholder">◧</span>}
            </a>
            <div className="sim-card-body">
              <h2>{s.title}</h2>
              <p className="muted clamp-2">{s.description || "No description"}</p>
              {s.tagIds.some((t) => findTag(taxonomy, t)) && (
                <div className="tag-row card-tags">
                  {s.tagIds.map((t) => findTag(taxonomy, t)).filter((x) => x !== null).map(({ tag, topic }) => (
                    <span key={tag.id} className="tag" title={topic.name}>{tag.name}</span>
                  ))}
                </div>
              )}
              <p className="meta">
                {s.screens} screen{s.screens === 1 ? "" : "s"} · {s.scenarios} scenario{s.scenarios === 1 ? "" : "s"}
              </p>
              <div className="row">
                <a className="btn primary sm" href={`#/play/${s.id}`}>Play</a>
                <a className="btn sm" href={`#/edit/${s.id}`}>Edit</a>
                <a className="btn sm ghost" href={`#/results/${s.id}`}>Results</a>
                <span className="spacer" />
                <a className="btn sm ghost" href={exportUrl(s.id)} download title="Export as a file (includes images)">⤓</a>
                <button className="btn sm ghost" onClick={() => duplicate(s)} title="Duplicate">⧉</button>
                <button className="btn sm ghost danger" onClick={() => remove(s)} title="Delete">✕</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
