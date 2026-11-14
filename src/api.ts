/** Thin wrappers around the local API. Every write sends the X-Simulator header the server requires. */
import type { Attempt, Simulation } from "../shared/schema";

export interface SimSummary {
  id: string;
  title: string;
  description: string;
  screens: number;
  scenarios: number;
  cover: string | null;
  updatedAt: string | null;
}

export interface AiResult {
  simulation: Simulation;
  notes: string;
  issues: string[];
}

export interface AiProgress {
  phase: "uploading" | "thinking" | "writing";
  chars: number;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Simulator": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ? `${err.error}${err.details ? `: ${JSON.stringify(err.details[0])}` : ""}` : `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  status: () => request<{ model: string; aiConfigured: boolean }>("GET", "/api/status"),
  list: () => request<SimSummary[]>("GET", "/api/simulations"),
  get: (id: string) => request<Simulation>("GET", `/api/simulations/${id}`),
  create: (sim: Omit<Simulation, "id"> & { id?: string }) => request<Simulation>("POST", "/api/simulations", { ...sim, id: "new" }),
  save: (sim: Simulation) => request<Simulation>("PUT", `/api/simulations/${sim.id}`, sim),
  remove: (id: string) => request<void>("DELETE", `/api/simulations/${id}`),
  uploadAsset: (mediaType: string, data: string) => request<{ assetId: string }>("POST", "/api/assets", { mediaType, data }),
  attempts: (simulationId?: string) =>
    request<Attempt[]>("GET", `/api/attempts${simulationId ? `?simulationId=${encodeURIComponent(simulationId)}` : ""}`),
  addAttempt: (a: Omit<Attempt, "id">) => request<Attempt>("POST", "/api/attempts", { ...a, id: "new" }),
};

/** Calls an AI endpoint that streams newline-delimited JSON progress, resolving with the final result. */
export async function streamAi(url: string, body: unknown, onProgress: (p: AiProgress) => void): Promise<AiResult> {
  onProgress({ phase: "uploading", chars: 0 });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Simulator": "1" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `${res.status} ${res.statusText}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      if (msg.type === "progress") onProgress(msg);
      else if (msg.type === "error") throw new Error(msg.message);
      else if (msg.type === "done") return msg as AiResult;
    }
  }
  throw new Error("The connection closed before generation finished.");
}

export const assetUrl = (id: string) => `/assets/${id}`;
