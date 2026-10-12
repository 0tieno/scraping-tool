#!/usr/bin/env node
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { Cron } from "croner";
import { RadarApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { buildServer } from "./server/http.js";

const HELP = `Kipeo Opportunity Radar

Usage: radar <command> [options]

Commands:
  serve                 Start the dashboard/API and the scheduler (default)
  scrape [source...]    Run all enabled sources, or only the given source ids
  analyze <id>          Run AI bid analysis for one opportunity
  analyze --top         Analyse the best unanalysed open opportunities
  rescore               Reload config/*.yaml and recompute every relevance score
  digest [--hours=24]   Send the new-opportunities digest now
  top [--limit=15]      Print the highest-scoring open opportunities
  sources               List sources and their last run
`;

async function main(): Promise<void> {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      hours: { type: "string" },
      limit: { type: "string" },
      top: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command = "serve", ...args] = positionals;
  if (values.help || command === "help") {
    console.log(HELP);
    return;
  }

  const app = new RadarApp(loadEnv());
  const shutdown = () => {
    app.logger.info("shutting down");
    app.close();
    process.exit(0);
  };

  switch (command) {
    case "serve": {
      const server = await buildServer(app);
      await server.listen({ port: app.env.PORT, host: app.env.HOST });
      startScheduler(app);
      process.once("SIGINT", () => void server.close().then(shutdown));
      process.once("SIGTERM", () => void server.close().then(shutdown));
      return; // keep running
    }
    case "scrape": {
      const results = await app.pipeline.runAll(args.length ? args : undefined);
      console.table(results.map(({ source, status, fetched, created, updated, rejected, durationMs, error }) => ({
        source, status, fetched, created, updated, rejected, seconds: Math.round(durationMs / 1000), error: error ?? "",
      })));
      break;
    }
    case "analyze": {
      if (!app.getAnalyst()) throw new Error("Set ANTHROPIC_API_KEY to enable AI analysis.");
      if (values.top) {
        console.log(`Analysed ${await app.pipeline.analyzeTopCandidates()} opportunities.`);
        break;
      }
      const opp = args[0] ? app.repo.get(args[0]) : null;
      if (!opp) throw new Error(`Opportunity not found: ${args[0] ?? "(missing id)"}`);
      const result = await app.getAnalyst()!.analyze(opp);
      app.repo.saveAnalysis(opp.id, result.model, result.analysis, result.usage);
      console.log(JSON.stringify(result.analysis, null, 2));
      break;
    }
    case "rescore": {
      const n = app.rescoreAll();
      console.log(`Rescored ${n} opportunities with profile ${app.getConfig().profileVersion}.`);
      break;
    }
    case "digest": {
      const r = await app.notifier.send(Number(values.hours ?? 24));
      console.log(r.count ? `Sent ${r.count} opportunities via ${r.channels.join(", ")}.` : "Nothing sent (no new items or no channel configured).");
      break;
    }
    case "top": {
      const { items } = app.repo.list({ sort: "score", limit: Number(values.limit ?? 15) });
      console.table(items.map((o) => ({
        id: o.id, score: o.score, tier: o.tier, title: o.title.slice(0, 70), buyer: (o.buyer ?? "").slice(0, 30), deadline: o.deadline?.slice(0, 10) ?? "",
      })));
      break;
    }
    case "sources": {
      const runs = new Map(app.repo.latestRuns().map((r) => [r.source, r]));
      console.table(app.getSources().map(({ source, enabled, disabledReason }) => ({
        id: source.id, enabled, last: runs.get(source.id)?.status ?? "never", note: disabledReason ?? "",
      })));
      break;
    }
    default:
      console.error(`Unknown command "${command}".\n\n${HELP}`);
      process.exitCode = 1;
  }
  app.close();
}

function startScheduler(app: RadarApp): void {
  const { SCRAPE_CRON, DIGEST_CRON, TIMEZONE } = app.env;
  const opts = { timezone: TIMEZONE, protect: true, catch: (err: unknown) => app.logger.error({ err }, "scheduled job failed") };
  if (SCRAPE_CRON) {
    const job = new Cron(SCRAPE_CRON, opts, () => app.pipeline.runAll().then(() => undefined));
    app.logger.info({ cron: SCRAPE_CRON, next: job.nextRun()?.toISOString() }, "scrape schedule active");
  }
  if (DIGEST_CRON) {
    const job = new Cron(DIGEST_CRON, opts, () => app.notifier.send(24).then(() => undefined));
    app.logger.info({ cron: DIGEST_CRON, next: job.nextRun()?.toISOString() }, "digest schedule active");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
