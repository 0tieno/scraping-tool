import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

const ENTITY_MAP: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Converts an HTML fragment to readable plain text, preserving paragraph breaks. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  if (!/[<&]/.test(html)) return collapseWhitespace(html);
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $("script, style, noscript").remove();
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr").each((_, el) => {
    $(el).append("\n");
  });
  return collapseWhitespace($("#__root").text());
}

export function collapseWhitespace(text: string): string {
  return text
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITY_MAP[m] ?? m)
    .replace(/\r/g, "")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Upper-case shouting titles (common on government portals) become sentence-friendly title case. */
export function tidyTitle(title: string): string {
  const clean = collapseWhitespace(title).replace(/\n/g, " ");
  const letters = clean.replace(/[^A-Za-z]/g, "");
  const upperRatio = letters.length ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
  if (upperRatio < 0.8 || letters.length < 12) return clean;
  return clean
    .toLowerCase()
    .replace(/\b([a-z])([a-z]*)/g, (word, first: string, rest: string) =>
      SMALL_WORDS.has(word) ? word : first.toUpperCase() + rest,
    )
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\b(ict|erp|ai|api|ngo|undp|sacco|ppe|cctv|lan|wan|isp|sms|gis|kra|tvet|ecde)\b/gi, (m) => m.toUpperCase());
}
const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function sha1(input: string): string {
  return createHash("sha1").update(input).digest("hex");
}

/** Lower-cases and strips diacritics/punctuation noise so keyword matching is robust. */
export function normalizeForMatching(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[‐-―]/g, "-")
    .replace(/[’‘]/g, "'");
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function absoluteUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
