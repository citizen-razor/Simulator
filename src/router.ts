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

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to.startsWith("#") ? to : `#${to}`;
}
