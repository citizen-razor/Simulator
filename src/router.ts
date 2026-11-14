/** Minimal hash router: #/play/abc?mode=guided → { path: ["play","abc"], query: {mode:"guided"} } */
import { useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [p, q] = raw.split("?");
  return { path: p ? p.split("/").map(decodeURIComponent) : [], query: new URLSearchParams(q ?? "") };
}

/**
 * A page with unsaved work registers a guard. Before the route changes, the guard is
 * asked; if it returns false, the previous address is restored and the page stays put.
 */
type LeaveGuard = () => boolean;
let leaveGuard: LeaveGuard | null = null;
let skipGuardOnce = false;
let currentHash = window.location.hash;

export function setLeaveGuard(guard: LeaveGuard | null) {
  leaveGuard = guard;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      if (window.location.hash === currentHash) return;
      const skip = skipGuardOnce;
      skipGuardOnce = false;
      if (!skip && leaveGuard && !leaveGuard()) {
        // Put the old address back without firing another hashchange.
        history.replaceState(null, "", currentHash || "#/");
        return;
      }
      currentHash = window.location.hash;
      setRoute(parse());
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Navigate in code. `force` skips the leave guard (e.g. after saving). */
export function navigate(to: string, { force = false } = {}) {
  const hash = to.startsWith("#") ? to : `#${to}`;
  if (hash === window.location.hash) return;
  if (force) skipGuardOnce = true;
  window.location.hash = hash;
}
