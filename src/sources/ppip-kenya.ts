import { z } from "zod";
import { TransientPayloadError } from "../core/http.js";
import { parseDate } from "../core/dates.js";
import { tidyTitle } from "../core/text.js";
import type { OpportunityType, ScrapedOpportunityInput } from "../core/types.js";
import type { Source, SourceContext } from "./types.js";

const BASE = "https://tenders.go.ke";
const PAGE_SIZE = 50;

// Only the fields we use are declared; everything else (incl. officials' personal contact
// details that the API exposes) is dropped at parse time and never persisted.
const TenderSchema = z.object({
  id: z.number(),
  title: z.string(),
  tender_ref: z.string().nullish(),
  published_at: z.string().nullish(),
  close_at: z.string().nullish(),
  description: z.string().nullish(),
  tender_fee: z.number().nullish(),
  is_agpo: z.union([z.number(), z.boolean()]).nullish(),
  pe: z.object({ name: z.string() }).nullish(),
  procurement_method: z.object({ title: z.string() }).nullish(),
  procurement_category: z.object({ title: z.string() }).nullish(),
  documents: z.array(z.object({ description: z.string().nullish(), url: z.string() })).nullish(),
});
type Tender = z.infer<typeof TenderSchema>;

const PageSchema = z.object({
  current_page: z.number(),
  last_page: z.number(),
  data: z.array(z.unknown()),
});

export function createPpipSource(opts: { maxPages: number }): Source {
  return {
    id: "ppip-kenya",
    name: "Kenya PPIP (tenders.go.ke)",
    homepage: BASE,
    kind: "api",
    description: "All active national and county government tenders on Kenya's Public Procurement Information Portal.",
    async *fetch(ctx: SourceContext) {
      let lastPage = 1;
      for (let page = 1; page <= Math.min(lastPage, opts.maxPages); page++) {
        const url = `${BASE}/api/active-tenders?perpage=${PAGE_SIZE}&page=${page}`;
        const raw = await ctx.http.json<unknown>(url, {
          signal: ctx.signal,
          // The API intermittently answers 200 {"message":"Server Error"}; treat it as retryable.
          validate: (text) => {
            if (!text.includes('"data"')) throw new TransientPayloadError("PPIP returned an error payload", url);
          },
        });
        const parsed = PageSchema.parse(raw);
        lastPage = parsed.last_page;
        for (const item of parsed.data) {
          const t = TenderSchema.safeParse(item);
          if (!t.success) {
            ctx.logger.warn({ source: "ppip-kenya", issues: t.error.issues.slice(0, 3) }, "skipping malformed tender");
            continue;
          }
          yield toOpportunity(t.data);
        }
      }
    },
  };
}

export function toOpportunity(t: Tender): ScrapedOpportunityInput {
  const method = t.procurement_method?.title ?? null;
  const category = t.procurement_category?.title ?? null;
  return {
    source: "ppip-kenya",
    externalId: String(t.id),
    url: `${BASE}/tenders/${t.id}`,
    title: tidyTitle(t.title),
    description: t.description ?? "",
    buyer: t.pe?.name ? tidyTitle(t.pe.name) : null,
    country: "Kenya",
    type: mapType(method, category),
    category,
    referenceNo: t.tender_ref ?? null,
    publishedAt: parseDate(t.published_at),
    deadline: parseDate(t.close_at),
    documents: (t.documents ?? []).slice(0, 20).map((d) => ({
      name: (d.description ?? "Tender document").replace(/^\d{10,}-/, ""),
      url: new URL(d.url, BASE).toString(),
    })),
    meta: {
      method,
      agpo: Boolean(t.is_agpo),
      tenderFeeKes: t.tender_fee ?? null,
    },
  };
}

function mapType(method: string | null, category: string | null): OpportunityType {
  const m = (method ?? "").toLowerCase();
  if (m.includes("expression of interest")) return "eoi";
  if (m.includes("request for proposal")) return "rfp";
  if (m.includes("quotation")) return "rfq";
  if (m.includes("framework")) return "framework";
  if ((category ?? "").toLowerCase() === "consultancy services") return "consultancy";
  return "tender";
}
