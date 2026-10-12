import type { OpportunityType, PipelineStatus, Tier } from "./types";

const TZ = "Africa/Nairobi";

export function formatDate(iso: string | null, withTime = false): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: TZ,
  });
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface Countdown {
  label: string;
  urgency: "expired" | "critical" | "soon" | "ok" | "unknown";
}

export function countdown(deadline: string | null): Countdown {
  if (!deadline) return { label: "No deadline", urgency: "unknown" };
  const days = (new Date(deadline).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return { label: "Closed", urgency: "expired" };
  if (days < 1) return { label: `${Math.max(1, Math.round(days * 24))}h left`, urgency: "critical" };
  if (days < 3) return { label: `${Math.floor(days)}d left`, urgency: "critical" };
  if (days < 10) return { label: `${Math.floor(days)}d left`, urgency: "soon" };
  return { label: `${Math.floor(days)}d left`, urgency: "ok" };
}

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  in_proposal: "In proposal",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  dismissed: "Dismissed",
};
export const STATUSES = Object.keys(STATUS_LABELS) as PipelineStatus[];

export const TIER_LABELS: Record<Tier, string> = { hot: "Hot", warm: "Warm", cool: "Cool", cold: "Cold" };
export const TIERS = Object.keys(TIER_LABELS) as Tier[];

export const TYPE_LABELS: Record<OpportunityType, string> = {
  tender: "Tender",
  rfp: "RFP",
  rfq: "RFQ",
  eoi: "EOI",
  consultancy: "Consultancy",
  grant: "Grant",
  framework: "Framework",
  notice: "Notice",
  other: "Other",
};

export const SOURCE_LABELS: Record<string, string> = {
  "ppip-kenya": "Kenya PPIP",
  "world-bank": "World Bank",
  afdb: "AfDB",
  reliefweb: "ReliefWeb",
  fundsforngos: "fundsforNGOs",
  "ngojobs-consultancy": "NGO Jobs · Consultancy",
  "ngojobs-it": "NGO Jobs · IT",
  "ngojobs-procurement": "NGO Jobs · Procurement",
  "ngojobs-latest": "NGO Jobs · Latest",
};
export const sourceLabel = (id: string) => SOURCE_LABELS[id] ?? id;

export function humanizeCapability(id: string, caps: { id: string; label: string }[]): string {
  return caps.find((c) => c.id === id)?.label ?? id;
}
