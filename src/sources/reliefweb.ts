import { z } from "zod";
import { parseDate } from "../core/dates.js";
import { htmlToText, truncate } from "../core/text.js";
import type { Source, SourceContext } from "./types.js";

const API = "https://api.reliefweb.int/v2/jobs";

const JobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  fields: z.object({
    title: z.string(),
    url_alias: z.string().nullish(),
    url: z.string().nullish(),
    body: z.string().nullish(),
    date: z.object({ created: z.string().nullish(), closing: z.string().nullish() }).nullish(),
    source: z.array(z.object({ name: z.string() })).nullish(),
    country: z.array(z.object({ name: z.string() })).nullish(),
    type: z.array(z.object({ name: z.string() })).nullish(),
  }),
});

/**
 * ReliefWeb consultancy postings — NGOs and UN agencies frequently advertise ICT/digital
 * consultancies here. Requires an approved appname (RELIEFWEB_APPNAME).
 */
export function createReliefWebSource(opts: { appname: string; countries: string[] }): Source {
  return {
    id: "reliefweb",
    name: "ReliefWeb consultancies",
    homepage: "https://reliefweb.int/jobs",
    kind: "api",
    description: "Consultancy opportunities posted by NGOs and UN agencies on ReliefWeb.",
    async *fetch(ctx: SourceContext) {
      const conditions: unknown[] = [{ field: "type.name", value: "Consultancy" }];
      if (opts.countries.length) conditions.push({ field: "country.name", value: opts.countries, operator: "OR" });
      const body = {
        limit: 200,
        sort: ["date.created:desc"],
        profile: "full",
        filter: { operator: "AND", conditions },
      };
      const raw = await ctx.http.json<{ data?: unknown[] }>(`${API}?appname=${encodeURIComponent(opts.appname)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctx.signal,
      });
      for (const item of raw.data ?? []) {
        const job = JobSchema.safeParse(item);
        if (!job.success) continue;
        const f = job.data.fields;
        yield {
          source: "reliefweb",
          externalId: String(job.data.id),
          url: f.url_alias || f.url || `https://reliefweb.int/job/${job.data.id}`,
          title: truncate(f.title, 400),
          description: truncate(htmlToText(f.body), 12_000),
          buyer: f.source?.[0]?.name ?? null,
          country: f.country?.map((c) => c.name).join(", ") || null,
          type: "consultancy" as const,
          category: f.type?.[0]?.name ?? null,
          publishedAt: parseDate(f.date?.created),
          deadline: parseDate(f.date?.closing),
        };
      }
    },
  };
}
