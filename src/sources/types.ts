import type { HttpClient } from "../core/http.js";
import type { Logger } from "../core/logger.js";
import type { ScrapedOpportunityInput } from "../core/types.js";

export interface SourceContext {
  http: HttpClient;
  logger: Logger;
  signal: AbortSignal;
  now: Date;
}

export interface SourceInfo {
  id: string;
  name: string;
  homepage: string;
  kind: "api" | "rss" | "html";
  description: string;
}

/**
 * A source adapter. Adapters only fetch and normalise; validation, de-duplication,
 * scoring and persistence happen in the pipeline so every adapter gets them for free.
 */
export interface Source extends SourceInfo {
  fetch(ctx: SourceContext): AsyncIterable<ScrapedOpportunityInput>;
}
