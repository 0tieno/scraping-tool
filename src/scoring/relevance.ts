import type { Profile } from "../config/loader.js";
import { daysUntil } from "../core/dates.js";
import { detectLanguage } from "../core/language.js";
import { escapeRegExp, normalizeForMatching } from "../core/text.js";
import type { RelevanceScore, ScrapedOpportunity, Tier } from "../core/types.js";

/**
 * Points per distinct term. Titles are what buyers write about the actual scope; descriptions
 * (especially development-bank notices) carry lots of procurement boilerplate, so body-only
 * hits are heavily discounted.
 */
const WEIGHTS = {
  title: { strong: 6, acronym: 4, moderate: 2 },
  body: { strong: 1.5, acronym: 1, moderate: 0.25 },
} as const;
/** Saturation constants: raw points needed to reach ~63% of a dimension's maximum. */
const CORE_SATURATION = 8;
const SECONDARY_SATURATION = 6;
/** Generic words alone ("system", "platform") are weak evidence; damp them until a specific term appears. */
const MODERATE_ONLY_FACTOR = 0.6;
/** Maximum contribution of each scoring dimension; they sum to 100. */
const MAX = { capability: 50, secondary: 8, buyer: 17, geography: 12, opportunityType: 8, deadline: 5 } as const;
/** Without any build/maintain signal an opportunity can never rise above this. */
const NO_CORE_CEILING = 25;
const MODERATE_ONLY_CEILING = 35;
const MAX_PENALTY = 60;

export type ScorableOpportunity = Pick<
  ScrapedOpportunity,
  "title" | "description" | "buyer" | "country" | "type" | "category" | "deadline" | "meta"
>;

type Strength = "strong" | "acronym" | "moderate";

interface Matcher {
  term: string;
  re: RegExp;
  /** Matched against the case-preserved text rather than the normalised text. */
  caseSensitive: boolean;
  strength: Strength;
}

interface CompiledGroup {
  label: string;
  weight: number;
  matchers: Matcher[];
}

interface CapabilityHit {
  id: string;
  label: string;
  role: "core" | "secondary";
  raw: number;
  terms: string[];
  specific: boolean;
  titleSpecific: boolean;
}

/**
 * Deterministic, explainable relevance scoring tuned to Kipeo's business model:
 * organisations paying Kipeo to build and maintain software. Every point is traceable
 * to a reason shown in the dashboard.
 */
export class RelevanceScorer {
  private readonly capabilities: { id: string; label: string; role: "core" | "secondary"; matchers: Matcher[] }[];
  private readonly buyers: CompiledGroup[];
  private readonly geography: CompiledGroup[];
  private readonly penalties: { id: string; label: string; points: number; waivedByCore: boolean; matchers: Matcher[] }[];
  private readonly categoryWeights: [RegExp, number][];

  constructor(private readonly profile: Profile) {
    this.capabilities = profile.capabilities.map((c) => ({
      id: c.id,
      label: c.label,
      role: c.role,
      matchers: [
        ...c.strong.map((t) => phrase(t, "strong")),
        ...c.moderate.map((t) => phrase(t, "moderate")),
        ...c.acronyms.map((t) => acronym(t)),
      ],
    }));
    const compile = (groups: Profile["buyers"]["groups"]) =>
      groups.map((g) => ({ label: g.label, weight: g.weight, matchers: g.terms.map((t) => phrase(t, "moderate")) }));
    this.buyers = compile(profile.buyers.groups);
    this.geography = compile([...profile.geography.groups].sort((a, b) => b.weight - a.weight));
    this.penalties = profile.penalties.map((p) => ({
      id: p.id,
      label: p.label,
      points: p.points,
      waivedByCore: p.waivedByCore,
      matchers: p.terms.map((t) => phrase(t, "moderate")),
    }));
    this.categoryWeights = Object.entries(profile.categories).map(([k, w]) => [phrase(k, "moderate").re, w]);
  }

