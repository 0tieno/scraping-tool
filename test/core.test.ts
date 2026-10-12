import { describe, expect, it } from "vitest";
import { parseDate, daysUntil } from "../src/core/dates.js";
import { detectLanguage } from "../src/core/language.js";
import { evaluate, parseRobots } from "../src/core/robots.js";
import { htmlToText, tidyTitle } from "../src/core/text.js";

describe("parseDate", () => {
  it.each([
    ["2026-10-12 10:30:00", "2026-10-12T07:30:00.000Z"], // PPIP local time (EAT, UTC+3)
    ["2026-10-27T00:00:00Z", "2026-10-27T00:00:00.000Z"],
    ["10-Oct-2026", "2026-10-09T21:00:00.000Z"],
    ["22-Oct-26 09:00 AM", "2026-10-22T06:00:00.000Z"],
    ["12 October 2026", "2026-10-11T21:00:00.000Z"],
    ["November 3, 2026", "2026-11-02T21:00:00.000Z"],
    ["03/11/2026", "2026-11-02T21:00:00.000Z"], // day-first
    ["Fri, 09 Oct 2026 12:53:31 +0000", "2026-10-09T12:53:31.000Z"],
    ["12 PM", null],
    ["", null],
    [null, null],
  ])("parses %s", (input, expected) => {
    expect(parseDate(input)).toBe(expected);
  });

  it("honours an explicit offset", () => {
    expect(parseDate("2026-10-12", { assumeOffset: "+00:00" })).toBe("2026-10-12T00:00:00.000Z");
  });

  it("computes days until a deadline", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    expect(daysUntil("2026-10-11T00:00:00Z", now)).toBe(10);
    expect(daysUntil(null, now)).toBeNull();
  });
});

describe("robots.txt", () => {
  const rules = parseRobots(`
User-agent: *
Crawl-delay: 10
Disallow: /admin/
Allow: /admin/public
Disallow: /*.pdf$

User-agent: BadBot
Disallow: /
`);

  it("applies longest-match precedence", () => {
    expect(evaluate(rules, "kipeoopportunityradar", "/admin/secret").allowed).toBe(false);
    expect(evaluate(rules, "kipeoopportunityradar", "/admin/public/page").allowed).toBe(true);
    expect(evaluate(rules, "kipeoopportunityradar", "/tenders").allowed).toBe(true);
  });

  it("supports wildcards and end anchors", () => {
    expect(evaluate(rules, "kipeoopportunityradar", "/files/notice.pdf").allowed).toBe(false);
    expect(evaluate(rules, "kipeoopportunityradar", "/files/notice.pdf?x=1").allowed).toBe(true);
  });

  it("reports crawl-delay and honours agent-specific groups", () => {
    expect(evaluate(rules, "kipeoopportunityradar", "/").crawlDelayMs).toBe(10_000);
    expect(evaluate(rules, "badbot", "/anything").allowed).toBe(false);
  });

  it("treats an empty Disallow as allow-all and ignores HTML error pages", () => {
    expect(evaluate(parseRobots("User-agent: *\nDisallow:"), "x", "/a").allowed).toBe(true);
    expect(parseRobots("<!DOCTYPE html><html>Not found</html>")).toEqual([]);
  });
});

describe("text utilities", () => {
  it("converts HTML to readable text", () => {
    expect(htmlToText("<p>Scope:<br>Cloud&nbsp;migration</p><ul><li>AWS</li><li>Azure</li></ul><script>x()</script>")).toBe(
      "Scope:\nCloud migration\nAWS\nAzure",
    );
  });

  it("tidies shouting titles but keeps acronyms", () => {
    expect(tidyTitle("SUPPLY AND INSTALLATION OF ICT EQUIPMENT FOR THE COUNTY")).toBe("Supply and Installation of ICT Equipment for the County");
    expect(tidyTitle("Cloud migration for SACCO")).toBe("Cloud migration for SACCO");
  });
});

describe("detectLanguage", () => {
  it("distinguishes English, French and Portuguese", () => {
    expect(detectLanguage("Provision of consultancy services for the development of a management information system")).toBe("en");
    expect(detectLanguage("Recrutement d’un cabinet pour la digitalisation des services de l’Agence")).toBe("fr");
    expect(detectLanguage("Aquisição de serviços de consultoria para a digitalização dos processos")).toBe("pt");
    expect(detectLanguage("ERP")).toBeNull();
  });
});
