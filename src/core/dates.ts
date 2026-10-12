const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5, juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, décembre: 11,
};

/**
 * Parses the date formats seen across procurement portals into an ISO string.
 * Returns null instead of guessing when the input is ambiguous or unparseable.
 *
 * Supported: ISO-8601, "2026-10-12 10:30:00", "12-Oct-2026", "12-Oct-26", "12 October 2026",
 * "October 12, 2026", RFC-2822 (RSS pubDate), "12/10/2026" (day-first, as used in Kenya).
 */
export function parseDate(input: string | null | undefined, opts: { assumeOffset?: string } = {}): string | null {
  if (!input) return null;
  const s = input.trim().replace(/\s+/g, " ");
  if (!s) return null;
  const offset = opts.assumeOffset ?? "+03:00"; // East Africa Time

  // ISO date / datetime, optionally with space separator and no zone.
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) {
    const [, y, mo, d, h = "00", mi = "00", sec = "00", , zone] = m;
    return toIso(`${y}-${mo}-${d}T${h}:${mi}:${sec}${zone ?? offset}`);
  }

  // 12-Oct-2026 / 12-Oct-26 / 12 October 2026 [09:00 AM]
  m = s.match(/^(\d{1,2})[-\s]([A-Za-zéû]{3,9})\.?[-\s,]+(\d{2,4})(?:[\s,]+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (m) {
    const [, d, monName, yRaw, h, mi, ampm] = m;
    const mon = monthIndex(monName!);
    if (mon !== undefined) return build(expandYear(yRaw!), mon, Number(d), h, mi, ampm, offset);
  }

  // October 12, 2026 [10:00 AM]
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})(?:[\s,]+(?:at )?(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (m) {
    const [, monName, d, y, h, mi, ampm] = m;
    const mon = monthIndex(monName!);
    if (mon !== undefined) return build(Number(y), mon, Number(d), h, mi, ampm, offset);
  }

  // 12/10/2026 or 12.10.2026 — day-first (Commonwealth convention).
  m = s.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const [, d, mo, y, h, mi] = m;
    if (Number(mo) <= 12) return build(Number(y), Number(mo) - 1, Number(d), h, mi, undefined, offset);
  }

  // RFC-2822 and anything else Date understands unambiguously (has a weekday or zone name).
  if (/[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4}/.test(s) || /GMT|UTC|[+-]\d{4}$/.test(s)) {
    return toIso(s);
  }
  return null;
}

/** Accepts abbreviations and full names ("Nov", "November", "novembre"). */
function monthIndex(name: string): number | undefined {
  const n = name.toLowerCase();
  return MONTHS[n] ?? MONTHS[n.slice(0, 3)];
}

function expandYear(y: string): number {
  const n = Number(y);
  return y.length === 2 ? 2000 + n : n;
}

function build(y: number, mon: number, d: number, h: string | undefined, mi: string | undefined, ampm: string | undefined, offset: string): string | null {
  if (d < 1 || d > 31) return null;
  let hour = h ? Number(h) : 0;
  if (ampm) {
    const pm = ampm.toUpperCase() === "PM";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return toIso(`${y}-${pad(mon + 1)}-${pad(d)}T${pad(hour)}:${mi ?? "00"}:00${offset}`);
}

function toIso(s: string): string | null {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function daysUntil(iso: string | null, now: Date = new Date()): number | null {
  if (!iso) return null;
  return (Date.parse(iso) - now.getTime()) / 86_400_000;
}