  score(opp: ScorableOpportunity, now: Date = new Date()): RelevanceScore {
    const titleRaw = opp.title;
    const bodyRaw = [opp.description, opp.buyer ?? ""].join("\n");
    const title = normalizeForMatching(titleRaw);
    const body = normalizeForMatching(bodyRaw);
    const reasons: string[] = [];

    // 1. Capability fit: core (build/maintain) dominates; secondary expertise only adds a little.
    const hits = this.capabilities.map((cap) => this.matchCapability(cap, titleRaw, title, bodyRaw, body)).filter((h) => h.raw > 0);
    const core = hits.filter((h) => h.role === "core").sort((a, b) => b.raw - a.raw);
    const secondary = hits.filter((h) => h.role === "secondary").sort((a, b) => b.raw - a.raw);

    const coreRaw = core.reduce((sum, h, i) => sum + (i === 0 ? h.raw : h.raw * 0.5), 0);
    const coreSpecific = core.some((h) => h.specific);
    const capability = MAX.capability * saturate(coreRaw, CORE_SATURATION) * (coreSpecific ? 1 : MODERATE_ONLY_FACTOR);
    const coreInTitle = core.some((h) => h.titleSpecific);
    const secondaryRaw = secondary.reduce((sum, h) => sum + h.raw, 0);
    const secondaryPoints = MAX.secondary * saturate(secondaryRaw, SECONDARY_SATURATION);

    for (const h of [...core, ...secondary].filter((h) => h.terms.length).slice(0, 3)) {
      reasons.push(`${h.label}: ${h.terms.slice(0, 4).join(", ")}`);
    }

    // 2. Buyer fit — who is paying? Matched on the title and buyer name, most specific term wins.
    const buyerMatch = longestGroupMatch(this.buyers, normalizeForMatching(`${opp.buyer ?? ""}\n${titleRaw}`));
    const buyer = MAX.buyer * (buyerMatch?.weight ?? this.profile.buyers.default);
    reasons.push(buyerMatch ? `Buyer: ${buyerMatch.label}` : "Buyer type unclear");

    // 3. Geography — prefer the structured country field, then fall back to free text.
    const geo = this.matchGeography(opp.country, `${title}\n${body}`);
    const geography = MAX.geography * geo.weight;
    reasons.push(geo.label ? `Location: ${geo.label}` : "Location unclear");

    // 4. Engagement type, adjusted by procurement category.
    const categoryWeight = this.categoryWeight(opp.category);
    const opportunityType = MAX.opportunityType * (this.profile.opportunityTypes[opp.type] ?? 0.5) * categoryWeight;
    if (categoryWeight < 0.6 && opp.category) reasons.push(`Category: ${opp.category}`);

    // 5. Deadline feasibility.
    const { points: deadline, penalty: deadlinePenalty, note } = this.deadlinePoints(opp.deadline, now);
    if (note) reasons.push(note);

    // 6. "Looks relevant but isn't our business" — matched on the title only (descriptions are boilerplate-heavy).
    const applied: string[] = [];
    let penaltyPoints = 0;
    for (const p of this.penalties) {
      if (p.waivedByCore && coreInTitle) continue;
      const term = p.matchers.find((m) => m.re.test(title));
      if (!term) continue;
      penaltyPoints += p.points;
      applied.push(p.label);
      reasons.push(`${p.label} (${term.term})`);
      // An organisation hiring developers in-house is building software — a possible outsourcing lead.
      if (p.id === "staff-role" && coreSpecific) {
        reasons.push("Hiring signal: this organisation is building software in-house — possible outsourcing lead");
      }
    }

    // 7. Working language — the title's language wins over a portal's label.
    const declared = typeof opp.meta?.language === "string" ? opp.meta.language : null;
    const language = detectLanguage(opp.title) ?? declared ?? detectLanguage(opp.description.slice(0, 1500));
    const languagePenalty = language && !this.profile.languages.accepted.includes(language) ? this.profile.languages.penalty : 0;
    if (languagePenalty) reasons.push(`Notice language: ${language}`);

    const penalty = Math.min(MAX_PENALTY, penaltyPoints) + deadlinePenalty + languagePenalty;
    let total = capability + secondaryPoints + buyer + geography + opportunityType + deadline - penalty;
    if (coreRaw === 0) {
      total = Math.min(total, NO_CORE_CEILING);
      reasons.unshift("Not a software build or maintenance job");
    } else if (!coreSpecific) {
      // Only generic words ("system", "maintenance", "digital") — too weak to call it a software job.
      total = Math.min(total, MODERATE_ONLY_CEILING);
      reasons.unshift("Only generic software words — check the scope");
    }
    const score = Math.round(Math.max(0, Math.min(100, total)));

    return {
      score,
      tier: tierFor(score),
      breakdown: {
        capability: round1(capability),
        secondary: round1(secondaryPoints),
        buyer: round1(buyer),
        geography: round1(geography),
        opportunityType: round1(opportunityType),
        deadline: round1(deadline),
        penalty: round1(penalty),
        capabilities: [...core, ...secondary].map((h) => h.id),
        buyerSegment: buyerMatch?.label ?? null,
        matchedTerms: [...new Set([...core, ...secondary].flatMap((h) => h.terms))].slice(0, 15),
        penalties: applied,
        reasons,
      },
    };
  }

