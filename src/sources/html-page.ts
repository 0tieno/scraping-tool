import * as cheerio from "cheerio";
import type { PageConfig } from "../config/loader.js";
import { parseDate } from "../core/dates.js";
import { absoluteUrl, collapseWhitespace, sha1, truncate } from "../core/text.js";
import type { Source, SourceContext } from "./types.js";

type Cheerio = ReturnType<cheerio.CheerioAPI>;

/**
 * Generic listing-page adapter driven entirely by CSS selectors in config/sources.yaml,
 * so new procurement pages can be added without code. Selector syntax: "css" reads text,
 * "css@attr" reads an attribute, "" skips the field.
 */
export function createHtmlPageSource(cfg: PageConfig): Source {
  return {
    id: cfg.id,
    name: cfg.name,
    homepage: new URL(cfg.url).origin,
    kind: "html",
    description: `Listing page: ${cfg.url}`,
    async *fetch(ctx: SourceContext) {
      const html = await ctx.http.text(cfg.url, { signal: ctx.signal, headers: { Accept: "text/html" } });
      yield* extractListing(html, cfg);
    },
  };
}

export function* extractListing(html: string, cfg: PageConfig) {
  const $ = cheerio.load(html);
  const s = cfg.selectors;
  for (const el of $(s.item).toArray()) {
    const row = $(el);
    const title = pick(row, s.title);
    const href = pick(row, s.link);
    const url = href ? absoluteUrl(href, cfg.url) : null;
    if (!title || !url) continue;
    yield {
      source: cfg.id,
      externalId: sha1(url + title).slice(0, 24),
      url,
      title: truncate(title, 400),
      description: truncate(pick(row, s.description), 12_000),
      buyer: pick(row, s.buyer) || null,
      country: cfg.country ?? null,
      type: cfg.type,
      referenceNo: pick(row, s.reference) || null,
      publishedAt: parseDate(pick(row, s.published)),
      deadline: parseDate(pick(row, s.deadline)),
    };
  }
}

function pick(row: Cheerio, selector: string): string {
  if (!selector) return "";
  const [css, attr] = selector.split("@") as [string, string | undefined];
  const target = css ? row.find(css).first() : row;
  const value = attr ? target.attr(attr) : target.text();
  return collapseWhitespace(value ?? "");
}
