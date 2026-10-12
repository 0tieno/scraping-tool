import { z } from "zod";
import { parseDate } from "../core/dates.js";
import { htmlToText, truncate } from "../core/text.js";
import type { OpportunityType, ScrapedOpportunityInput } from "../core/types.js";
import type { Source, SourceContext } from "./types.js";

const API = "https://search.worldbank.org/api/v2/procnotices";
const PAGE_SIZE = 100;

// Contact person names/emails/phones are deliberately not declared, so they are never stored.
const NoticeSchema = z.object({
  id: z.string(),
  notice_type: z.string().nullish(),
  notice_lang_name: z.string().nullish(),
  noticedate: z.string().nullish(),
  submission_deadline_date: z.string().nullish(),
  submission_deadline_time: z.string().nullish(),
  project_ctry_name: z.string().nullish(),
  project_id: z.string().nullish(),
  project_name: z.string().nullish(),
  bid_reference_no: z.string().nullish(),
  bid_description: z.string().nullish(),
  procurement_group: z.string().nullish(),
  procurement_method_name: z.string().nullish(),
  contact_organization: z.string().nullish(),
  notice_text: z.string().nullish(),
});
type Notice = z.infer<typeof NoticeSchema>;

const LANGUAGES: Record<string, string> = { english: "en", french: "fr", portuguese: "pt", spanish: "es", arabic: "ar" };
const GROUPS: Record<string, string> = { GO: "Goods", CW: "Works", CS: "Consulting Services", NC: "Non-consulting Services" };

export function createWorldBankSource(opts: { maxRows: number; countries: string[]; excludeNoticeTypes: string[] }): Source {
  // Country filtering happens server-side; the API ORs values joined with "^" and needs exact World Bank names.
  const countryFilter = opts.countries.length
    ? `&project_ctry_name_exact=${opts.countries.map(encodeURIComponent).join("%5E")}`
    : "";
  const excluded = new Set(opts.excludeNoticeTypes.map((t) => t.toLowerCase()));
  return {
    id: "world-bank",
    name: "World Bank procurement notices",
    homepage: "https://projects.worldbank.org/en/projects-operations/procurement",
    kind: "api",
    description: "Invitations for bids, requests for expressions of interest and RFPs under World Bank-financed projects.",
    async *fetch(ctx: SourceContext) {
      for (let offset = 0; offset < opts.maxRows; offset += PAGE_SIZE) {
        const url = `${API}?format=json&rows=${PAGE_SIZE}&os=${offset}${countryFilter}`;
        const raw = await ctx.http.json<{ procnotices?: unknown }>(url, { signal: ctx.signal });
        // The API returns either an array or an id-keyed object depending on the query.
        const list = Array.isArray(raw.procnotices) ? raw.procnotices : Object.values(raw.procnotices ?? {});
        if (!list.length) break;
        for (const item of list) {
          const n = NoticeSchema.safeParse(item);
          if (!n.success) continue;
          if (excluded.has((n.data.notice_type ?? "").toLowerCase())) continue;
          if (!n.data.bid_description && !n.data.project_name) continue;
          yield toOpportunity(n.data);
        }
        if (list.length < PAGE_SIZE) break;
      }
    },
  };
}

export function toOpportunity(n: Notice): ScrapedOpportunityInput {
  const title = n.bid_description?.trim() || `${n.notice_type ?? "Notice"}: ${n.project_name}`;
  // The API's time field is an ambiguous 12-hour clock ("02:00" for 2pm), so only the date is trusted.
  // Using the start of that day (EAT) errs on the side of planning to submit early.
  const deadline = n.submission_deadline_date ? parseDate(n.submission_deadline_date.slice(0, 10)) : null;
  const body = htmlToText(n.notice_text);
  return {
    source: "world-bank",
    externalId: n.id,
    url: `https://projects.worldbank.org/en/projects-operations/procurement-detail/${n.id}`,
    title: truncate(title, 400),
    description: truncate([n.project_name ? `Project: ${n.project_name}` : "", body].filter(Boolean).join("\n\n"), 12_000),
    buyer: n.contact_organization ?? null,
    country: n.project_ctry_name ?? null,
    type: mapType(n.notice_type, n.procurement_method_name, n.procurement_group),
    category: GROUPS[n.procurement_group ?? ""] ?? n.procurement_group ?? null,
    referenceNo: n.bid_reference_no ?? null,
    publishedAt: parseDate(n.noticedate),
    deadline,
    documents: [],
    meta: {
      noticeType: n.notice_type ?? null,
      method: n.procurement_method_name ?? null,
      projectId: n.project_id ?? null,
      language: LANGUAGES[(n.notice_lang_name ?? "").toLowerCase()] ?? null,
      deadlineTime: n.submission_deadline_time ?? null,
    },
  };
}

function mapType(noticeType?: string | null, method?: string | null, group?: string | null): OpportunityType {
  const t = (noticeType ?? "").toLowerCase();
  const m = (method ?? "").toLowerCase();
  if (t.includes("expression of interest")) return "eoi";
  if (m.includes("proposal")) return "rfp";
  if (m.includes("quotation")) return "rfq";
  if (t.includes("general procurement notice")) return "notice";
  if (group === "CS") return "consultancy";
  return "tender";
}
