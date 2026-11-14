/**
 * Box-alignment helpers shared by the browser and the tests.
 *
 * The alignment pass numbers a screen's elements 1..N, shows Claude the screenshot
 * with those numbered boxes and a percentage grid drawn on it, and gets back a
 * corrected box per number. These functions turn that reply into element rects.
 */
import type { Rect, SimElement } from "./schema";

export interface AlignedBox {
  n: number;
  found: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
}

const round = (v: number) => Math.round(v * 10) / 10;

/** Keep a box inside the screen and at least 0.5% in each dimension. */
export function clampRect(r: Rect): Rect {
  const fin = (v: number, d: number) => (Number.isFinite(v) ? v : d);
  const w = Math.min(100, Math.max(0.5, fin(r.w, 1)));
  const h = Math.min(100, Math.max(0.5, fin(r.h, 1)));
  const x = Math.min(100 - w, Math.max(0, fin(r.x, 0)));
  const y = Math.min(100 - h, Math.max(0, fin(r.y, 0)));
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

export interface AlignOutcome {
  /** New rect per element id (only elements whose box changed). */
  rects: Record<string, Rect>;
  /** Labels of elements Claude couldn't find in the screenshot (boxes left as they were). */
  notFound: string[];
}

/** Map numbered results back to elements. Element n is `elements[n - 1]`. Unknown numbers are ignored. */
export function mergeAlignment(elements: SimElement[], boxes: AlignedBox[]): AlignOutcome {
  const rects: Record<string, Rect> = {};
  const notFound: string[] = [];
  const seen = new Set<number>();
  for (const b of boxes) {
    const el = elements[b.n - 1];
    if (!el || seen.has(b.n)) continue;
    seen.add(b.n);
    if (!b.found) {
      notFound.push(el.label || el.id);
      continue;
    }
    const next = clampRect(b);
    const cur = el.rect;
    if (next.x !== cur.x || next.y !== cur.y || next.w !== cur.w || next.h !== cur.h) rects[el.id] = next;
  }
  return { rects, notFound };
}
