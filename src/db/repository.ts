import type { SQLInputValue } from "node:sqlite";
import { sha1 } from "../core/text.js";
import type {
  AiAnalysis,
  Opportunity,
  PipelineStatus,
  RelevanceScore,
  ScrapeRun,
  ScrapedOpportunity,
  StoredAnalysis,
  Tier,
} from "../core/types.js";
import { transaction, type Db } from "./database.js";

export type UpsertOutcome = "created" | "updated" | "unchanged";

export interface ListFilters {
  q?: string;
  status?: PipelineStatus[];
  tier?: Tier[];
  source?: string[];
  type?: string[];
  minScore?: number;
  includeExpired?: boolean;
  sort?: "score" | "deadline" | "newest";
  limit?: number;
  offset?: number;
}

export interface ActivityEntry {
  action: string;
  detail: string | null;
  actor: string | null;
  at: string;
}

interface OpportunityRow {
  id: string;
  source: string;
  external_id: string;
  url: string;
  title: string;
  description: string;
  buyer: string | null;
  country: string | null;
  type: string;
  category: string | null;
  reference_no: string | null;
  published_at: string | null;
  deadline: string | null;
  documents: string;
  meta: string;
  content_hash: string;
  status: string;
  notes: string;
  owner: string | null;
  score: number;
  tier: string;
  breakdown: string;
  first_seen_at: string;
  last_seen_at: string;
  updated_at: string;
  has_analysis: number;
}

export function opportunityId(source: string, externalId: string): string {
  return sha1(`${source}:${externalId}`).slice(0, 16);
}

function contentHash(o: ScrapedOpportunity): string {
  return sha1(JSON.stringify([o.title, o.description, o.buyer, o.deadline, o.referenceNo, o.documents.map((d) => d.url), o.type]));
}

const SELECT_OPP = `SELECT o.*, EXISTS(SELECT 1 FROM analyses a WHERE a.opportunity_id = o.id) AS has_analysis FROM opportunities o`;

export class Repository {
  constructor(private readonly db: Db) {}

  // ---------------------------------------------------------------- writes

  upsertOpportunity(o: ScrapedOpportunity, rel: RelevanceScore, profileVersion: string, now = new Date()): { id: string; outcome: UpsertOutcome } {
    const id = opportunityId(o.source, o.externalId);
    const ts = now.toISOString();
    const hash = contentHash(o);
    const existing = this.db
      .prepare("SELECT content_hash, deadline, score FROM opportunities WHERE id = ?")
      .get(id) as { content_hash: string; deadline: string | null; score: number } | undefined;

    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO opportunities (id, source, external_id, url, title, description, buyer, country, type, category,
             reference_no, published_at, deadline, documents, meta, content_hash, score, tier, breakdown, profile_version,
             first_seen_at, last_seen_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          id, o.source, o.externalId, o.url, o.title, o.description, o.buyer, o.country, o.type, o.category,
          o.referenceNo, o.publishedAt, o.deadline, JSON.stringify(o.documents), JSON.stringify(o.meta), hash,
          rel.score, rel.tier, JSON.stringify(rel.breakdown), profileVersion, ts, ts, ts,
        );
      return { id, outcome: "created" };
    }

    if (existing.content_hash === hash) {
      this.db
        // meta is refreshed silently: it holds derived attributes, not notice content worth an activity entry.
        .prepare("UPDATE opportunities SET last_seen_at = ?, meta = ?, score = ?, tier = ?, breakdown = ?, profile_version = ? WHERE id = ?")
        .run(ts, JSON.stringify(o.meta), rel.score, rel.tier, JSON.stringify(rel.breakdown), profileVersion, id);
      return { id, outcome: "unchanged" };
    }

    transaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE opportunities SET url = ?, title = ?, description = ?, buyer = ?, country = ?, type = ?, category = ?,
             reference_no = ?, published_at = ?, deadline = ?, documents = ?, meta = ?, content_hash = ?, score = ?, tier = ?,
             breakdown = ?, profile_version = ?, last_seen_at = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          o.url, o.title, o.description, o.buyer, o.country, o.type, o.category, o.referenceNo, o.publishedAt, o.deadline,
          JSON.stringify(o.documents), JSON.stringify(o.meta), hash, rel.score, rel.tier, JSON.stringify(rel.breakdown),
          profileVersion, ts, ts, id,
        );
      const detail = existing.deadline !== o.deadline ? `Deadline changed: ${existing.deadline ?? "none"} → ${o.deadline ?? "none"}` : "Notice content updated at source";
      this.logActivity(id, "source_update", detail, "system", ts);
    });
    return { id, outcome: "updated" };
  }

  rescoreAll(score: (o: Opportunity) => RelevanceScore, profileVersion: string): number {
    const rows = this.db.prepare(SELECT_OPP).all() as unknown as OpportunityRow[];
    const stmt = this.db.prepare("UPDATE opportunities SET score = ?, tier = ?, breakdown = ?, profile_version = ? WHERE id = ?");
    transaction(this.db, () => {
      for (const row of rows) {
        const rel = score(toOpportunity(row));
        stmt.run(rel.score, rel.tier, JSON.stringify(rel.breakdown), profileVersion, row.id);
      }
    });
    return rows.length;
  }

  updatePipeline(id: string, patch: { status?: PipelineStatus; notes?: string; owner?: string | null }, actor: string | null): Opportunity | null {
    const current = this.get(id);
    if (!current) return null;
    const ts = new Date().toISOString();
    transaction(this.db, () => {
      if (patch.status && patch.status !== current.status) {
        this.db.prepare("UPDATE opportunities SET status = ? WHERE id = ?").run(patch.status, id);
        this.logActivity(id, "status", `${current.status} → ${patch.status}`, actor, ts);
      }
      if (patch.notes !== undefined && patch.notes !== current.notes) {
        this.db.prepare("UPDATE opportunities SET notes = ? WHERE id = ?").run(patch.notes, id);
        this.logActivity(id, "notes", "Notes edited", actor, ts);
      }
      if (patch.owner !== undefined && patch.owner !== current.owner) {
        this.db.prepare("UPDATE opportunities SET owner = ? WHERE id = ?").run(patch.owner, id);
        this.logActivity(id, "owner", patch.owner ? `Assigned to ${patch.owner}` : "Unassigned", actor, ts);
      }
    });
    return this.get(id);
  }

  saveAnalysis(id: string, model: string, analysis: AiAnalysis, usage: { input: number; output: number }): void {
    const ts = new Date().toISOString();
    transaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO analyses (opportunity_id, model, payload, input_tokens, output_tokens, created_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(opportunity_id) DO UPDATE SET model = excluded.model, payload = excluded.payload,
             input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, created_at = excluded.created_at`,
        )
        .run(id, model, JSON.stringify(analysis), usage.input, usage.output, ts);
      this.logActivity(id, "analysis", `AI analysis: ${analysis.recommendation} (fit ${analysis.fitScore})`, "ai", ts);
    });
  }

  private logActivity(id: string, action: string, detail: string | null, actor: string | null, at: string): void {
    this.db.prepare("INSERT INTO activity (opportunity_id, action, detail, actor, at) VALUES (?,?,?,?,?)").run(id, action, detail, actor, at);
  }

  // ---------------------------------------------------------------- reads

  /** True when another source already holds this URL (e.g. one listing carried by two feeds). */
  isDuplicateOfOtherSource(url: string, source: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM opportunities WHERE url = ? AND source != ? LIMIT 1").get(url, source));
  }

  get(id: string): Opportunity | null {
    const row = this.db.prepare(`${SELECT_OPP} WHERE o.id = ?`).get(id) as OpportunityRow | undefined;
    return row ? toOpportunity(row) : null;
  }

  getAnalysis(id: string): StoredAnalysis | null {
    const row = this.db.prepare("SELECT * FROM analyses WHERE opportunity_id = ?").get(id) as
      | { opportunity_id: string; model: string; payload: string; input_tokens: number; output_tokens: number; created_at: string }
      | undefined;
    if (!row) return null;
    return {
      ...(JSON.parse(row.payload) as AiAnalysis),
      opportunityId: row.opportunity_id,
      model: row.model,
      createdAt: row.created_at,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
    };
  }

  getActivity(id: string, limit = 50): ActivityEntry[] {
    return this.db
      .prepare("SELECT action, detail, actor, at FROM activity WHERE opportunity_id = ? ORDER BY at DESC, id DESC LIMIT ?")
      .all(id, limit) as unknown as ActivityEntry[];
  }

  list(f: ListFilters, now = new Date()): { items: Opportunity[]; total: number } {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    const inList = (col: string, values?: string[]) => {
      if (!values?.length) return;
      where.push(`${col} IN (${values.map(() => "?").join(",")})`);
      params.push(...values);
    };

    if (f.q?.trim()) {
      where.push("o.rowid IN (SELECT rowid FROM opportunities_fts WHERE opportunities_fts MATCH ?)");
      params.push(toFtsQuery(f.q));
    }
    inList("o.status", f.status);
    inList("o.tier", f.tier);
    inList("o.source", f.source);
    inList("o.type", f.type);
    if (f.minScore !== undefined) {
      where.push("o.score >= ?");
      params.push(f.minScore);
    }
    if (!f.includeExpired) {
      where.push("(o.deadline IS NULL OR o.deadline >= ?)");
      params.push(now.toISOString());
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const order = {
      score: "o.score DESC, o.deadline IS NULL, o.deadline ASC",
      deadline: "o.deadline IS NULL, o.deadline ASC, o.score DESC",
      newest: "o.first_seen_at DESC, o.score DESC",
    }[f.sort ?? "score"];
    const limit = Math.min(Math.max(f.limit ?? 50, 1), 500);
    const offset = Math.max(f.offset ?? 0, 0);

    const { n: total } = this.db.prepare(`SELECT COUNT(*) AS n FROM opportunities o ${clause}`).get(...params) as { n: number };
    const rows = this.db.prepare(`${SELECT_OPP} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as unknown as OpportunityRow[];
    return { items: rows.map(toOpportunity), total };
  }

  /** Unanalysed, still-open opportunities above a score threshold — candidates for automatic AI review. */
  analysisCandidates(minScore: number, limit: number, now = new Date()): Opportunity[] {
    const rows = this.db
      .prepare(
        `${SELECT_OPP} WHERE o.score >= ? AND o.status NOT IN ('dismissed','lost')
           AND (o.deadline IS NULL OR o.deadline >= ?)
           AND NOT EXISTS (SELECT 1 FROM analyses a WHERE a.opportunity_id = o.id)
         ORDER BY o.score DESC LIMIT ?`,
      )
      .all(minScore, now.toISOString(), limit) as unknown as OpportunityRow[];
    return rows.map(toOpportunity);
  }

  newSince(sinceIso: string, minScore: number, now = new Date()): Opportunity[] {
    const rows = this.db
      .prepare(
        `${SELECT_OPP} WHERE o.first_seen_at >= ? AND o.score >= ? AND o.status != 'dismissed'
           AND (o.deadline IS NULL OR o.deadline >= ?) ORDER BY o.score DESC LIMIT 100`,
      )
      .all(sinceIso, minScore, now.toISOString()) as unknown as OpportunityRow[];
    return rows.map(toOpportunity);
  }

  stats(now = new Date()) {
    const nowIso = now.toISOString();
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString();
    const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
    const open = "(deadline IS NULL OR deadline >= ?)";
    const one = (sql: string, ...p: SQLInputValue[]) => (this.db.prepare(sql).get(...p) as { n: number }).n;
    const group = (sql: string, ...p: SQLInputValue[]) =>
      Object.fromEntries((this.db.prepare(sql).all(...p) as { k: string; n: number }[]).map((r) => [r.k, r.n]));
    return {
      open: one(`SELECT COUNT(*) n FROM opportunities WHERE ${open} AND status != 'dismissed'`, nowIso),
      newLast24h: one(`SELECT COUNT(*) n FROM opportunities WHERE first_seen_at >= ?`, dayAgo),
      hotOpen: one(`SELECT COUNT(*) n FROM opportunities WHERE tier = 'hot' AND ${open} AND status != 'dismissed'`, nowIso),
      closingThisWeek: one(
        `SELECT COUNT(*) n FROM opportunities WHERE deadline BETWEEN ? AND ? AND score >= 50 AND status NOT IN ('dismissed','lost')`,
        nowIso, weekAhead,
      ),
      byTier: group(`SELECT tier k, COUNT(*) n FROM opportunities WHERE ${open} AND status != 'dismissed' GROUP BY tier`, nowIso),
      byStatus: group(`SELECT status k, COUNT(*) n FROM opportunities GROUP BY status`),
      bySource: group(`SELECT source k, COUNT(*) n FROM opportunities WHERE ${open} GROUP BY source`, nowIso),
    };
  }

  // ---------------------------------------------------------------- scrape runs

  startRun(source: string): number {
    const r = this.db
      .prepare("INSERT INTO scrape_runs (source, started_at, status) VALUES (?, ?, 'running')")
      .run(source, new Date().toISOString());
    return Number(r.lastInsertRowid);
  }

  finishRun(id: number, r: Pick<ScrapeRun, "status" | "fetched" | "created" | "updated" | "rejected" | "error">): void {
    this.db
      .prepare("UPDATE scrape_runs SET finished_at = ?, status = ?, fetched = ?, created = ?, updated = ?, rejected = ?, error = ? WHERE id = ?")
      .run(new Date().toISOString(), r.status, r.fetched, r.created, r.updated, r.rejected, r.error, id);
  }

  /** Marks runs left 'running' by a crashed process as failed so the dashboard never shows them stuck. */
  failOrphanedRuns(): void {
    this.db
      .prepare("UPDATE scrape_runs SET status = 'failed', finished_at = ?, error = 'Interrupted (process restarted)' WHERE status = 'running'")
      .run(new Date().toISOString());
  }

  latestRuns(): ScrapeRun[] {
    const rows = this.db
      .prepare(
        `SELECT r.* FROM scrape_runs r
         JOIN (SELECT source, MAX(id) AS id FROM scrape_runs GROUP BY source) last ON last.id = r.id`,
      )
      .all() as unknown as Record<string, unknown>[];
    return rows.map(toRun);
  }

  recentRuns(limit = 30): ScrapeRun[] {
    return (this.db.prepare("SELECT * FROM scrape_runs ORDER BY id DESC LIMIT ?").all(limit) as unknown as Record<string, unknown>[]).map(toRun);
  }
}

