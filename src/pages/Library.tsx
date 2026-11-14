import { useEffect, useState } from "react";
import { api, assetUrl, type SimSummary } from "../api";

export default function Library() {
  const [sims, setSims] = useState<SimSummary[] | null>(null);
  const [error, setError] = useState("");

  const load = () => api.list().then(setSims).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const remove = async (s: SimSummary) => {
    if (!confirm(`Delete "${s.title}"? This can't be undone.`)) return;
    await api.remove(s.id);
    load();
  };

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
        <a className="btn primary" href="#/new">+ New simulation</a>
      </div>
      {error && <div className="alert error">Couldn't reach the server: {error}</div>}
      {sims && sims.length === 0 && (
        <div className="empty">
          <p>No simulations yet.</p>
          <a className="btn primary" href="#/new">Create your first one</a>
        </div>
      )}
      <div className="card-grid">
        {sims?.map((s) => (
          <article key={s.id} className="sim-card">
            <a className="sim-cover" href={`#/play/${s.id}`}>
              {s.cover ? <img src={assetUrl(s.cover)} alt="" /> : <span className="cover-placeholder">◧</span>}
            </a>
            <div className="sim-card-body">
              <h2>{s.title}</h2>
              <p className="muted clamp-2">{s.description || "No description"}</p>
              <p className="meta">
                {s.screens} screen{s.screens === 1 ? "" : "s"} · {s.scenarios} scenario{s.scenarios === 1 ? "" : "s"}
              </p>
              <div className="row">
                <a className="btn primary sm" href={`#/play/${s.id}`}>Play</a>
                <a className="btn sm" href={`#/edit/${s.id}`}>Edit</a>
                <a className="btn sm ghost" href={`#/results/${s.id}`}>Results</a>
                <span className="spacer" />
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
