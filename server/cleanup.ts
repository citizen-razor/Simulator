/**
 * Finding stored images that no simulation uses any more.
 *
 * An image is removable when no saved simulation refers to it AND it is older than the
 * grace period. The grace period protects images that were just uploaded but aren't in a
 * saved simulation yet (an editor with unsaved changes, a generation in progress).
 */
export const CLEANUP_GRACE_MS = 24 * 60 * 60 * 1000;

export interface StoredFile {
  id: string;
  size: number;
  mtimeMs: number;
}

export interface UsageReport {
  total: { count: number; bytes: number };
  /** Unused and old enough to delete. */
  removable: { count: number; bytes: number; ids: string[] };
  /** Unused but younger than the grace period, so kept for now. */
  recentUnused: number;
}

export function findUnusedImages(files: StoredFile[], referenced: Set<string>, now = Date.now(), graceMs = CLEANUP_GRACE_MS): UsageReport {
  const unused = files.filter((f) => !referenced.has(f.id));
  const removable = unused.filter((f) => now - f.mtimeMs >= graceMs);
  return {
    total: { count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) },
    removable: { count: removable.length, bytes: removable.reduce((n, f) => n + f.size, 0), ids: removable.map((f) => f.id) },
    recentUnused: unused.length - removable.length,
  };
}
