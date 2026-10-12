import { XMLParser } from "fast-xml-parser";
import type { FeedConfig } from "../config/loader.js";
import { parseDate } from "../core/dates.js";
import { collapseWhitespace, htmlToText, sha1, truncate } from "../core/text.js";
import type { OpportunityType } from "../core/types.js";
import type { Source, SourceContext } from "./types.js";

export interface FeedItem {
  id: string;
  title: string;
  link: string;
  description: string;
  publishedAt: string | null;
  categories: string[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  processEntities: true,
  htmlEntities: true,
  isArray: (name) => ["item", "entry", "category", "link"].includes(name),
});

/** Parses RSS 2.0 and Atom feeds into a uniform item list. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const rssItems: any[] = doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const atomEntries: any[] = doc.feed?.entry ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any

  const items: FeedItem[] = [];
  for (const it of rssItems) {
    const link = textOf(it.link?.[0]) || textOf(it.guid);
    const title = decodeEntities(textOf(it.title));
    if (!link || !title) continue;
    items.push({
      id: textOf(it.guid) || link,
      title,
      link,
      description: htmlToText(decodeEntities(textOf(it["content:encoded"]) || textOf(it.description))),
      publishedAt: parseDate(textOf(it.pubDate) || textOf(it["dc:date"])),
      categories: (it.category ?? []).map(textOf).filter(Boolean),
    });
  }
  for (const e of atomEntries) {
    const links: any[] = e.link ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const link = links.find((l) => !l["@rel"] || l["@rel"] === "alternate")?.["@href"] ?? links[0]?.["@href"];
    const title = decodeEntities(textOf(e.title));
    if (!link || !title) continue;
    items.push({
      id: textOf(e.id) || link,
      title,
      link,
      description: htmlToText(decodeEntities(textOf(e.content) || textOf(e.summary))),
      publishedAt: parseDate(textOf(e.published) || textOf(e.updated)),
      categories: (e.category ?? []).map((c: any) => c["@term"] ?? textOf(c)).filter(Boolean), // eslint-disable-line @typescript-eslint/no-explicit-any
    });
  }
  return items;
}

function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node).trim();
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) return textOf((node as Record<string, unknown>)["#text"]);
  return "";
}

/** Some publishers double-encode entities (e.g. "&amp;#039;"); decode what remains after XML parsing. */
export function decodeEntities(text: string): string {
  let out = text;
  for (let i = 0; i < 2 && /&(#\d+|#x[0-9a-f]+|amp|quot|apos|lt|gt|nbsp);/i.test(out); i++) {
    out = out
      .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&");
  }
  return collapseWhitespace(out);
}

/** Generic adapter for any RSS/Atom feed declared in config/sources.yaml. */
export function createFeedSource(cfg: FeedConfig): Source {
  return {
    id: cfg.id,
    name: cfg.name,
    homepage: cfg.homepage ?? new URL(cfg.url).origin,
    kind: "rss",
    description: `RSS feed: ${cfg.url}`,
    async *fetch(ctx: SourceContext) {
      const xml = await ctx.http.text(cfg.url, { signal: ctx.signal, headers: { Accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5" } });
      for (const item of parseFeed(xml)) {
        yield {
          source: cfg.id,
          externalId: sha1(item.id).slice(0, 24),
          url: item.link,
          title: truncate(item.title, 400),
          description: truncate(item.description, 12_000),
          country: cfg.country ?? null,
          type: inferType(item.title, cfg.type),
          category: item.categories.slice(0, 3).join(", ") || null,
          publishedAt: item.publishedAt,
          deadline: extractDeadline(item.description),
        };
      }
    },
  };
}

/** Notice titles often say what they are; that beats the feed's default type. */
export function inferType(title: string, fallback: OpportunityType): OpportunityType {
  if (/\b(expression of interest|EOI|REOI)\b/i.test(title)) return "eoi";
  if (/\b(request for proposals?|RFP)\b/i.test(title)) return "rfp";
  if (/\b(request for quotations?|RFQ)\b/i.test(title)) return "rfq";
  if (/\b(invitation to tender|tender|ITB|IFB)\b/i.test(title)) return "tender";
  return fallback;
}

/** Best-effort deadline extraction from free text, e.g. "Deadline: 30 November 2026". */
export function extractDeadline(text: string): string | null {
  const m = text.match(/(?:deadline|closing date|due date|submission date|closes?)\s*(?:is|:|-|for submission(?: of [a-z ]+)?:?)?\s*(?:on\s+)?([0-9]{1,2}(?:st|nd|rd|th)?[\s-][A-Za-z]{3,9}[\s,-]+[0-9]{2,4}|[A-Za-z]{3,9}\.? [0-9]{1,2}(?:st|nd|rd|th)?,? [0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  if (!m?.[1]) return null;
  return parseDate(m[1].replace(/(\d)(st|nd|rd|th)/i, "$1"));
}
