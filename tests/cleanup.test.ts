import { describe, expect, it } from "vitest";
import { CLEANUP_GRACE_MS, findUnusedImages } from "../server/cleanup";

describe("unused image clean-up", () => {
  const now = 10 * CLEANUP_GRACE_MS;
  const old = now - CLEANUP_GRACE_MS - 1;
  const fresh = now - 1000;
  const files = [
    { id: "img-used.png", size: 100, mtimeMs: old },
    { id: "img-orphan.png", size: 200, mtimeMs: old },
    { id: "img-just-uploaded.png", size: 300, mtimeMs: fresh },
  ];

  it("only offers old images that nothing references", () => {
    const r = findUnusedImages(files, new Set(["img-used.png"]), now);
    expect(r.total).toEqual({ count: 3, bytes: 600 });
    expect(r.removable).toEqual({ count: 1, bytes: 200, ids: ["img-orphan.png"] });
    expect(r.recentUnused).toBe(1);
  });

  it("removes nothing when everything is in use", () => {
    const r = findUnusedImages(files, new Set(files.map((f) => f.id)), now);
    expect(r.removable.count).toBe(0);
    expect(r.recentUnused).toBe(0);
  });
});
