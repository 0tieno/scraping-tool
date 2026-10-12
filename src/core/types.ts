import { z } from "zod";

export const OPPORTUNITY_TYPES = [
  "tender",
  "rfp",
  "rfq",
  "eoi",
  "consultancy",
  "grant",
  "framework",
  "notice",
  "other",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const PIPELINE_STATUSES = [
  "new",
  "shortlisted",
  "in_proposal",
  "submitted",
  "won",
  "lost",
  "dismissed",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export const TIERS = ["hot", "warm", "cool", "cold"] as const;
export type Tier = (typeof TIERS)[number];

/** Scraped links are rendered as hrefs, so only web URLs are accepted (blocks javascript:, data:, etc.). */
const webUrl = z.url({ protocol: /^https?$/ });

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), "must be an ISO-8601 date")
  .nullable();

/**
 * The normalised shape every source adapter must produce. Validated at the pipeline
 * boundary so a misbehaving adapter can never write malformed rows.
 */
export const ScrapedOpportunitySchema = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  url: webUrl,
  title: z.string().min(3).max(1000),
  description: z.string().max(20_000).default(""),
  buyer: z.string().max(500).nullable().default(null),
  country: z.string().max(120).nullable().default(null),
  type: z.enum(OPPORTUNITY_TYPES).default("other"),
  category: z.string().max(120).nullable().default(null),
  referenceNo: z.string().max(250).nullable().default(null),
  publishedAt: isoDate.default(null),
  deadline: isoDate.default(null),
  documents: z
    .array(z.object({ name: z.string(), url: webUrl }))
    .max(50)
    .default([]),
  /** Small, PII-free bag of source-specific attributes kept for display/debugging. */
  meta: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});

export type ScrapedOpportunity = z.infer<typeof ScrapedOpportunitySchema>;
export type ScrapedOpportunityInput = z.input<typeof ScrapedOpportunitySchema>;

export interface ScoreBreakdown {
  /** Build/maintain software fit (core capabilities). */
  capability: number;
  /** Supporting expertise (cloud, security, data, training). */
  secondary: number;
  /** How well the buyer matches Kipeo's client base. */
  buyer: number;
  geography: number;
  opportunityType: number;
  deadline: number;
  penalty: number;
  /** Capability ids ordered by contribution, core first, e.g. ["software-build", "cybersecurity"]. */
  capabilities: string[];
  /** Matched buyer segment label, e.g. "SACCOs & microfinance". */
  buyerSegment: string | null;
  matchedTerms: string[];
  /** Labels of penalty groups applied. */
  penalties: string[];
  reasons: string[];
}

export interface RelevanceScore {
  score: number;
  tier: Tier;
  breakdown: ScoreBreakdown;
}

export interface Opportunity extends ScrapedOpportunity {
  id: string;
  status: PipelineStatus;
  score: number;
  tier: Tier;
  breakdown: ScoreBreakdown;
  notes: string;
  owner: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  updatedAt: string;
  hasAnalysis: boolean;
}

export const AiAnalysisSchema = z.object({
  fitScore: z.number().describe("0-100 judgement of how well Kipeo Afrika fits this opportunity"),
  recommendation: z.enum(["bid", "consider", "pass"]),
  summary: z.string().describe("2-4 sentence plain-language summary of what the buyer wants"),
  whyKipeo: z.array(z.string()).describe("Concrete reasons Kipeo is a credible bidder"),
  gaps: z.array(z.string()).describe("Capability, eligibility or experience gaps to close"),
  eligibilityChecks: z
    .array(z.string())
    .describe("Mandatory requirements to verify before bidding (registration, AGPO, certifications, turnover, references)"),
  risks: z.array(z.string()),
  clarificationQuestions: z.array(z.string()).describe("Questions worth sending to the procuring entity"),
  winThemes: z.array(z.string()).describe("3-5 differentiating themes for the proposal"),
  proposalOutline: z
    .array(z.object({ section: z.string(), keyPoints: z.array(z.string()) }))
    .describe("Section-by-section outline of a responsive proposal"),
  suggestedTeam: z.array(z.string()).describe("Roles needed to deliver, e.g. 'Cloud security architect'"),
  effortEstimate: z.string().describe("Rough bid-preparation effort, e.g. '3-4 person-days'"),
});
export type AiAnalysis = z.infer<typeof AiAnalysisSchema>;

export interface StoredAnalysis extends AiAnalysis {
  opportunityId: string;
  model: string;
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ScrapeRun {
  id: number;
  source: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "partial" | "failed";
  fetched: number;
  created: number;
  updated: number;
  rejected: number;
  error: string | null;
}
