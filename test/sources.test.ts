import { describe, expect, it } from "vitest";
import { ScrapedOpportunitySchema } from "../src/core/types.js";
import { toOpportunity as afdbToOpportunity } from "../src/sources/afdb.js";
import { decodeEntities, extractDeadline, parseFeed } from "../src/sources/feed.js";
import { extractListing } from "../src/sources/html-page.js";
import { toOpportunity as ppipToOpportunity } from "../src/sources/ppip-kenya.js";
import { toOpportunity as wbToOpportunity } from "../src/sources/world-bank.js";

describe("PPIP Kenya adapter", () => {
  const tender = {
    id: 306964,
    title: "PROVISION OF DEDICATED INTERNET SERVICES AT THE ELDORET NATIONAL POLYTECHNIC",
    tender_ref: "TENP/T/003/2026/2027",
    published_at: "2026-09-29 00:00:00",
    close_at: "2026-10-12 10:30:00",
    description: null,
    tender_fee: 0,
    is_agpo: null,
    pe: { name: "THE ELDORET NATIONAL POLYTECHNIC" },
    procurement_method: { title: "Open Tender" },
    procurement_category: { title: "Non Consultancy Services" },
    documents: [{ description: "1790974817312-Tender Document", url: "/storage/Documents/tender.pdf" }],
  };

  it("normalises a tender into a valid opportunity", () => {
    const o = ScrapedOpportunitySchema.parse(ppipToOpportunity(tender));
    expect(o).toMatchObject({
      source: "ppip-kenya",
      externalId: "306964",
      url: "https://tenders.go.ke/tenders/306964",
      title: "Provision of Dedicated Internet Services at the Eldoret National Polytechnic",
      buyer: "The Eldoret National Polytechnic",
      country: "Kenya",
      type: "tender",
      deadline: "2026-10-12T07:30:00.000Z",
      referenceNo: "TENP/T/003/2026/2027",
    });
    expect(o.documents).toEqual([{ name: "Tender Document", url: "https://tenders.go.ke/storage/Documents/tender.pdf" }]);
  });

  it("never carries officials' personal data into the record", () => {
    const withPii = { ...tender, created_by: { name: "Jane Officer", phone: "+254700000000", email: "jane@example.go.ke" } };
    const serialised = JSON.stringify(ppipToOpportunity(withPii as typeof tender));
    expect(serialised).not.toMatch(/Jane|254700000000|jane@/);
  });

  it("maps procurement methods to opportunity types", () => {
    const type = (method: string, category = "Goods") =>
      ppipToOpportunity({ ...tender, procurement_method: { title: method }, procurement_category: { title: category } }).type;
    expect(type("Request for Proposals")).toBe("rfp");
    expect(type("Expression of Interest")).toBe("eoi");
    expect(type("Framework Agreements")).toBe("framework");
    expect(type("Open Tender", "Consultancy Services")).toBe("consultancy");
  });
});

describe("World Bank adapter", () => {
  it("normalises a notice and keeps the notice language", () => {
    const o = ScrapedOpportunitySchema.parse(
      wbToOpportunity({
        id: "OP00474363",
        notice_type: "Request for Expression of Interest",
        notice_lang_name: "English",
        noticedate: "10-Oct-2026",
        submission_deadline_date: "2026-10-27T00:00:00Z",
        submission_deadline_time: "11:00",
        project_ctry_name: "Uganda",
        project_name: "Uganda Digital Acceleration Project - GovNet",
        bid_description: "Consultancy for cloud security architecture review",
        procurement_group: "CS",
        procurement_method_name: "Quality And Cost-Based Selection",
        contact_organization: "National Information and Technology Authority - Uganda",
        notice_text: "<p><b>Scope:</b> cloud security</p>",
      }),
    );
    expect(o).toMatchObject({ type: "eoi", category: "Consulting Services", country: "Uganda", deadline: "2026-10-26T21:00:00.000Z" });
    expect(o.meta.deadlineTime).toBe("11:00");
    expect(o.meta.language).toBe("en");
    expect(o.url).toBe("https://projects.worldbank.org/en/projects-operations/procurement-detail/OP00474363");
    expect(o.description).toContain("Scope: cloud security");
  });
});

