import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import { AnalysisError } from "../ai/analyst.js";
import type { RadarApp } from "../app.js";
import { OPPORTUNITY_TYPES, PIPELINE_STATUSES, TIERS, type Opportunity } from "../core/types.js";

const csv = <T extends string>(values: readonly [T, ...T[]]) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  status: csv(PIPELINE_STATUSES),
  tier: csv(TIERS),
  type: csv(OPPORTUNITY_TYPES),
  source: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").filter(Boolean) : undefined)),
  minScore: z.coerce.number().min(0).max(100).optional(),
  includeExpired: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  sort: z.enum(["score", "deadline", "newest"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const PipelinePatch = z
  .object({
    status: z.enum(PIPELINE_STATUSES).optional(),
    notes: z.string().max(20_000).optional(),
    owner: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

const ScrapeBody = z.object({ sources: z.array(z.string()).max(50).optional() }).strict();

export async function buildServer(app: RadarApp): Promise<FastifyInstance> {
  const server = Fastify({
    // Per-request access logs are info-level; the warn floor keeps logs focused on problems.
    loggerInstance: app.logger.child({ component: "http-server" }, { level: "warn" }) as FastifyBaseLogger,
    trustProxy: true,
  });
  const token = app.env.DASHBOARD_TOKEN;

  server.addHook("onSend", async (_req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'",
    );
  });

  server.addHook("onRequest", async (req, reply) => {
    if (!token || !req.url.startsWith("/api/") || req.url === "/api/health") return;
    const header = req.headers.authorization ?? "";
    const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(supplied, token)) return reply.code(401).send({ error: "unauthorized" });
  });

  server.setErrorHandler((err: FastifyError | z.ZodError, req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid_request", issues: err.issues });
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error({ err }, "request failed");
    return reply.code(status).send({ error: status >= 500 ? "internal_error" : err.message });
  });

  // ------------------------------------------------------------------ API

  server.get("/api/health", async () => ({ ok: true, running: app.pipeline.runningSources() }));

  server.get("/api/meta", async () => ({
    company: app.getConfig().profile.company.name,
    aiEnabled: Boolean(app.getAnalyst()),
    aiModel: app.env.AI_MODEL,
    notificationChannels: app.notifier.channels(),
    authRequired: Boolean(token),
    capabilities: app.getConfig().profile.capabilities.map((c) => ({ id: c.id, label: c.label, role: c.role })),
    profileVersion: app.getConfig().profileVersion,
  }));

  server.get("/api/stats", async () => app.repo.stats());

  server.get("/api/opportunities", async (req) => {
    const q = ListQuery.parse(req.query);
    return app.repo.list(q);
  });

  server.get("/api/opportunities.csv", async (req, reply) => {
    const q = ListQuery.parse(req.query);
    const { items } = app.repo.list({ ...q, limit: 500, offset: 0 });
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="kipeo-opportunities-${new Date().toISOString().slice(0, 10)}.csv"`);
    return toCsv(items);
  });

  server.get<{ Params: { id: string } }>("/api/opportunities/:id", async (req, reply) => {
    const opportunity = app.repo.get(req.params.id);
    if (!opportunity) return reply.code(404).send({ error: "not_found" });
    return { opportunity, analysis: app.repo.getAnalysis(opportunity.id), activity: app.repo.getActivity(opportunity.id) };
  });

  server.patch<{ Params: { id: string } }>("/api/opportunities/:id", async (req, reply) => {
    const patch = PipelinePatch.parse(req.body ?? {});
    const actor = typeof req.headers["x-actor"] === "string" ? req.headers["x-actor"].slice(0, 80) : null;
    const updated = app.repo.updatePipeline(req.params.id, patch, actor);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return updated;
  });

  server.post<{ Params: { id: string } }>("/api/opportunities/:id/analyze", async (req, reply) => {
    const analyst = app.getAnalyst();
    if (!analyst) return reply.code(409).send({ error: "AI analysis is not configured. Set ANTHROPIC_API_KEY." });
    const opp = app.repo.get(req.params.id);
    if (!opp) return reply.code(404).send({ error: "not_found" });
    try {
      const result = await analyst.analyze(opp);
      app.repo.saveAnalysis(opp.id, result.model, result.analysis, result.usage);
      return app.repo.getAnalysis(opp.id);
    } catch (err) {
      if (err instanceof AnalysisError) return reply.code(err.retryable ? 503 : 422).send({ error: err.message });
      throw err;
    }
  });

  server.get("/api/sources", async () => {
    const runs = new Map(app.repo.latestRuns().map((r) => [r.source, r]));
    const counts = app.repo.stats().bySource;
    return app.getSources().map(({ source, enabled, disabledReason }) => ({
      id: source.id,
      name: source.name,
      homepage: source.homepage,
      kind: source.kind,
      description: source.description,
      enabled,
      disabledReason: disabledReason ?? null,
      running: app.pipeline.isRunning(source.id),
      openCount: counts[source.id] ?? 0,
      lastRun: runs.get(source.id) ?? null,
    }));
  });

  server.get("/api/runs", async () => app.repo.recentRuns(50));

  server.post("/api/scrape", async (req, reply) => {
    const body = ScrapeBody.parse(req.body ?? {});
    const known = new Set(app.getSources().map((s) => s.source.id));
    const unknown = (body.sources ?? []).filter((s) => !known.has(s));
    if (unknown.length) return reply.code(400).send({ error: `Unknown source(s): ${unknown.join(", ")}` });
    // Fire-and-forget: progress is visible through /api/sources and /api/runs.
    void app.pipeline.runAll(body.sources).catch((err) => app.logger.error({ err }, "manual scrape failed"));
    return reply.code(202).send({ started: true });
  });

  server.post("/api/admin/reload", async (_req, reply) => {
    try {
      const cfg = app.reloadConfig();
      const rescored = app.rescoreAll();
      return { profileVersion: cfg.profileVersion, rescored };
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  server.post("/api/digest", async () => app.notifier.send(24));

  // ------------------------------------------------------------------ dashboard

  const webDist = path.resolve("web/dist");
  if (existsSync(webDist)) {
    await server.register(fastifyStatic, { root: webDist, prefix: "/", wildcard: false });
    server.setNotFoundHandler((req: FastifyRequest, reply: FastifyReply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  } else {
    server.get("/", async () => ({ message: "Dashboard not built. Run `npm run build` (or `npm run dev:web` for development)." }));
  }

  return server;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

const CSV_COLUMNS: [string, (o: Opportunity) => unknown][] = [
  ["score", (o) => o.score],
  ["tier", (o) => o.tier],
  ["status", (o) => o.status],
  ["title", (o) => o.title],
  ["buyer", (o) => o.buyer],
  ["country", (o) => o.country],
  ["type", (o) => o.type],
  ["deadline", (o) => o.deadline],
  ["reference", (o) => o.referenceNo],
  ["source", (o) => o.source],
  ["capabilities", (o) => o.breakdown.capabilities.join("; ")],
  ["owner", (o) => o.owner],
  ["url", (o) => o.url],
];

export function toCsv(items: Opportunity[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_COLUMNS.map(([h]) => h).join(",");
  return [header, ...items.map((o) => CSV_COLUMNS.map(([, f]) => cell(f(o))).join(","))].join("\r\n");
}
