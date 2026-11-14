/**
 * Remembers the trainee's name in this browser so they only type it once.
 * Storage can be unavailable (private mode, blocked site data), so every access is guarded.
 */
const KEY = "simulator.trainee";

export function loadTrainee(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveTrainee(name: string) {
  try {
    localStorage.setItem(KEY, name);
  } catch {
    /* name still applies for this session */
  }
}