describe("feeds", () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>
    <item><title>SPN - Somalia - Supply and Installation of ICT and Network Equipment - ISEGP</title>
      <link>https://www.afdb.org/en/documents/spn-somalia-ict</link><guid>g1</guid>
      <description>&lt;p&gt;Notice&lt;/p&gt;</description><pubDate>Fri, 09 Oct 2026 12:53:31 +0000</pubDate></item>
    <item><title>AOI - RCA - Acquisition d&amp;#039;outils - PMIRE</title><link>https://www.afdb.org/x</link><guid>g2</guid></item>
    <item><title>PPM - Sierra Leone - Rural Electrification Plan (Simplified)</title><link>https://www.afdb.org/ppm</link><guid>g3</guid></item>
    <item><title>Contract Awards - Consulting Services for NAFAD</title><link>https://www.afdb.org/ca</link><guid>g4</guid></item>
  </channel></rss>`;

  it("parses RSS and decodes double-encoded entities", () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(4);
    expect(items[1]!.title).toBe("AOI - RCA - Acquisition d'outils - PMIRE");
    expect(items[0]!.publishedAt).toBe("2026-10-09T12:53:31.000Z");
    expect(items[0]!.description).toBe("Notice");
    expect(decodeEntities("R&amp;amp;D")).toBe("R&D");
  });

  it("parses Atom feeds", () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>a1</id><title>Grant call</title>
      <link rel="alternate" href="https://example.org/grant"/><updated>2026-10-01T00:00:00Z</updated><summary>Deadline: 30 November 2026</summary></entry></feed>`;
    const [item] = parseFeed(atom);
    expect(item).toMatchObject({ title: "Grant call", link: "https://example.org/grant" });
    expect(extractDeadline(item!.description)).toBe("2026-11-29T21:00:00.000Z");
  });

  it("maps AfDB notices and skips procurement plans and awards", () => {
    const mapped = parseFeed(rss).map(afdbToOpportunity);
    expect(mapped[0]).toMatchObject({ type: "tender", country: "Somalia", title: "Supply and Installation of ICT and Network Equipment" });
    expect(mapped[1]).toMatchObject({ type: "tender", country: "Central African Republic" });
    expect(mapped[2]).toBeNull();
    expect(mapped[3]).toBeNull();
  });
});

describe("feed type inference", () => {
  it("lets notice titles override a feed's default type", async () => {
    const { inferType } = await import("../src/sources/feed.js");
    expect(inferType("Expression of Interest: Procurement of a Loans Management System", "other")).toBe("eoi");
    expect(inferType("Request for Proposals – Website Redesign", "consultancy")).toBe("rfp");
    expect(inferType("RFQ for ERP licences", "other")).toBe("rfq");
    expect(inferType("Full Stack Development Consultant", "consultancy")).toBe("consultancy");
    expect(inferType("Attendance tenderness study", "other")).toBe("other"); // whole words only
  });
});

describe("schema safety", () => {
  it("rejects non-web URLs that would become dangerous hrefs", () => {
    const base = { source: "x", externalId: "1", title: "ICT support services" };
    expect(ScrapedOpportunitySchema.safeParse({ ...base, url: "javascript:alert(1)" }).success).toBe(false);
    expect(ScrapedOpportunitySchema.safeParse({ ...base, url: "https://ok.example.org", documents: [{ name: "x", url: "data:text/html,hi" }] }).success).toBe(false);
    expect(ScrapedOpportunitySchema.safeParse({ ...base, url: "https://ok.example.org" }).success).toBe(true);
  });
});

describe("generic HTML listing adapter", () => {
  it("extracts rows using configured selectors", () => {
    const html = `<table class="tenders"><tbody>
      <tr><td>REF/1</td><td><a href="/t/1">ICT support services</a></td><td>x</td><td>30/11/2026</td></tr>
      <tr><td>REF/2</td><td>No link here</td><td>x</td><td>-</td></tr>
    </tbody></table>`;
    const rows = [
      ...extractListing(html, {
        id: "demo",
        name: "Demo",
        url: "https://buyer.example.org/tenders",
        enabled: true,
        type: "tender",
        country: "Kenya",
        selectors: { item: "table.tenders tbody tr", title: "td:nth-child(2)", link: "td:nth-child(2) a@href", deadline: "td:nth-child(4)", reference: "td:nth-child(1)", buyer: "", description: "", published: "" },
      }),
    ];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ url: "https://buyer.example.org/t/1", title: "ICT support services", referenceNo: "REF/1", deadline: "2026-11-29T21:00:00.000Z" });
  });
});
