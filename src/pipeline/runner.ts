import { AnalysisError, type OpportunityAnalyst } from "../ai/analyst.js";
import { AccessDeniedError, type HttpClient } from "../core/http.js";
import type { Logger } from "../core/logger.js";
import { ScrapedOpportunitySchema, type ScrapeRun } from "../core/types.js";
import type { Repository } from "../db/repository.js";
import type { RelevanceScorer } from "../scoring/relevance.js";
import type { RegisteredSource } from "../sources/registry.js";

const SOURCE_TIMEOUT_MS = 20 * 60 * 1000;

export interface RunSummary {
  source: string;
  status: ScrapeRun["status"];
  fetched: number;
  created: number;
  updated: number;
  rejected: number;
  error: string | null;
  durationMs: number;
}

export interface PipelineDeps {
  repo: Repository;
  http: HttpClient;
  logger: Logger;
  scorer: () => RelevanceScorer;
  profileVersion: () => string;
  sources: () => RegisteredSource[];
  analyst: () => OpportunityAnalyst | null;
  autoAnalyze: { minScore: number; maxPerRun: number };
}

export class ScrapePipeline {
  private readonly active = new Set<string>();

  constructor(private readonly deps: PipelineDeps) {}

  isRunning(sourceId?: string): boolean {
    return sourceId ? this.active.has(sourceId) : this.active.size > 0;
  }

  runningSources(): string[] {
    return [...this.active];
  }

  /** Runs every enabled source (or the given subset) concurrently — each host is throttled independently. */
  async runAll(only?: string[]): Promise<RunSummary[]> {
    const targets = this.deps
      .sources()
      .filter((s) => (only?.length ? only.includes(s.source.id) : s.enabled))
      .filter((s) => !this.active.has(s.source.id));
    const results = await Promise.all(targets.map((s) => this.runSource(s)));

    if (this.deps.autoAnalyze.minScore > 0 && results.some((r) => r.created + r.updated > 0)) {
      await this.analyzeTopCandidates().catch((err) => this.deps.logger.error({ err }, "auto-analysis failed"));
    }
    return results;
  }

  async runSource({ source }: RegisteredSource): Promise<RunSummary> {
    const { repo, logger } = this.deps;
    const log = logger.child({ source: source.id });
    if (this.active.has(source.id)) throw new Error(`Source ${source.id} is already running`);
    this.active.add(source.id);

    const started = Date.now();
    const runId = repo.startRun(source.id);
    const counts = { fetched: 0, created: 0, updated: 0, rejected: 0 };
    const seen = new Set<string>();
    const scorer = this.deps.scorer();
    const profileVersion = this.deps.profileVersion();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Source run timed out")), SOURCE_TIMEOUT_MS);
    let error: string | null = null;

    log.info("scrape started");
    try {
      const now = new Date();
      for await (const raw of source.fetch({ http: this.deps.http, logger: log, signal: controller.signal, now })) {
        counts.fetched++;
        const parsed = ScrapedOpportunitySchema.safeParse(raw);
        if (!parsed.success) {
          counts.rejected++;
          log.debug({ issues: parsed.error.issues.slice(0, 3), title: (raw as { title?: string }).title }, "rejected invalid item");
          continue;
        }
        const opp = parsed.data;
        if (seen.has(opp.externalId)) continue; // sources sometimes repeat items across pages
        seen.add(opp.externalId);
        if (repo.isDuplicateOfOtherSource(opp.url, opp.source)) continue; // same listing via another feed

        const { outcome } = repo.upsertOpportunity(opp, scorer.score(opp, now), profileVersion, now);
        if (outcome === "created") counts.created++;
        else if (outcome === "updated") counts.updated++;
      }
    } catch (err) {
      error = err instanceof AccessDeniedError ? `Access denied by site: ${err.message}` : (err as Error).message;
      log.error({ err }, "scrape failed");
    } finally {
      clearTimeout(timer);
      this.active.delete(source.id);
    }

    const status: ScrapeRun["status"] = error ? (counts.fetched > 0 ? "partial" : "failed") : "success";
    repo.finishRun(runId, { status, ...counts, error });
    const summary = { source: source.id, status, ...counts, error, durationMs: Date.now() - started };
    log.info(summary, "scrape finished");
    return summary;
  }

  /** Sends the best new opportunities to Claude for a bid brief, within a per-run budget. */
  async analyzeTopCandidates(): Promise<number> {
    const analyst = this.deps.analyst();
    if (!analyst) return 0;
    const { minScore, maxPerRun } = this.deps.autoAnalyze;
    const candidates = this.deps.repo.analysisCandidates(minScore, maxPerRun);
    let done = 0;
    for (const opp of candidates) {
      try {
        const result = await analyst.analyze(opp);
        this.deps.repo.saveAnalysis(opp.id, result.model, result.analysis, result.usage);
        done++;
      } catch (err) {
        this.deps.logger.warn({ id: opp.id, err: (err as Error).message }, "auto-analysis skipped");
        if (err instanceof AnalysisError && err.fatal) break; // e.g. bad key — every further call would fail too
      }
    }
    return done;
  }
}
