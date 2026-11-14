/**
 * Leaderboards (shared/leaderboard.ts; computed on the server). Everyone in the
 * organisation appears by name. Tabs: Organisation, My team (leaders), By topic, By scenario.
 */
import { useEffect, useState } from "react";
import type { Taxonomy } from "../../shared/library";
import type { Simulation } from "../../shared/schema";
import { api, type LeaderRow, type SimSummary } from "../api";
import { useAuth } from "../lib/auth";

type Tab = "org" | "team" | "topic" | "scenario";

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

export default function Leaderboard() {
  const auth = useAuth();
  const [tab, setTab] = useState<Tab>("org");
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [error, setError] = useState("");
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ topics: [] });
  const [topicId, setTopicId] = useState("");
  const [sims, setSims] = useState<SimSummary[]>([]);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [scenarioId, setScenarioId] = useState("");

  useEffect(() => {
    api.taxonomy().then((t) => {
      setTaxonomy(t);
      setTopicId(t.topics[0]?.id ?? "");
    }).catch(() => undefined);
    api.list().then((s) => setSims(s.filter((x) => x.scenarios > 0))).catch(() => undefined);
  }, []);

  const scope = tab === "org" ? "org" : tab === "team" ? "team" : tab === "topic" ? (topicId ? `topic:${topicId}` : "") : sim && scenarioId ? `scenario:${sim.id}/${scenarioId}` : "";
  useEffect(() => {
    setRows(null);
    setError("");
    if (!scope) return;
    api.leaderboard(scope).then((r) => setRows(r.rows)).catch((e) => setError(e.message));
  }, [scope]);

  const mine = rows?.find((r) => r.userId === auth.user?.id);
  const isScenario = tab === "scenario";
  const tabs: [Tab, string][] = [["org", "Organisation"], ...(auth.isLeader ? ([["team", "My team"]] as [Tab, string][]) : []), ["topic", "By topic"], ["scenario", "By scenario"]];

  return (
    <div className="page narrow">
      <h1>Leaderboard</h1>
      <p className="muted">
        {isScenario
          ? "Best score in Scenario mode without guided help; ties go to the faster time."
          : "Ranked by scenarios mastered (completed solo at the mastery mark), then by average solo score."}
      </p>
      <div className="segmented page-tabs" role="tablist">
        {tabs.map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>

      {tab === "topic" && (
        taxonomy.topics.length ? (
          <label className="field inline">
            <span>Topic</span>
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              {taxonomy.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        ) : <p className="muted">No topics yet.</p>
      )}
      {tab === "scenario" && (
        <div className="row tight-top">
          <select value={sim?.id ?? ""} aria-label="Simulation" onChange={async (e) => {
            setScenarioId("");
            if (!e.target.value) return setSim(null);
            const s = await api.get(e.target.value);
            setSim(s);
            setScenarioId(s.scenarios[0]?.id ?? "");
          }}>
            <option value="">Choose a simulation…</option>
            {sims.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
          {sim && (
            <select value={scenarioId} aria-label="Scenario" onChange={(e) => setScenarioId(e.target.value)}>
              {sim.scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          )}
        </div>
      )}

      {error && <div className="alert error">{error}</div>}
      {rows && (
        <>
          <div className={`standing ${mine ? "" : "unranked"}`}>
            {mine ? (
              <>You're <b>#{mine.rank}</b> of {rows.length}{isScenario ? ` with ${mine.best}` : mine.mastered ? `, with ${mine.mastered} mastered` : ""}.</>
            ) : isScenario ? (
              <>You're not on this board yet: complete this scenario in Scenario mode without guided help.</>
            ) : (
              <>You're not on this board yet: complete a scenario to appear.</>
            )}
          </div>
          {rows.length === 0 ? (
            <div className="empty"><p>Nobody here yet.</p></div>
          ) : (
            <table className="results-table leaderboard">
              <thead>
                {isScenario ? (
                  <tr><th>#</th><th>Name</th><th>Best score</th><th>Time</th><th>Attempts</th></tr>
                ) : (
                  <tr><th>#</th><th>Name</th><th>Mastered</th><th>Average solo score</th><th>Scenarios tried</th></tr>
                )}
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.userId} className={r.userId === auth.user?.id ? "me" : ""}>
                    <td className="rank">{r.rank <= 3 ? ["🥇", "🥈", "🥉"][r.rank - 1] : r.rank}</td>
                    <td>{r.name}{r.userId === auth.user?.id && <span className="badge">you</span>}</td>
                    {isScenario ? (
                      <>
                        <td><b>{r.best}</b></td>
                        <td>{fmt(r.durationSec ?? 0)}</td>
                        <td>{r.attempts}</td>
                      </>
                    ) : (
                      <>
                        <td><b>{r.mastered}</b></td>
                        <td>{r.avgSolo ?? <span className="muted">–</span>}</td>
                        <td>{r.attempted}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
