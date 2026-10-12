export type Tier = "hot" | "warm" | "cool" | "cold";
export type PipelineStatus = "new" | "shortlisted" | "in_proposal" | "submitted" | "won" | "lost" | "dismissed";
export type OpportunityType = "tender" | "rfp" | "rfq" | "eoi" | "consultancy" | "grant" | "framework" | "notice" | "other";

export interface ScoreBreakdown {
  capability: number;
  secondary: number;
  buyer: number;
  geography: number;
  opportunityType: number;
  deadline: number;
  penalty: number;
  capabilities: string[];
  buyerSegment: string | null;
  matchedTerms: string[];
  penalties: string[];
  reasons: string[];
}

export interface Opportunity {
  id: string;
  source: string;
  externalId: string;
  url: string;
  title: string;
  description: string;
  buyer: string | null;
  country: string | null;
  type: OpportunityType;
  category: string | null;
  referenceNo: string | null;
  publishedAt: string | null;
  deadline: string | null;
  documents: { name: string; url: string }[];
  meta: Record<string, string | number | boolean | null>;
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

export interface Analysis {
  fitScore: number;
  recommendation: "bid" | "consider" | "pass";
  summary: string;
  whyKipeo: string[];
  gaps: string[];
  eligibilityChecks: string[];
  risks: string[];
  clarificationQuestions: string[];
  winThemes: string[];
  proposalOutline: { section: string; keyPoints: string[] }[];
  suggestedTeam: string[];
  effortEstimate: string;
  model: string;
  createdAt: string;
  inputTokens: number;
  outputTokens: number;
}

export interface ActivityEntry {
  action: string;
  detail: string | null;
  actor: string | null;
  at: string;
}

export interface Stats {
  open: number;
  newLast24h: number;
  hotOpen: number;
  closingThisWeek: number;
  byTier: Partial<Record<Tier, number>>;
  byStatus: Partial<Record<PipelineStatus, number>>;
  bySource: Record<string, number>;
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

export interface SourceStatus {
  id: string;
  name: string;
  homepage: string;
  kind: "api" | "rss" | "html";
  description: string;
  enabled: boolean;
  disabledReason: string | null;
  running: boolean;
  openCount: number;
  lastRun: ScrapeRun | null;
}

export interface Meta {
  company: string;
  aiEnabled: boolean;
  aiModel: string;
  notificationChannels: string[];
  authRequired: boolean;
  capabilities: { id: string; label: string; role: "core" | "secondary" }[];
  profileVersion: string;
}
