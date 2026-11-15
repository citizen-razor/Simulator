/**
 * Who's signed in, shared by every page. The server decides everything (the session is an
 * HttpOnly cookie the page can't read); this just asks /api/auth/state and keeps the answer.
 */
import { useEffect, useState } from "react";
import type { Role, User } from "../../shared/people";

export interface AuthState {
  loading: boolean;
  setupNeeded: boolean;
  user: User | null;
  roles: Role[];
  org: string;
}

let state: AuthState = { loading: true, setupNeeded: false, user: null, roles: [], org: "" };
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function refreshAuth() {
  try {
    const r = await fetch("/api/auth/state");
    const s = await r.json();
    state = { loading: false, setupNeeded: !!s.setupNeeded, user: s.user ?? null, roles: s.roles ?? [], org: s.org ?? "" };
  } catch {
    state = { ...state, loading: false };
  }
  notify();
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST", headers: { "X-Simulator": "1" } });
  window.location.hash = "#/";
  await refreshAuth();
}

export function useAuth() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (state.loading) refreshAuth();
    return () => {
      listeners.delete(l);
    };
  }, []);
  const has = (r: Role) => state.roles.includes(r);
  return { ...state, has, isAdmin: has("admin"), isBuilder: has("builder"), isLeader: has("leader") };
}