  private matchCapability(
    cap: { id: string; label: string; role: "core" | "secondary"; matchers: Matcher[] },
    titleRaw: string,
    title: string,
    bodyRaw: string,
    body: string,
  ): CapabilityHit {
    let raw = 0;
    let specific = false;
    let titleSpecific = false;
    const terms: string[] = [];
    for (const m of cap.matchers) {
      if (m.re.test(m.caseSensitive ? titleRaw : title)) {
        raw += WEIGHTS.title[m.strength];
        terms.push(m.term);
        if (m.strength !== "moderate") specific = titleSpecific = true;
      } else if (m.re.test(m.caseSensitive ? bodyRaw : body)) {
        raw += WEIGHTS.body[m.strength];
        if (m.strength !== "moderate") {
          specific = true;
          terms.push(m.term);
        }
      }
    }
    return { id: cap.id, label: cap.label, role: cap.role, raw, terms, specific, titleSpecific };
  }

  private categoryWeight(category: string | null): number {
    if (!category) return 1;
    const c = normalizeForMatching(category);
    // Longest pattern wins so "non consultancy services" beats "services".
    const hit = this.categoryWeights.filter(([re]) => re.test(c)).sort((a, b) => b[0].source.length - a[0].source.length)[0];
    return hit ? hit[1] : 1;
  }

  private matchGeography(country: string | null, text: string): { label: string | null; weight: number } {
    if (country) {
      const c = normalizeForMatching(country);
      const group = this.geography.find((g) => g.matchers.some((m) => m.re.test(c)));
      if (group) return { label: `${country} (${group.label})`, weight: group.weight };
    }
    const group = this.geography.find((g) => g.matchers.some((m) => m.re.test(text)));
    return group ? { label: group.label, weight: group.weight } : { label: country, weight: this.profile.geography.default };
  }

  private deadlinePoints(deadline: string | null, now: Date): { points: number; penalty: number; note?: string } {
    const days = daysUntil(deadline, now);
    if (days === null) return { points: MAX.deadline * 0.5, penalty: 0, note: "No deadline published" };
    const { comfortableDays, minimumDays } = this.profile.deadline;
    if (days < 0) return { points: 0, penalty: 0, note: "Deadline has passed" };
    const label = days < 1 ? "Closes within 24h" : `Closes in ${Math.floor(days)} days`;
    if (days < minimumDays) return { points: 0, penalty: 10, note: `${label} — likely too tight to respond` };
    if (days < comfortableDays) {
      const fraction = (days - minimumDays) / (comfortableDays - minimumDays);
      return { points: MAX.deadline * (0.4 + 0.6 * fraction), penalty: 0, note: `${label} — tight` };
    }
    return { points: MAX.deadline, penalty: 0, note: label };
  }
}

export function tierFor(score: number): Tier {
  if (score >= 70) return "hot";
  if (score >= 50) return "warm";
  if (score >= 30) return "cool";
  return "cold";
}

/** Picks the group whose matched term is most specific (longest); ties go to the higher weight. */
function longestGroupMatch(groups: CompiledGroup[], text: string): CompiledGroup | null {
  let best: { group: CompiledGroup; length: number } | null = null;
  for (const group of groups) {
    for (const m of group.matchers) {
      if (!m.re.test(text)) continue;
      const length = m.term.length;
      if (!best || length > best.length || (length === best.length && group.weight > best.group.weight)) best = { group, length };
    }
  }
  return best?.group ?? null;
}

function saturate(raw: number, k: number): number {
  return 1 - Math.exp(-raw / k);
}

function phrase(term: string, strength: Strength): Matcher {
  const norm = normalizeForMatching(term.trim());
  // Treat spaces/hyphens interchangeably so "e-services" matches "e services" and vice versa.
  const pattern = escapeRegExp(norm).replace(/(\\-|\s)+/g, "[\\s\\-]+");
  return { term, strength, caseSensitive: false, re: new RegExp(`(?<![a-z0-9])${pattern}(?![a-z0-9])`) };
}

function acronym(term: string): Matcher {
  return { term, strength: "acronym", caseSensitive: true, re: new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(term)}(?![A-Za-z0-9])`) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
