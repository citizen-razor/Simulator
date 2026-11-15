import { describe, expect, it } from "vitest";
import { clampRect, mergeAlignment } from "../shared/layout";
import type { SimElement } from "../shared/schema";

const el = (id: string, x = 10, y = 10): SimElement => ({ id, label: id.toUpperCase(), kind: "button", rect: { x, y, w: 10, h: 5 }, rules: [] });

describe("box alignment", () => {
  it("clamps boxes inside the screen", () => {
    expect(clampRect({ x: -4, y: 98, w: 20, h: 10 })).toEqual({ x: 0, y: 90, w: 20, h: 10 });
    expect(clampRect({ x: 50, y: 50, w: 0, h: Number.NaN })).toEqual({ x: 50, y: 50, w: 0.5, h: 1 });
  });

  it("maps numbers to elements and reports what wasn't found", () => {
    const els = [el("a"), el("b"), el("c")];
    const out = mergeAlignment(els, [
      { n: 1, found: true, x: 12.04, y: 11, w: 9, h: 4 },
      { n: 2, found: false, x: 0, y: 0, w: 1, h: 1 },
      { n: 3, found: true, x: 10, y: 10, w: 10, h: 5 }, // unchanged
      { n: 9, found: true, x: 1, y: 1, w: 1, h: 1 }, // no such element
      { n: 1, found: true, x: 80, y: 80, w: 5, h: 5 }, // duplicate ignored
    ]);
    expect(out.rects).toEqual({ a: { x: 12, y: 11, w: 9, h: 4 } });
    expect(out.notFound).toEqual(["B"]);
  });
});
