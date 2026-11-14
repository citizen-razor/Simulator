/**
 * Admin mode in the browser. The server says whether a PIN is required; once the PIN
 * is verified it's kept for this browser tab only (sessionStorage) and sent with
 * requests as X-Admin-Pin. Without a PIN configured on the server, everyone is admin.
 */
import { useEffect, useState } from "react";

const KEY = "simulator.adminPin";
let pin: string | null = (() => {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
let pinRequired: boolean | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const adminPin = () => pin;

export function setAdminPin(next: string | null) {
  pin = next;
  try {
    if (next) sessionStorage.setItem(KEY, next);
    else sessionStorage.removeItem(KEY);
  } catch {
    /* still works for this page */
  }
  notify();
}

/** { ready, isAdmin, pinRequired, lock } — isAdmin is true when no PIN is configured or it's been entered. */
export function useAdmin() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (pinRequired === null) {
      fetch("/api/admin/status")
        .then((r) => r.json())
        .then((s: { pinRequired: boolean }) => {
          pinRequired = s.pinRequired;
          notify();
        })
        .catch(() => undefined);
    }
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    ready: pinRequired !== null,
    pinRequired: !!pinRequired,
    isAdmin: pinRequired === false || !!pin,
    lock: () => setAdminPin(null),
  };
}
