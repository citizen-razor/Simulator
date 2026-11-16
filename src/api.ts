/** Thin wrappers around the local API. Every write sends the X-Simulator header the server requires. */
import type { Assignment } from "../shared/assignments";
import type { Role, User } from "../shared/people";
import type { SimulationAnalysis, Stats } from "../shared/analytics";
import type { Health, ImpactRow, PathCheck } from "../shared/health";
import type { Tool } from "../shared/tools";

export interface DirectoryPerson {
  id: string;
  name: string;
  managerId: string | null;
  active: boolean;
  roles: Role[];
}

export interface LeaderRow {
  rank: number;
  userId: string;
  name: string;
  mastered?: number;
  attempted?: number;
  avgSolo?: number | null;
  best?: number;
  durationSec?: number;
  attempts?: number;
}
import type { GradingLibrary, GradingScheme, Taxonomy } from "../shared/library";
import type { Persona, PersonaLibrary, PersonaTemplate } from "../shared/personas";
import type { Attempt, Simulation, Transcript } from "../shared/schema";

export interface PerformanceRow {
  id: string;
  title: string;
  tagIds: string[];
  scenarios: number;
  /** A team filter left too few learners on this course to show. */
  hidden?: boolean;
  stats: Stats;
}

/** An attempt as reviewers see it: "Learner A" etc.; the name only for Admin-Builders. */
export type ReviewAttempt = Attempt & { learner: string; name?: string };

export interface ToolSummary {
  id: string;
  name: string;
  description: string;
  screens: number;
  cover: string | null;
  version: number;
  updatedAt: string | null;
  usedBy: { id: string; title: string }[];
}

