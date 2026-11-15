/**
 * People (Admin-Builders): everyone in the organisation, their roles and managers, adding
 * people, CSV import, password resets, and the SCIM connection for identity providers.
 */
import { useEffect, useMemo, useState } from "react";
import { effectiveRoles, reportingTree, Roles, ROLE_LABEL, type Role, type User } from "../../shared/people";
import { api } from "../api";
import { MIN_PASSWORD_LENGTH } from "../lib/constants";
import { useAuth } from "../lib/auth";

const EDITABLE_ROLES: Role[] = ["admin", "builder", "leader"];
const ROLE_HELP: Record<Role, string> = {
  admin: "Everything: libraries (tags, grading, personas), assignments, marking, storage, people",
  builder: "Builds simulations and scenarios",
  leader: "Sees and assigns to their reporting tree. Automatic for anyone with reports",
  learner: "Everyone: takes simulations, sees own results and the leaderboard",
};

function OneTime({ label, value, onClose }: { label: string; value: string; onClose: () => void }) {
  return (
    <div className="alert info one-time">
      <div>{label}</div>
      <code className="secret">{value}</code>
      <div className="row tight-top">
        <button className="btn sm" onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
        <button className="btn sm ghost" onClick={onClose}>Done</button>
        <span className="muted small">Shown once. Share it privately; they can change it after signing in.</span>
      </div>
    </div>
  );
}

