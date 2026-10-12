import { beforeEach, describe, expect, it } from "vitest";
import { ScrapedOpportunitySchema, type RelevanceScore } from "../src/core/types.js";
import { openDatabase } from "../src/db/database.js";
import { Repository, toFtsQuery } from "../src/db/repository.js";
import { toCsv } from "../src/server/http.js";

const rel = (score: number): RelevanceScore => ({
  score,
  tier: score >= 70 ? "hot" : score >= 50 ? "warm" : score >= 30 ? "cool" : "cold",
  breakdown: { capability: 0, secondary: 0, buyer: 0, geography: 0, opportunityType: 0, deadline: 0, penalty: 0, capabilities: [], buyerSegment: null, matchedTerms: [], penalties: [], reasons: [] },
});

const make = (over: Record<string, unknown> = {}) =>
  ScrapedOpportunitySchema.parse({
    source: "ppip-kenya",
    externalId: "1",
    url: "https://tenders.go.ke/tenders/1",
    title: "Penetration testing of core banking system",
    description: "Security assessment for a SACCO",
    buyer: "Stima SACCO",
    country: "Kenya",
    type: "tender",
    deadline: "2026-12-01T00:00:00.000Z",
    ...over,
  });

describe("Repository", () => {
  let repo: Repository;
  const now = new Date("2026-10-12T00:00:00Z");

  beforeEach(() => {
    repo = new Repository(openDatabase(":memory:"));
  });

  it("creates, then recognises unchanged and updated notices", () => {
    expect(repo.upsertOpportunity(make(), rel(80), "v1", now).outcome).toBe("created");
    expect(repo.upsertOpportunity(make(), rel(80), "v1", now).outcome).toBe("unchanged");
    const { id, outcome } = repo.upsertOpportunity(make({ deadline: "2026-12-15T00:00:00.000Z" }), rel(82), "v1", now);
    expect(outcome).toBe("updated");
    const activity = repo.getActivity(id);
    expect(activity[0]?.detail).toMatch(/Deadline changed/);
    expect(repo.get(id)?.score).toBe(82);
  });

  it("filters, searches and hides expired opportunities by default", () => {
    repo.upsertOpportunity(make(), rel(80), "v1", now);
    repo.upsertOpportunity(make({ externalId: "2", title: "Supply of foodstuffs", description: "", buyer: "County" }), rel(10), "v1", now);
    repo.upsertOpportunity(make({ externalId: "3", title: "Cloud migration", deadline: "2026-01-01T00:00:00.000Z" }), rel(70), "v1", now);

    expect(repo.list({}, now).total).toBe(2);
    expect(repo.list({ includeExpired: true }, now).total).toBe(3);
    expect(repo.list({ minScore: 50 }, now).items.map((o) => o.title)).toEqual(["Penetration testing of core banking system"]);
    expect(repo.list({ q: "penetr" }, now).total).toBe(1); // prefix search
    expect(repo.list({ q: "sacco" }, now).total).toBe(1); // matches buyer
    expect(repo.list({ tier: ["cold"] }, now).total).toBe(1);
  });

  it("tracks pipeline changes in the activity log", () => {
    const { id } = repo.upsertOpportunity(make(), rel(80), "v1", now);
    const updated = repo.updatePipeline(id, { status: "shortlisted", owner: "Wanjiku", notes: "Partner with Verge" }, "ronney");
    expect(updated).toMatchObject({ status: "shortlisted", owner: "Wanjiku", notes: "Partner with Verge" });
    expect(repo.getActivity(id).map((a) => a.action).sort()).toEqual(["notes", "owner", "status"]);
    expect(repo.updatePipeline("missing", { status: "won" }, null)).toBeNull();
  });

  it("stores AI analyses and excludes analysed items from candidates", () => {
    const { id } = repo.upsertOpportunity(make(), rel(80), "v1", now);
    expect(repo.analysisCandidates(65, 10, now).map((o) => o.id)).toEqual([id]);
    repo.saveAnalysis(
      id,
      "claude-opus-5-5",
      { fitScore: 88, recommendation: "bid", summary: "s", whyKipeo: [], gaps: [], eligibilityChecks: [], risks: [], clarificationQuestions: [], winThemes: [], proposalOutline: [], suggestedTeam: [], effortEstimate: "2 days" },
      { input: 1000, output: 500 },
    );
    expect(repo.getAnalysis(id)?.recommendation).toBe("bid");
    expect(repo.get(id)?.hasAnalysis).toBe(true);
    expect(repo.analysisCandidates(65, 10, now)).toEqual([]);
  });

  it("detects the same listing arriving from another source", () => {
    repo.upsertOpportunity(make({ source: "ngojobs-it", url: "https://ngojobsinafrica.com/job/x/" }), rel(70), "v1", now);
    expect(repo.isDuplicateOfOtherSource("https://ngojobsinafrica.com/job/x/", "ngojobs-consultancy")).toBe(true);
    expect(repo.isDuplicateOfOtherSource("https://ngojobsinafrica.com/job/x/", "ngojobs-it")).toBe(false);
  });

  it("records scrape runs and recovers orphaned ones", () => {
    const runId = repo.startRun("ppip-kenya");
    repo.failOrphanedRuns();
    expect(repo.latestRuns()[0]).toMatchObject({ id: runId, status: "failed" });
  });
});

describe("search and export safety", () => {
  it("builds FTS queries that cannot inject operators", () => {
    expect(toFtsQuery('cloud" OR title:*')).toBe('"cloud"* AND "or"* AND "title"*');
    expect(toFtsQuery("!!")).toBe('""');
  });

  it("neutralises spreadsheet formulas in CSV exports", () => {
    const csv = toCsv([
      { score: 90, tier: "hot", status: "new", title: '=HYPERLINK("http://evil")', buyer: "A, B", country: null, type: "tender", deadline: null, referenceNo: null, source: "x", breakdown: { capabilities: [] }, owner: null, url: "https://x" } as never,
    ]);
    const row = csv.split("\r\n")[1]!;
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain('"A, B"');
  });
});
