/**
 * The AI-played customer (prompts in shared/conversation.ts):
 *   POST /api/conversation/reply  the customer's next message
 *   POST /api/conversation/judge  the conversation criteria, judged at the end of a run
 *
 * Any signed-in person can use these while playing. Everything that shapes the customer (the
 * persona, the brief, the criteria) is read from the stored simulation, never from the browser;
 * the browser only sends the transcript and the run's random values. Each person has an hourly
 * allowance so a runaway client can't run up the AI bill.
 */
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { Router } from "express";
import { z } from "zod";
import {
  activeConversation,
  customerPersona,
  customerSystemPrompt,
  customerTurns,
  judgePrompt,
  personaDossier,
} from "../shared/conversation";
import { sessionPersonaVariables } from "../shared/personas";
import { TranscriptSchema, type Conversation, type Scenario } from "../shared/schema";
import { requireUser } from "./auth";
import { describeApiError, getClient, MODEL } from "./generate";
import { getSimulation, HttpError, readPersonas } from "./storage";

const RequestSchema = z.object({
  simulationId: z.string().max(100),
  scenarioId: z.string().max(100),
  transcript: TranscriptSchema,
  /** The run's random values, for {{variables}} in the brief. */
  vars: z.record(z.string().max(200), z.string().max(2000)).default({}),
});

const Reply = z.object({ say: z.string(), ended: z.boolean() });
const Judgement = z.object({ results: z.array(z.object({ id: z.string(), met: z.boolean(), reason: z.string() })) });

// Per-person hourly allowances (in memory; reset on restart).
const LIMITS = { reply: 200, judge: 30 };
const usage = new Map<string, { at: number; reply: number; judge: number }>();
function spend(userId: string, kind: keyof typeof LIMITS) {
  const now = Date.now();
  let u = usage.get(userId);
  if (!u || now - u.at > 3_600_000) usage.set(userId, (u = { at: now, reply: 0, judge: 0 }));
  if (u[kind] >= LIMITS[kind]) throw new HttpError(429, "You've reached this hour's limit for the AI customer. Try again later.");
  u[kind]++;
}

async function load(body: unknown): Promise<{ input: z.infer<typeof RequestSchema>; sc: Scenario; conv: Conversation; dossier: string; customer: string }> {
  const input = RequestSchema.parse(body);
  const sim = await getSimulation(input.simulationId);
  const sc = sim.scenarios.find((s) => s.id === input.scenarioId);
  const conv = activeConversation(sc);
  if (!sc || !conv) throw new HttpError(404, "This scenario has no customer conversation.");
  const library = await readPersonas();
  // Persona details come from the library here; the browser only adds the run's random values.
  input.vars = { ...input.vars, ...sessionPersonaVariables(sim, sc.id, library) };
  const found = customerPersona(sim, sc.id, library);
  const dossier = found ? personaDossier(found.persona, found.template) : "Name: (choose a name and keep it)\nNo other details on file.";
  return { input, sc, conv, dossier, customer: found?.persona.name ?? "Customer" };
}

function checkReply<T>(message: { stop_reason: string | null; parsed_output?: T | null }): T {
  if (message.stop_reason === "refusal") throw new HttpError(422, "The AI declined to continue this conversation.");
  if (message.stop_reason === "max_tokens" || !message.parsed_output) throw new HttpError(502, "The AI's reply could not be read. Try again.");
  return message.parsed_output;
}

export function conversationRoutes(): Router {
  const r = Router();
  const handle = (fn: (req: import("express").Request) => Promise<unknown>) => async (req: import("express").Request, res: import("express").Response) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      if (e instanceof HttpError) return void res.status(e.status).json({ error: e.message });
      if (e instanceof z.ZodError) return void res.status(400).json({ error: "Invalid conversation request." });
      const { status, message } = describeApiError(e);
      res.status(status).json({ error: message });
    }
  };

  r.post(
    "/reply",
    handle(async (req) => {
      const me = requireUser(req);
      const { input, sc, conv, dossier, customer } = await load(req.body);
      if (input.transcript.length >= 100) throw new HttpError(400, "This conversation is too long to continue.");
      spend(me.user.id, "reply");
      const message = await getClient().beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        // Quick replies matter more than deep thought for a customer's next line.
        output_config: { effort: "low", format: betaZodOutputFormat(Reply) },
        system: customerSystemPrompt({ conversation: conv, scenarioTitle: sc.title, dossier, vars: input.vars }),
        messages: customerTurns(input.transcript, conv.channel),
      });
      const out = checkReply(message);
      return { say: out.say.trim().slice(0, 2000), ended: out.ended, customer };
    }),
  );

  r.post(
    "/judge",
    handle(async (req) => {
      const me = requireUser(req);
      const { input, sc, conv, dossier } = await load(req.body);
      const criteria = conv.criteria.filter((c) => c.label.trim());
      if (!criteria.length) return { results: [] };
      spend(me.user.id, "judge");
      const message = await getClient().beta.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium", format: betaZodOutputFormat(Judgement) },
        messages: [
          {
            role: "user",
            content: judgePrompt({ conversation: conv, scenarioTitle: sc.title, scenarioGoal: sc.goal, dossier, transcript: input.transcript, vars: input.vars }),
          },
        ],
      });
      const out = checkReply(message);
      // Only the scenario's own criteria, by their rubric id; anything else the model returns is ignored.
      return {
        results: criteria.flatMap((c) => {
          const j = out.results.find((x) => x.id === c.id);
          return j ? [{ id: `conv-${c.id}`, met: j.met, reason: j.reason.slice(0, 500) }] : [];
        }),
      };
    }),
  );
  return r;
}