export interface SimSummary {
  id: string;
  title: string;
  description: string;
  toolId: string;
  toolName: string;
  screens: number;
  scenarios: number;
  cover: string | null;
  tagIds: string[];
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
  if (res.status === 401) {
    // Session ended (signed out elsewhere, deactivated, expired): show the sign-in page.
    import("./lib/auth").then((m) => m.refreshAuth());
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ? `${err.error}${err.details ? `: ${JSON.stringify(err.details[0])}` : ""}` : `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** "?a=1&b=2" from the values that are set ("" when none are). */
function query(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
  return q ? `?${q}` : "";
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
  importSimulation: (data: unknown) => request<{ simulation: Simulation; warnings: string[] }>("POST", "/api/import", data),
  login: (email: string, password: string) => request<{ ok: true }>("POST", "/api/auth/login", { email, password }),
  setup: (body: { orgName: string; name: string; email: string; password: string }) => request<{ ok: true }>("POST", "/api/auth/setup", body),
  changePassword: (current: string, next: string) => request<{ ok: true }>("POST", "/api/auth/password", { current, next }),
  directory: () => request<DirectoryPerson[]>("GET", "/api/people/directory"),
  people: () => request<User[]>("GET", "/api/people"),
  addPerson: (body: { name: string; email: string; roles: Role[]; managerId: string | null }) =>
    request<{ id: string; temporaryPassword: string }>("POST", "/api/people", body),
  updatePerson: (id: string, patch: Partial<Pick<User, "name" | "email" | "roles" | "managerId" | "active">>) =>
    request<{ ok: true }>("PATCH", `/api/people/${encodeURIComponent(id)}`, patch),
  resetPassword: (id: string) => request<{ temporaryPassword: string }>("POST", `/api/people/${encodeURIComponent(id)}/password`),
  importPeople: (csv: string) =>
    request<{ created: { email: string; name: string; temporaryPassword: string }[]; updated: number; errors: string[] }>("POST", "/api/people/import", { csv }),
  scimStatus: () => request<{ enabled: boolean; path: string }>("GET", "/api/people/scim"),
  issueScim: () => request<{ token: string; path: string }>("POST", "/api/people/scim"),
  revokeScim: () => request<void>("DELETE", "/api/people/scim"),
  leaderboard: (scope: string) => request<{ scope: string; rows: LeaderRow[] }>("GET", `/api/leaderboard?scope=${encodeURIComponent(scope)}`),
  performance: (range: { from?: string; to?: string; team?: string } = {}) =>
    request<PerformanceRow[]>("GET", `/api/analytics${query({ from: range.from, to: range.to, team: range.team })}`),
  simPerformance: (id: string, includeGuided = true, range: { from?: string; to?: string; team?: string } = {}) =>
    request<SimulationAnalysis>("GET", `/api/analytics/${encodeURIComponent(id)}${query({ guided: includeGuided ? undefined : "0", from: range.from, to: range.to, team: range.team })}`),
  conversationReply: (body: { simulationId: string; scenarioId: string; transcript: Transcript; vars: Record<string, string> }) =>
    request<{ say: string; ended: boolean; customer: string }>("POST", "/api/conversation/reply", body),
  conversationCoach: (body: { simulationId: string; scenarioId: string; transcript: Transcript; vars: Record<string, string> }) =>
    request<{ say: string; why: string }>("POST", "/api/conversation/coach", body),
  conversationJudge: (body: { simulationId: string; scenarioId: string; transcript: Transcript; vars: Record<string, string> }) =>
    request<{ results: { id: string; met: boolean; reason: string }[] }>("POST", "/api/conversation/judge", body),
  unlinkedResults: () => request<{ trainee: string; attempts: number; last: string; candidates: string[] }[]>("GET", "/api/people/unlinked"),
  linkResults: (trainee: string, userId: string) => request<{ attempts: number; assignments: number }>("POST", "/api/people/link", { trainee, userId }),
  quality: () =>
    request<{ id: string; title: string; status: Health["status"]; errors: number; warnings: number; paths: number }[]>("GET", "/api/quality"),
  simQuality: (id: string) => request<{ health: Health; attempts: ReviewAttempt[]; total: number }>("GET", `/api/quality/${encodeURIComponent(id)}`),
  reviewMark: (attemptId: string, criterionId: string, met: boolean, note: string) =>
    request<ReviewAttempt>("POST", `/api/attempts/${encodeURIComponent(attemptId)}/review`, { criterionId, met, note }),
  tools: () => request<ToolSummary[]>("GET", "/api/tools"),
  getTool: (id: string) => request<Tool>("GET", `/api/tools/${encodeURIComponent(id)}`),
  createTool: (tool: Pick<Tool, "name" | "description" | "startScreenId" | "screens" | "variables">) => request<Tool>("POST", "/api/tools", tool),
  saveTool: (tool: Partial<Tool> & { id: string }) => request<Tool>("PUT", `/api/tools/${encodeURIComponent(tool.id)}`, tool),
  deleteTool: (id: string) => request<void>("DELETE", `/api/tools/${encodeURIComponent(id)}`),
  toolImpact: (id: string, parts: Pick<Tool, "startScreenId" | "screens" | "variables">) =>
    request<{ tool: { id: string; name: string; version: number }; rows: ImpactRow[] }>("POST", `/api/tools/${encodeURIComponent(id)}/impact`, parts),
  newSimulationOnTool: (toolId: string, title: string) => request<Simulation>("POST", `/api/tools/${encodeURIComponent(toolId)}/simulations`, { title }),
  moveToTool: (simId: string, toolId: string, apply = false) =>
    request<{ paths: PathCheck[]; issues: string[]; simulation?: Simulation }>("POST", `/api/simulations/${encodeURIComponent(simId)}/tool`, { toolId, apply }),
  taxonomy: () => request<Taxonomy>("GET", "/api/library/taxonomy"),
  saveTaxonomy: (t: Taxonomy) => request<Taxonomy>("PUT", "/api/library/taxonomy", t),
  grading: () => request<GradingLibrary>("GET", "/api/library/grading"),
  saveScheme: (s: GradingScheme) => request<GradingScheme>("PUT", `/api/library/grading/${encodeURIComponent(s.id)}`, s),
  deleteScheme: (id: string) => request<void>("DELETE", `/api/library/grading/${encodeURIComponent(id)}`),
  imageUsage: () =>
    request<{ total: { count: number; bytes: number }; removable: { count: number; bytes: number }; recentUnused: number }>("GET", "/api/admin/images"),
  cleanupImages: () => request<{ deleted: number; bytes: number }>("POST", "/api/admin/images/cleanup"),
  assignments: (trainee?: string) =>
    request<Assignment[]>("GET", `/api/assignments${trainee ? `?trainee=${encodeURIComponent(trainee)}` : ""}`),
  assignment: (id: string) => request<Assignment>("GET", `/api/assignments/${encodeURIComponent(id)}`),
  createAssignments: (body: { userIds: string[]; simulationId: string; scenarioId: string; requirement: string; dueDate: string | null; note: string }) =>
    request<Assignment[]>("POST", "/api/assignments", body),
  deleteAssignment: (id: string) => request<void>("DELETE", `/api/assignments/${encodeURIComponent(id)}`),
  personas: () => request<PersonaLibrary>("GET", "/api/library/personas"),
  savePersonaTemplate: (t: PersonaTemplate) => request<PersonaTemplate>("PUT", `/api/library/personas/templates/${encodeURIComponent(t.id)}`, t),
  deletePersonaTemplate: (id: string) => request<void>("DELETE", `/api/library/personas/templates/${encodeURIComponent(id)}`),
  savePersona: (p: Persona) => request<Persona>("PUT", `/api/library/personas/${encodeURIComponent(p.id)}`, p),
  personaUsage: (id: string) => request<{ uses: string[] }>("GET", `/api/library/personas/${encodeURIComponent(id)}/usage`),
  deletePersona: (id: string) => request<void>("DELETE", `/api/library/personas/${encodeURIComponent(id)}`),
  draftPersonas: (body: { description: string; count: number; templateId: string | null }) =>
    request<{ personas: Persona[] }>("POST", "/api/library/personas/draft", body),
  markAttempt: (id: string, marks: Record<string, boolean | null>) => request<Attempt>("POST", `/api/attempts/${encodeURIComponent(id)}/marks`, { marks }),
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
/** Downloads the simulation and its images as one .simulation.json file. */
export const exportUrl = (id: string) => `/api/simulations/${encodeURIComponent(id)}/export`;
