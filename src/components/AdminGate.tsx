/** Shows whether the viewer can edit admin-only things, with a PIN form to unlock. */
import { useState } from "react";
import { api } from "../api";
import { setAdminPin, useAdmin } from "../lib/admin";

export function AdminBar({ what }: { what: string }) {
  const admin = useAdmin();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!admin.ready) return null;
  if (!admin.pinRequired) {
    return (
      <div className="alert info small">
        No Admin-Builder PIN is set, so anyone using this app can edit {what}. To restrict editing to the Admin-Builder, set{" "}
        <code>ADMIN_PIN</code> in <code>.env</code> and restart.
      </div>
    );
  }
  if (admin.isAdmin) {
    return (
      <div className="alert info small admin-bar">
        <span>🔓 Admin-Builder: you can edit {what}.</span>
        <button className="btn sm ghost" onClick={admin.lock}>Lock</button>
      </div>
    );
  }
  const unlock = async () => {
    setBusy(true);
    setError("");
    try {
      await api.verifyPin(pin);
      setAdminPin(pin);
      setPin("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="alert warn admin-bar"
      onSubmit={(e) => {
        e.preventDefault();
        unlock();
      }}
    >
      <span>🔒 View only. Editing {what} is for the Admin-Builder: enter the PIN to unlock.</span>
      <input type="password" value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Admin-Builder PIN" aria-label="Admin PIN" autoComplete="off" />
      <button className="btn sm" disabled={!pin || busy}>{busy ? "Checking…" : "Unlock"}</button>
      {error && <span className="text-error small">{error}</span>}
    </form>
  );
}