function toRun(r: Record<string, unknown>): ScrapeRun {
  return {
    id: r.id as number,
    source: r.source as string,
    startedAt: r.started_at as string,
    finishedAt: (r.finished_at as string | null) ?? null,
    status: r.status as ScrapeRun["status"],
    fetched: r.fetched as number,
    created: r.created as number,
    updated: r.updated as number,
    rejected: r.rejected as number,
    error: (r.error as string | null) ?? null,
  };
}

function toOpportunity(r: OpportunityRow): Opportunity {
  return {
    id: r.id,
    source: r.source,
    externalId: r.external_id,
    url: r.url,
    title: r.title,
    description: r.description,
    buyer: r.buyer,
    country: r.country,
    type: r.type as Opportunity["type"],
    category: r.category,
    referenceNo: r.reference_no,
    publishedAt: r.published_at,
    deadline: r.deadline,
    documents: JSON.parse(r.documents),
    meta: JSON.parse(r.meta),
    status: r.status as PipelineStatus,
    notes: r.notes,
    owner: r.owner,
    score: r.score,
    tier: r.tier as Tier,
    breakdown: JSON.parse(r.breakdown),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    updatedAt: r.updated_at,
    hasAnalysis: Boolean(r.has_analysis),
  };
}

/** Turns free user input into a safe FTS5 prefix query (no operator injection, no syntax errors). */
export function toFtsQuery(input: string): string {
  const tokens = input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1)
    .slice(0, 12);
  return tokens.length ? tokens.map((t) => `"${t}"*`).join(" AND ") : '""';
}
