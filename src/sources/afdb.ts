import { sha1, truncate } from "../core/text.js";
import type { OpportunityType, ScrapedOpportunityInput } from "../core/types.js";
import { parseFeed, type FeedItem } from "./feed.js";
import type { Source, SourceContext } from "./types.js";

const FEED = "https://www.afdb.org/en/projects-and-operations/procurement.xml";

/** AfDB notice prefixes (English and French) → opportunity type; null = not biddable, skip. */
const PREFIXES: Record<string, OpportunityType | null> = {
  SPN: "tender", IFB: "tender", AOI: "tender", AON: "tender", AAO: "tender", RFB: "tender",
  EOI: "eoi", REOI: "eoi", AMI: "eoi",
  RFP: "rfp", DP: "rfp",
  RFQ: "rfq", DC: "rfq",
  GPN: "notice", AGPM: "notice", AG: "notice",
  PPM: null, // procurement plans
};

const COUNTRY_ALIASES: Record<string, string> = {
  RCA: "Central African Republic",
  RDC: "Democratic Republic of Congo",
  DRC: "Democratic Republic of Congo",
  "Guinée": "Guinea",
  "Côte d'Ivoire": "Cote d'Ivoire",
  Multinational: "Multinational (Africa)",
};

export function createAfdbSource(): Source {
  return {
    id: "afdb",
    name: "African Development Bank procurement",
    homepage: "https://www.afdb.org/en/projects-and-operations/procurement",
    kind: "rss",
    description: "Specific procurement notices, EOIs and GPNs for AfDB-financed projects across Africa.",
    async *fetch(ctx: SourceContext) {
      const xml = await ctx.http.text(FEED, { signal: ctx.signal });
      for (const item of parseFeed(xml)) {
        const opp = toOpportunity(item);
        if (opp) yield opp;
      }
    },
  };
}

export function toOpportunity(item: FeedItem): ScrapedOpportunityInput | null {
  if (/^contract awards?\b|^attribution/i.test(item.title)) return null;
  const parts = item.title.split(/\s+-\s+/);
  const prefix = (parts[0] ?? "").trim().toUpperCase();
  const known = prefix in PREFIXES;
  const type = known ? PREFIXES[prefix] : "notice";
  if (type === null || type === undefined) return null;

  const countryRaw = known && parts.length > 2 ? parts[1]!.trim() : null;
  const project = known && parts.length > 3 ? parts[parts.length - 1]!.trim() : null;
  const title = known ? parts.slice(2, project ? -1 : undefined).join(" - ") || item.title : item.title;

  return {
    source: "afdb",
    externalId: sha1(item.id).slice(0, 24),
    url: item.link,
    title: truncate(title, 400),
    description: truncate([project ? `Project: ${project}` : "", item.description].filter(Boolean).join("\n\n"), 12_000),
    buyer: null,
    country: countryRaw ? (COUNTRY_ALIASES[countryRaw] ?? countryRaw) : null,
    type,
    category: known ? prefix : null,
    referenceNo: null,
    publishedAt: item.publishedAt,
    deadline: null, // published inside the attached notice document
    documents: [],
    meta: { noticePrefix: known ? prefix : null, project },
  };
}