export default function People() {
  const auth = useAuth();
  const [people, setPeople] = useState<User[] | null>(null);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [filter, setFilter] = useState("");
  const load = () => api.people().then(setPeople).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  if (!people) return <div className="page muted">{error || "Loading…"}</div>;

  const update = async (id: string, patch: Parameters<typeof api.updatePerson>[1]) => {
    setError("");
    try {
      await api.updatePerson(id, patch);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const shown = people
    .filter((p) => !filter || `${p.name} ${p.email}`.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted">
            {people.filter((p) => p.active).length} active in {auth.org}. Roles stack; everyone can learn, and anyone with people reporting
            to them is a Leader automatically.
          </p>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {secret && <OneTime label={secret.label} value={secret.value} onClose={() => setSecret(null)} />}

      <div className="role-legend small">
        {Roles.map((r) => <span key={r}><b>{ROLE_LABEL[r]}</b>: {ROLE_HELP[r]}</span>)}
      </div>

      <div className="row filter-row">
        <input placeholder="Search people" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search people" />
      </div>
      <div className="table-scroll">
        <table className="results-table people-table">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Roles</th><th>Reports to</th><th>Team</th><th>Status</th><th /></tr>
          </thead>
          <tbody>
            {shown.map((p) => {
              const effective = effectiveRoles(p, people);
              const team = reportingTree(people, p.id).size;
              return (
                <tr key={p.id} className={p.active ? "" : "inactive"}>
                  <td><b>{p.name}</b>{p.externalId && <div className="muted small" title="Synced from your identity provider">via SCIM</div>}</td>
                  <td className="small">{p.email}</td>
                  <td>
                    <div className="role-toggles">
                      {EDITABLE_ROLES.map((r) => {
                        const auto = r === "leader" && effective.has("leader") && !p.roles.includes("leader");
                        return (
                          <label key={r} title={auto ? "Automatic: this person has people reporting to them" : ROLE_HELP[r]} className={auto ? "auto" : ""}>
                            <input
                              type="checkbox"
                              checked={p.roles.includes(r) || auto}
                              disabled={auto || !p.active}
                              onChange={(e) => update(p.id, { roles: e.target.checked ? [...p.roles, r] : p.roles.filter((x) => x !== r) })}
                            />
                            {ROLE_LABEL[r]}
                          </label>
                        );
                      })}
                    </div>
                  </td>
                  <td>
                    <select value={p.managerId ?? ""} aria-label={`${p.name} reports to`} disabled={!p.active} onChange={(e) => update(p.id, { managerId: e.target.value || null })}>
                      <option value="">— nobody —</option>
                      {people.filter((m) => m.id !== p.id && m.active).sort((a, b) => a.name.localeCompare(b.name)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      {p.managerId && !byId.get(p.managerId)?.active && <option value={p.managerId}>{byId.get(p.managerId)?.name ?? "?"} (inactive)</option>}
                    </select>
                  </td>
                  <td title="Everyone below them in the reporting line">{team || <span className="muted">–</span>}</td>
                  <td>
                    <label className="check-line tight">
                      <input type="checkbox" checked={p.active} disabled={p.id === auth.user?.id} onChange={(e) => update(p.id, { active: e.target.checked })} />
                      {p.active ? "Active" : "Deactivated"}
                    </label>
                  </td>
                  <td>
                    <button
                      className="btn sm ghost"
                      disabled={!p.active}
                      onClick={async () => {
                        if (!confirm(`Reset ${p.name}'s password? They'll be signed out everywhere.`)) return;
                        try {
                          const r = await api.resetPassword(p.id);
                          setSecret({ label: `Temporary password for ${p.name} (${p.email}):`, value: r.temporaryPassword });
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Reset password
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <LinkResults people={people} />

      <div className="people-tools">
        <AddPerson people={people} onAdded={(name, email, pw) => { setSecret({ label: `Temporary password for ${name} (${email}):`, value: pw }); load(); }} />
        <ImportPeople onDone={load} />
        <ScimPanel />
      </div>
    </div>
  );
}

/**
 * Results saved before accounts, under a typed name that matches no one (or several people).
 * Shown only when there are some.
 */
function LinkResults({ people }: { people: User[] }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.unlinkedResults>>>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [done, setDone] = useState("");
  const [error, setError] = useState("");
  const load = () => api.unlinkedResults().then(setRows).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);
  if (!rows.length && !done) return null;
  const active = [...people].filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));
  const link = async (trainee: string) => {
    setError("");
    try {
      const userId = pick[trainee];
      const r = await api.linkResults(trainee, userId);
      setDone(`Linked ${r.attempts} result${r.attempts === 1 ? "" : "s"}${r.assignments ? ` and ${r.assignments} assignment${r.assignments === 1 ? "" : "s"}` : ""} for "${trainee}" to ${people.find((p) => p.id === userId)?.name}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="panel link-results">
      <h3>Results saved under typed names</h3>
      <p className="muted small">
        These results were saved before sign-in, under a name that matches no one here, or several people. Choose who each name is, and their results
        and assignments move to that person's progress and the leaderboard.
      </p>
      {done && <div className="alert info small">{done}</div>}
      {error && <div className="alert error small">{error}</div>}
      {rows.length > 0 && (
        <table className="results-table">
          <thead><tr><th>Typed name</th><th>Results</th><th>Last</th><th>Who is it?</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const candidates = active.filter((p) => r.candidates.includes(p.id));
              return (
                <tr key={r.trainee}>
                  <td><b>{r.trainee}</b>{candidates.length > 1 && <div className="muted small">{candidates.length} people have this name</div>}</td>
                  <td>{r.attempts}</td>
                  <td>{new Date(r.last).toLocaleDateString()}</td>
                  <td>
                    <select value={pick[r.trainee] ?? ""} aria-label={`Person for ${r.trainee}`} onChange={(e) => setPick({ ...pick, [r.trainee]: e.target.value })}>
                      <option value="">Choose a person…</option>
                      {candidates.length > 0 && (
                        <optgroup label="Same name">{candidates.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}</optgroup>
                      )}
                      <optgroup label="Everyone">{active.filter((p) => !r.candidates.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}</optgroup>
                    </select>
                  </td>
                  <td><button className="btn sm primary" disabled={!pick[r.trainee]} onClick={() => link(r.trainee)}>Link</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AddPerson({ people, onAdded }: { people: User[]; onAdded: (name: string, email: string, password: string) => void }) {
  const [f, setF] = useState({ name: "", email: "", managerId: "", roles: [] as Role[] });
  const [error, setError] = useState("");
  return (
    <form
      className="panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          const r = await api.addPerson({ name: f.name, email: f.email, managerId: f.managerId || null, roles: f.roles.length ? f.roles : ["learner"] });
          onAdded(f.name, f.email, r.temporaryPassword);
          setF({ name: "", email: "", managerId: "", roles: [] });
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h3>Add a person</h3>
      <label className="field"><span>Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
      <label className="field"><span>Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      <label className="field">
        <span>Reports to</span>
        <select value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}>
          <option value="">— nobody —</option>
          {people.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <div className="role-toggles">
        {(["admin", "builder"] as Role[]).map((r) => (
          <label key={r}>
            <input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />
            {ROLE_LABEL[r]}
          </label>
        ))}
      </div>
      {error && <div className="alert error small">{error}</div>}
      <button className="btn primary" disabled={!f.name || !f.email}>Add</button>
      <p className="muted small">They get a one-time password (at least {MIN_PASSWORD_LENGTH} characters) to change after signing in.</p>
    </form>
  );
}

function ImportPeople({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.importPeople>> | null>(null);
  const [error, setError] = useState("");
  const download = () => {
    if (!result) return;
    const rows = ["email,name,temporary_password", ...result.created.map((c) => `${c.email},"${c.name.replace(/"/g, '""')}",${c.temporaryPassword}`)];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = "new-people-passwords.csv";
    a.click();
  };
  return (
    <div className="panel">
      <h3>Import from CSV</h3>
      <p className="muted small">
        Columns: <code>email, name, manager_email, roles</code> (roles: admin-builder, builder, leader, learner; separate several with
        ;). Existing people (by email) are updated; managers can appear anywhere in the file.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={async (e) => e.target.files?.[0] && setCsv(await e.target.files[0].text())} />
      <textarea rows={4} value={csv} placeholder={"email,name,manager_email,roles\nana@acme.example,Ana Silva,,leader\ncai@acme.example,Cai Lin,ana@acme.example,"} onChange={(e) => setCsv(e.target.value)} />
      {error && <div className="alert error small">{error}</div>}
      <button
        className="btn"
        disabled={!csv.trim()}
        onClick={async () => {
          setError("");
          try {
            const r = await api.importPeople(csv);
            setResult(r);
            setCsv("");
            onDone();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        Import
      </button>
      {result && (
        <div className="alert info small">
          {result.created.length} added, {result.updated} updated.
          {result.created.length > 0 && <> <button className="link-btn add" onClick={download}>Download their one-time passwords (CSV)</button></>}
          {result.errors.length > 0 && <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function ScimPanel() {
  const [status, setStatus] = useState<{ enabled: boolean; path: string } | null>(null);
  const [token, setToken] = useState("");
  const load = () => api.scimStatus().then(setStatus).catch(() => undefined);
  useEffect(() => {
    load();
  }, []);
  const url = `${window.location.origin}${status?.path ?? "/scim/v2"}`;
  return (
    <div className="panel">
      <h3>Sync from your identity provider (SCIM)</h3>
      <p className="muted small">
        Okta, Microsoft Entra ID and others can create, update and deactivate people here automatically, including who reports to whom.
        Use SCIM 2.0 with the base URL and token below. This works once the app is hosted where your identity provider can reach it.
      </p>
      <p className="small"><b>Base URL:</b> <code>{url}</code></p>
      <p className="small"><b>Status:</b> {status?.enabled ? "a token is active" : "off (no token)"}</p>
      {token && <OneTime label="Bearer token (paste into your identity provider):" value={token} onClose={() => setToken("")} />}
      <div className="row tight-top">
        <button
          className="btn sm"
          onClick={async () => {
            if (status?.enabled && !confirm("Issue a new token? The current one stops working.")) return;
            setToken((await api.issueScim()).token);
            load();
          }}
        >
          {status?.enabled ? "Replace token" : "Turn on: issue token"}
        </button>
        {status?.enabled && (
          <button className="btn sm ghost danger" onClick={async () => { if (confirm("Turn off SCIM? Syncing stops.")) { await api.revokeScim(); load(); } }}>
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}
