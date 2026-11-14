/** Sign-in, first-run setup, and the account page (change password). */
import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "../lib/constants";
import { api } from "../api";
import { refreshAuth, useAuth } from "../lib/auth";
import { ROLE_LABEL } from "../../shared/people";

export function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="auth-page">
      <form
        className="panel auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api.login(email, password);
            await refreshAuth();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1><span className="brand-mark">◧</span> Simulator</h1>
        <p className="muted">Sign in to continue.</p>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {error && <div className="alert error small">{error}</div>}
        <button className="btn primary" disabled={!email || !password || busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="muted small">Forgotten your password? Ask an Admin-Builder to reset it.</p>
      </form>
    </div>
  );
}

export function Setup() {
  const [f, setF] = useState({ orgName: "", name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="auth-page">
      <form
        className="panel auth-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            await api.setup(f);
            await refreshAuth();
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h1><span className="brand-mark">◧</span> Welcome</h1>
        <p className="muted">Set up your organisation. You'll be its first Admin-Builder; you can add everyone else afterwards.</p>
        <label className="field"><span>Organisation name</span><input value={f.orgName} onChange={set("orgName")} autoFocus /></label>
        <label className="field"><span>Your name</span><input value={f.name} onChange={set("name")} /></label>
        <label className="field"><span>Your email</span><input type="email" autoComplete="username" value={f.email} onChange={set("email")} /></label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="new-password" value={f.password} onChange={set("password")} />
          <small className="muted">At least {MIN_PASSWORD_LENGTH} characters.</small>
        </label>
        {error && <div className="alert error small">{error}</div>}
        <button className="btn primary" disabled={!f.orgName || !f.name || !f.email || f.password.length < MIN_PASSWORD_LENGTH}>Create organisation</button>
      </form>
    </div>
  );
}

export function Account() {
  const auth = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="page narrow">
      <h1>Your account</h1>
      <div className="panel">
        <p><b>{auth.user?.name}</b> · {auth.user?.email}</p>
        <p className="muted small">{auth.org} · {auth.roles.map((r) => ROLE_LABEL[r]).join(", ")}</p>
      </div>
      <form
        className="panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setMsg("");
          setError("");
          try {
            await api.changePassword(current, next);
            setCurrent("");
            setNext("");
            setMsg("Password changed.");
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      >
        <h3>Change password</h3>
        <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></label>
        <label className="field">
          <span>New password</span>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <small className="muted">At least {MIN_PASSWORD_LENGTH} characters.</small>
        </label>
        {error && <div className="alert error small">{error}</div>}
        {msg && <div className="alert info small">{msg}</div>}
        <button className="btn primary" disabled={!current || next.length < MIN_PASSWORD_LENGTH}>Change password</button>
      </form>
    </div>
  );
}
