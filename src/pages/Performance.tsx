/**
 * Course performance for Builders and Admin-Builders (shared/analytics.ts, computed on the
 * server). Aggregate only: counts, rates and averages across every learner, never names.
 *   #/performance          every simulation with its headline figures
 *   #/performance/<simId>  per scenario: score spread, rubric criteria at the point level,
 *                          points lost to penalties, trouble steps, where unfinished runs stopped
 */
import { useEffect, useState } from "react";
import { overviewCsv, performanceCsv, type ScenarioAnalysis, type SimulationAnalysis, type Stats, type WeekStats } from "../../shared/analytics";
import type { Taxonomy } from "../../shared/library";
import { api, type DirectoryPerson, type PerformanceRow } from "../api";

const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);
const num = (x: number | null) => (x === null ? "–" : String(x));
const dur = (sec: number | null) => (sec === null ? "–" : `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`);

type Range = { from?: string; to?: string; team?: string };
// The chosen dates carry over between the list and a course while the app is open.
let lastRange: Range = {};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** People with active reports: the teams Performance can be filtered to. */
function useLeaders() {
  const [leaders, setLeaders] = useState<DirectoryPerson[]>([]);
  useEffect(() => {
    api
      .directory()
      .then((d) => setLeaders(d.filter((p) => p.active && d.some((x) => x.active && x.managerId === p.id)).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => undefined);
  }, []);
  return leaders;
}

function DateRange({ range, onChange, children }: { range: Range; onChange: (r: Range) => void; children?: React.ReactNode }) {
  const leaders = useLeaders();
  const set = (r: Range) => {
    lastRange = r;
    onChange(r);
  };
  const daysAgo = (n: number) => isoDay(new Date(Date.now() - n * 86_400_000));
  return (
    <div className="date-range">
      {leaders.length > 0 && (
        <label>
          Team
          <select value={range.team ?? ""} onChange={(e) => set({ ...range, team: e.target.value || undefined })}>
            <option value="">Everyone</option>
            {leaders.map((l) => <option key={l.id} value={l.id}>{l.name}'s team</option>)}
          </select>
        </label>
      )}
      {children}
      <label>From <input type="date" value={range.from ?? ""} max={range.to} onChange={(e) => set({ ...range, from: e.target.value || undefined })} /></label>
      <label>To <input type="date" value={range.to ?? ""} min={range.from} onChange={(e) => set({ ...range, to: e.target.value || undefined })} /></label>
      <button className="btn sm ghost" onClick={() => set({ from: daysAgo(30) })}>Last 30 days</button>
      <button className="btn sm ghost" onClick={() => set({ from: daysAgo(90) })}>Last 90 days</button>
      {(range.from || range.to) && <button className="btn sm ghost" onClick={() => set({ team: range.team })}>All time</button>}
    </div>
  );
}

/** Save text as a file in the browser. */
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" })); // BOM so Excel reads UTF-8
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileSafe = (s: string) => s.replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "course";
const rangeSuffix = (r: Range) => (r.from || r.to ? `-${r.from ?? "start"}-to-${r.to ?? isoDay(new Date())}` : "");

export default function Performance({ simulationId }: { simulationId?: string }) {
  return simulationId ? <SimPerformance id={simulationId} /> : <Overview />;
}

function Overview() {
  const [rows, setRows] = useState<PerformanceRow[] | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<Range>(lastRange);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({ topics: [] });
  const [topicId, setTopicId] = useState("");
  useEffect(() => {
    api.taxonomy().then(setTaxonomy).catch(() => undefined);
  }, []);
  useEffect(() => {
    setRows(null);
    api.performance(range).then(setRows).catch((e) => setError(e.message));
  }, [range]);
  const topic = taxonomy.topics.find((t) => t.id === topicId);
  const shown = rows && topic ? rows.filter((r) => r.tagIds.some((id) => topic.tags.some((t) => t.id === id))) : rows;
  const csvRows = (shown ?? []).filter((r) => !r.hidden);
  return (
    <div className="page">
      <div className="row">
        <h1>Performance</h1>
        <span className="spacer" />
        {csvRows.length > 0 && (
          <button className="btn" onClick={() => download(`performance${topic ? `-${fileSafe(topic.name)}` : ""}${rangeSuffix(range)}.csv`, overviewCsv(csvRows))}>⤓ Download CSV</button>
        )}
      </div>
      <p className="muted">How each course is doing across all learners. Figures are totals and averages; no one is named.</p>
      <DateRange range={range} onChange={setRange}>
        {taxonomy.topics.length > 0 && (
          <label>
            Topic
            <select value={topicId} onChange={(e) => setTopicId(e.target.value)}>
              <option value="">All topics</option>
              {taxonomy.topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </DateRange>
      {error && <div className="alert error">{error}</div>}
      {!rows || !shown ? (
        !error && <p className="muted">Loading…</p>
      ) : !shown.length ? (
        <div className="empty"><p>{rows.length ? "No courses are tagged with this topic." : "No simulations yet."}</p></div>
      ) : (
        <div className="table-scroll">
          <table className="results-table">
            <thead>
              <tr>
                <th>Simulation</th><th>Attempts</th><th>Learners</th><th>Completed</th><th>Passed</th><th>Mastered</th><th>Average score</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => (location.hash = `#/performance/${r.id}`)}>
                  <td><a href={`#/performance/${r.id}`}>{r.title}</a> <span className="muted small">· {r.scenarios} scenario{r.scenarios === 1 ? "" : "s"}</span></td>
                  {r.hidden ? (
                    <td colSpan={6} className="muted">Fewer than 3 of this team's learners, so not shown</td>
                  ) : r.stats.attempts ? (
                    <>
                      <td>{r.stats.attempts}</td>
                      <td>{r.stats.learners}</td>
                      <td>{pct(r.stats.completedRate)}</td>
                      <td>{pct(r.stats.passRate)}</td>
                      <td>{pct(r.stats.masteredRate)}</td>
                      <td>{num(r.stats.avgScore)}</td>
                    </>
                  ) : (
                    <td colSpan={6} className="muted">No attempts yet</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SimPerformance({ id }: { id: string }) {
  const [title, setTitle] = useState("");
  const [guided, setGuided] = useState(true);
  const [data, setData] = useState<SimulationAnalysis | null>(null);
  const [error, setError] = useState("");
  const [range, setRange] = useState<Range>(lastRange);
  useEffect(() => {
    api.get(id).then((s) => setTitle(s.title)).catch(() => undefined);
  }, [id]);
  useEffect(() => {
    setData(null);
    api.simPerformance(id, guided, range).then(setData).catch((e) => setError(e.message));
  }, [id, guided, range]);

  return (
    <div className="page">
      <p className="small"><a href="#/performance">← All courses</a></p>
      <div className="row">
        <h1>{title || "Performance"}</h1>
        <span className="spacer" />
        {data && !data.hidden && (
          <button className="btn" onClick={() => download(`${fileSafe(title)}${rangeSuffix(range)}.csv`, performanceCsv(title || id, data))}>⤓ Download CSV</button>
        )}
        <a className="btn" href={`#/edit/${id}`}>Edit</a>
      </div>
      <p className="muted">Totals and averages across all learners; no one is named.</p>
      <DateRange range={range} onChange={setRange} />
      <label className="check-line">
        <input type="checkbox" checked={guided} onChange={(e) => setGuided(e.target.checked)} /> Include Guided runs
        <span className="muted small"> (untick to see Scenario mode only)</span>
      </label>
      {error && <div className="alert error">{error}</div>}
      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : data.hidden ? (
        <div className="empty"><p>Fewer than 3 of this team's learners have taken this course, so its figures aren't shown. That keeps individual results private.</p></div>
      ) : (
        <>
          <StatTiles s={data.overall} />
          {data.weekly.length > 1 && <WeeklyTable weeks={data.weekly} />}
          {data.scenarios.map((sc) => <ScenarioSection key={sc.scenarioId} sc={sc} />)}
          {!data.scenarios.length && <div className="empty"><p>This simulation has no scenarios.</p></div>}
        </>
      )}
    </div>
  );
}

/** Week by week: attempts (with a bar for the busiest week), learners, average score and pass rate. */
function WeeklyTable({ weeks }: { weeks: WeekStats[] }) {
  const max = Math.max(1, ...weeks.map((w) => w.attempts));
  const shown = weeks.slice(-26);
  return (
    <section className="panel weekly">
      <h4>Week by week{weeks.length > shown.length ? " (last 26 weeks)" : ""}</h4>
      <div className="table-scroll">
        <table className="results-table">
          <thead><tr><th>Week of</th><th className="bar-col">Attempts</th><th>Learners</th><th>Average score</th><th>Passed</th></tr></thead>
          <tbody>
            {shown.map((w) => (
              <tr key={w.week}>
                <td>{new Date(`${w.week}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</td>
                <td className="bar-col">
                  <span className="meter" title={`${w.attempts} attempts`}><span style={{ width: `${(w.attempts / max) * 100}%` }} /></span>
                  <span className="meter-label">{w.attempts}</span>
                </td>
                <td>{w.attempts ? w.learners : "–"}</td>
                <td>{num(w.avgScore)}</td>
                <td>{pct(w.passRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatTiles({ s }: { s: Stats }) {
  return (
    <div className="tiles">
      <div className="tile"><span className="muted small">Attempts</span><b>{s.attempts}</b><span className="muted small">{s.learners} learner{s.learners === 1 ? "" : "s"} · {pct(s.guidedShare)} guided</span></div>
      <div className="tile"><span className="muted small">Completed</span><b>{pct(s.completedRate)}</b><span className="muted small">of attempts</span></div>
      <div className="tile"><span className="muted small">Passed</span><b>{pct(s.passRate)}</b><span className="muted small">of marked attempts</span></div>
      <div className="tile"><span className="muted small">Mastered</span><b>{pct(s.masteredRate)}</b><span className="muted small">of learners</span></div>
      <div className="tile"><span className="muted small">Average score</span><b>{num(s.avgScore)}</b><span className="muted small">median time {dur(s.medianDurationSec)}</span></div>
    </div>
  );
}

function ScenarioSection({ sc }: { sc: ScenarioAnalysis }) {
  const s = sc.stats;
  return (
    <section className="panel perf-scenario">
      <h2>{sc.title}</h2>
      {!s.attempts ? (
        <p className="muted">No attempts yet.</p>
      ) : (
        <>
          <p className="muted small">
            {s.attempts} attempt{s.attempts === 1 ? "" : "s"} by {s.learners} learner{s.learners === 1 ? "" : "s"} · completed {pct(s.completedRate)} · passed {pct(s.passRate)} · mastered {pct(s.masteredRate)} · average {num(s.avgScore)} · median time {dur(s.medianDurationSec)}
          </p>
          <h4>Where points are gained and lost</h4>
          <FlowTable sc={sc} />

          <div className="perf-grid">
            <div>
              <h4>Score spread</h4>
              <ScoreHistogram bins={sc.scoreBins} />
            </div>
            <div>
              <h4>Where unfinished runs stopped</h4>
              <CountList items={sc.stoppedAt.map((t) => ({ label: t.step, count: t.count }))} empty="Every run was finished." unit="run" />
            </div>
          </div>

          <h4>Rubric criteria</h4>
          {sc.rubric.length ? <RubricTable sc={sc} /> : <p className="muted small">This scenario's grading scheme has no rubric; the score is points only.</p>}

          {sc.paths.length > 0 && (
            <>
              <h4>Paths taken</h4>
              <CountList items={sc.paths.map((p) => ({ label: p.name, count: p.count }))} empty="" unit="attempt" />
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Single-series column chart of attempts per 10-point score band; hover a column for its count. */
function ScoreHistogram({ bins }: { bins: number[] }) {
  const W = 320, H = 140, padL = 24, padB = 20, padT = 8;
  const max = Math.max(1, ...bins);
  const bw = (W - padL) / bins.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, i) => i) : [0, Math.round(max / 2), max];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Attempts by score band: ${bins.map((b, i) => `${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${b}`).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W} y1={y(t)} y2={y(t)} className="chart-grid" />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" className="chart-axis">{t}</text>
          </g>
        ))}
        {bins.map((b, i) => {
          const x = padL + i * bw + 1, w = bw - 2, top = y(b), base = y(0), r = Math.min(4, w / 2, base - top);
          const label = `${i * 10}–${i === 9 ? 100 : i * 10 + 9}: ${b} attempt${b === 1 ? "" : "s"}`;
          return (
            <g key={i} className="chart-hit">
              <title>{label}</title>
              <rect x={padL + i * bw} y={padT} width={bw} height={base - padT} fill="transparent" />
              {b > 0 && (
                <path className="chart-bar" d={`M${x},${base} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${base} Z`} />
              )}
              {i % 2 === 0 && <text x={padL + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="chart-axis">{i * 10}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="muted small">Attempts by score (bands of 10). Hover a column for its count.</figcaption>
    </figure>
  );
}

/** The average points ledger for a scenario, in step order: what each step earns, and what errors and hints there cost. */
function FlowTable({ sc }: { sc: ScenarioAnalysis }) {
  const f = sc.flow;
  if (!f.basedOn) return <p className="muted small">No attempts have recorded their steps yet. New attempts will appear here.</p>;
  const rows = [...f.steps, ...f.adjustments];
  const maxGain = Math.max(0.1, ...rows.map((r) => r.avgGained + r.avgMissed));
  const maxLoss = Math.max(0.1, ...rows.map((r) => r.avgLost));
  return (
    <div className="table-scroll">
      <table className="results-table flow-table">
        <thead>
          <tr>
            <th>Step</th>
            <th className="bar-col">Average earned</th>
            <th className="bar-col">Average lost to penalties</th>
            <th>Attempts losing points here</th>
            <th>Errors · hints</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.stepNo !== undefined && <span className="muted">{r.stepNo}. </span>}{r.label}</td>
              <td className="bar-col">
                <span className="meter" title={`${r.avgGained} earned of ${Math.round((r.avgGained + r.avgMissed) * 10) / 10} on offer`}>
                  <span style={{ width: `${(r.avgGained / maxGain) * 100}%` }} />
                </span>
                <span className="meter-label">{r.kind === "floor" || r.avgGained ? `+${r.avgGained}` : "–"}</span>
              </td>
              <td className="bar-col">
                <span className="meter loss" title={`${r.avgLost} points lost per attempt`}><span style={{ width: `${(r.avgLost / maxLoss) * 100}%` }} /></span>
                <span className="meter-label">{r.avgLost ? `−${r.avgLost}` : "–"}</span>
              </td>
              <td>{r.avgLost || r.kind !== "step" ? `${Math.round(r.lostShare * 100)}%` : "–"}</td>
              <td>{r.errors || r.hints ? `${r.errors} · ${r.hints}` : "–"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5} className="muted small">
              Per attempt, in points of the final 100 ({f.basedOn} attempt{f.basedOn === 1 ? "" : "s"}{f.basedOn < sc.stats.attempts ? `; ${sc.stats.attempts - f.basedOn} older ones didn't record their steps` : ""}).
              "Earned" falls below a step's full share when runs stop before it. Rubric points are in the table below.
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RubricTable({ sc }: { sc: ScenarioAnalysis }) {
  const schemes = new Set(sc.rubric.map((c) => c.schemeName));
  return (
    <div className="table-scroll">
      <table className="results-table rubric-perf">
        <thead>
          <tr>
            <th>Criterion</th><th>Worth</th><th>Met</th><th className="bar-col">Met rate</th><th>Average earned</th><th>Awaiting marking</th>
          </tr>
        </thead>
        <tbody>
          {sc.rubric.map((c) => (
            <tr key={c.key}>
              <td>
                {c.label}
                {c.manual && <span className="badge subtle">trainer-marked</span>}
                {schemes.size > 1 && <div className="muted small">{c.schemeName}</div>}
              </td>
              <td>{c.pointsWorth} pts</td>
              <td>{c.met} of {c.met + c.notMet}</td>
              <td className="bar-col">
                <span className="meter" title={`${pct(c.metRate)} met`}><span style={{ width: `${(c.metRate ?? 0) * 100}%` }} /></span>
                <span className="meter-label">{pct(c.metRate)}</span>
              </td>
              <td>{c.avgPointsEarned === null ? "–" : `${c.avgPointsEarned} of ${c.pointsWorth}`}</td>
              <td>{c.awaiting || "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Worth = points of the final 100 the criterion carries. Average earned = worth × met rate (marked attempts only).</p>
    </div>
  );
}

function CountList({ items, empty, unit }: { items: { label: string; count: number }[]; empty: string; unit: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="count-list">
      {items.slice(0, 8).map((i) => (
        <li key={i.label}>
          <span className="count-label">{i.label}</span>
          <span className="meter" title={`${i.count} ${unit}${i.count === 1 ? "" : "s"}`}><span style={{ width: `${(i.count / max) * 100}%` }} /></span>
          <span className="meter-label">{i.count}</span>
        </li>
      ))}
    </ul>
  );
}
