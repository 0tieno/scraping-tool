import { OpportunityAnalyst } from "./ai/analyst.js";
import { loadConfig, type LoadedConfig } from "./config/loader.js";
import type { Env } from "./config/env.js";
import { HttpClient } from "./core/http.js";
import { createLogger, type Logger } from "./core/logger.js";
import { openDatabase, type Db } from "./db/database.js";
import { Repository } from "./db/repository.js";
import { DigestNotifier } from "./notify/digest.js";
import { ScrapePipeline } from "./pipeline/runner.js";
import { RelevanceScorer } from "./scoring/relevance.js";
import { buildSources, type RegisteredSource } from "./sources/registry.js";

/** Composition root: owns every long-lived component and supports hot-reloading the YAML config. */
export class RadarApp {
  readonly logger: Logger;
  readonly db: Db;
  readonly repo: Repository;
  readonly http: HttpClient;
  readonly pipeline: ScrapePipeline;
  readonly notifier: DigestNotifier;

  private config!: LoadedConfig;
  private scorer!: RelevanceScorer;
  private sources!: RegisteredSource[];
  private analyst: OpportunityAnalyst | null = null;

  constructor(readonly env: Env, logger?: Logger) {
    this.logger = logger ?? createLogger(env.LOG_LEVEL);
    this.db = openDatabase(env.DATABASE_PATH);
    this.repo = new Repository(this.db);
    this.http = new HttpClient({
      userAgent: env.SCRAPER_USER_AGENT,
      minDelayMs: env.SCRAPER_MIN_DELAY_MS,
      timeoutMs: env.SCRAPER_TIMEOUT_MS,
      maxRetries: env.SCRAPER_MAX_RETRIES,
      logger: this.logger.child({ component: "http" }),
    });
    this.reloadConfig();
    this.pipeline = new ScrapePipeline({
      repo: this.repo,
      http: this.http,
      logger: this.logger.child({ component: "pipeline" }),
      scorer: () => this.scorer,
      profileVersion: () => this.config.profileVersion,
      sources: () => this.sources,
      analyst: () => this.analyst,
      autoAnalyze: { minScore: env.AI_AUTO_ANALYZE_MIN_SCORE, maxPerRun: env.AI_MAX_AUTO_ANALYSES_PER_RUN },
    });
    this.notifier = new DigestNotifier(env, this.repo, this.logger.child({ component: "digest" }));
    this.repo.failOrphanedRuns();
  }

  /** Re-reads config/*.yaml. Throws (keeping the previous config) if the new files are invalid. */
  reloadConfig(): LoadedConfig {
    // Build everything first, then swap atomically, so a bad edit never leaves a half-applied config.
    const config = loadConfig(this.env.CONFIG_DIR);
    const scorer = new RelevanceScorer(config.profile);
    const sources = buildSources(config.sources, this.env, this.logger);
    const analyst = this.env.ANTHROPIC_API_KEY
      ? new OpportunityAnalyst({ apiKey: this.env.ANTHROPIC_API_KEY, model: this.env.AI_MODEL, profile: config.profile, logger: this.logger.child({ component: "ai" }) })
      : null;
    this.config = config;
    this.scorer = scorer;
    this.sources = sources;
    this.analyst = analyst;
    return config;
  }

  rescoreAll(): number {
    const now = new Date();
    return this.repo.rescoreAll((o) => this.scorer.score(o, now), this.config.profileVersion);
  }

  getAnalyst(): OpportunityAnalyst | null {
    return this.analyst;
  }

  getSources(): RegisteredSource[] {
    return this.sources;
  }

  getConfig(): LoadedConfig {
    return this.config;
  }

  close(): void {
    this.db.close();
  }
}
