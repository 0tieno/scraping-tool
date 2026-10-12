import type { Logger } from "./logger.js";

interface RuleGroup {
  agents: string[];
  rules: { allow: boolean; path: string }[];
  crawlDelaySec?: number;
}

export interface RobotsVerdict {
  allowed: boolean;
  crawlDelayMs?: number;
}

const TTL_MS = 6 * 60 * 60 * 1000;
const UNREACHABLE_TTL_MS = 10 * 60 * 1000;
const DISALLOW_ALL: RuleGroup[] = [{ agents: ["*"], rules: [{ allow: false, path: "/" }] }];

/** Minimal RFC 9309 robots.txt implementation with longest-match semantics and wildcard support. */
export class RobotsCache {
  private readonly cache = new Map<string, { groups: RuleGroup[]; expiresAt: number }>();
  private readonly agentToken: string;

  constructor(
    userAgent: string,
    private readonly fetchText: (url: string) => Promise<string>,
    private readonly logger: Logger,
  ) {
    this.agentToken = userAgent.split(/[\s/]/)[0]!.toLowerCase();
  }

  async check(url: string): Promise<RobotsVerdict> {
    const u = new URL(url);
    if (u.pathname === "/robots.txt") return { allowed: true };
    const groups = await this.groupsFor(u.origin);
    return evaluate(groups, this.agentToken, u.pathname + u.search);
  }

  private async groupsFor(origin: string): Promise<RuleGroup[]> {
    const hit = this.cache.get(origin);
    if (hit && Date.now() < hit.expiresAt) return hit.groups;
    let groups: RuleGroup[];
    let ttl = TTL_MS;
    try {
      groups = parseRobots(await this.fetchText(`${origin}/robots.txt`));
    } catch (err) {
      // RFC 9309: a 4xx robots.txt means "no restrictions"; a 5xx or unreachable one means
      // "assume complete disallow" — re-checked soon so a transient outage doesn't stick.
      const status = (err as { status?: number }).status;
      if (status !== undefined && status >= 400 && status < 500) {
        groups = [];
      } else {
        groups = DISALLOW_ALL;
        ttl = UNREACHABLE_TTL_MS;
        this.logger.warn({ origin, err: (err as Error).message }, "robots.txt unreachable; treating site as disallowed for now");
      }
    }
    this.cache.set(origin, { groups, expiresAt: Date.now() + ttl });
    return groups;
  }
}

export function parseRobots(text: string): RuleGroup[] {
  // Guard against HTML error pages served with 200 at /robots.txt.
  if (/<html|<!doctype/i.test(text.slice(0, 500))) return [];
  const groups: RuleGroup[] = [];
  let current: RuleGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    const sep = line.indexOf(":");
    if (sep < 0) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (value === "" && key === "disallow") continue; // empty Disallow = allow all
      current.rules.push({ allow: key === "allow", path: value });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (!Number.isNaN(n)) current.crawlDelaySec = Math.min(n, 60);
    }
  }
  return groups;
}

export function evaluate(groups: RuleGroup[], agentToken: string, path: string): RobotsVerdict {
  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && agentToken.includes(a)));
  const applicable = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  if (!applicable.length) return { allowed: true };

  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    if (!matches(rule.path, path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { allow: rule.allow, length };
  }
  const delays = applicable.map((g) => g.crawlDelaySec).filter((d): d is number => d !== undefined);
  return {
    allowed: best ? best.allow : true,
    ...(delays.length ? { crawlDelayMs: Math.max(...delays) * 1000 } : {}),
  };
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`).test(path);
}
