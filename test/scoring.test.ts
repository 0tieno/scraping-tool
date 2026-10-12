import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { RelevanceScorer, tierFor, type ScorableOpportunity } from "../src/scoring/relevance.js";

const { profile } = loadConfig("config");
const scorer = new RelevanceScorer(profile);
const now = new Date("2026-10-12T08:00:00Z");
const inDays = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();

function opp(partial: Partial<ScorableOpportunity>): ScorableOpportunity {
  return {
    title: "Untitled",
    description: "",
    buyer: null,
    country: "Kenya",
    type: "tender",
    category: null,
    deadline: inDays(21),
    meta: {},
    ...partial,
  };
}
const score = (partial: Partial<ScorableOpportunity>) => scorer.score(opp(partial), now);

describe("RelevanceScorer: Kipeo builds and maintains software for paying organisations", () => {
  describe("ranks ideal clients as hot", () => {
    it.each([
      ["Development of a Loans Management System", "Stima SACCO Society Ltd"],
      ["Supply, installation and commissioning of a school management system", "Moi Girls High School"],
      ["Provision of support and maintenance of the hospital management system", "Kijabe Mission Hospital"],
      ["Design and development of a membership portal and mobile app", "Kenya Association of Manufacturers"],
      ["Request for proposals: website redesign, hosting and maintenance", "World Vision Kenya Foundation"],
    ])("%s (%s)", (title, buyer) => {
      const r = score({ title, buyer, type: "rfp" });
      expect(r.tier).toBe("hot");
    });
  });

  it("explains core fit and buyer segment", () => {
    const r = score({ title: "Development of a SACCO management system", buyer: "Mwalimu SACCO" });
    expect(r.breakdown.capabilities[0]).toBe("software-build");
    expect(r.breakdown.buyerSegment).toBe("SACCOs & microfinance");
    expect(r.breakdown.reasons.join(" ")).toMatch(/Custom software development/);
  });

  describe("pushes down work that isn't Kipeo's business", () => {
    it.each([
      ["Supply and delivery of laptops, desktops and printers", "Kenyatta University", "hardware"],
      ["Supply, delivery and installation of Wi-Fi routers and network equipment", "ICT Authority", "hardware"],
      ["Consultancy to develop a national data governance policy framework", "Ministry of ICT", "policy"],
      ["ICT Officer", "UNHCR Kenya", "staff job"],
      ["Software Development Specialist (Fixed-Term)", "Save the Children", "staff job"],
      ["Call for proposals: Digital innovation grants for NGOs", null, "grant"],
      ["Construction of a tuition block", "Nakuru County Government", "works"],
    ])("%s → %s", (title, buyer, _why) => {
      const r = score({ title, buyer });
      expect(r.score).toBeLessThan(35);
    });
  });

  it("waives the hardware penalty when the title names a software system", () => {
    const erp = score({ title: "Supply, installation and commissioning of an ERP system", buyer: "Technical University of Kenya" });
    const laptops = score({ title: "Supply, installation and commissioning of laptops", buyer: "Technical University of Kenya" });
    expect(erp.breakdown.penalties).toEqual([]);
    expect(laptops.breakdown.penalties).toContain("Hardware / equipment supply");
    expect(erp.score - laptops.score).toBeGreaterThan(30);
  });

  it("flags in-house developer hiring as an outsourcing lead without ranking it as a bid", () => {
    const r = score({ title: "Systems Integration Coordinator", description: "Lead the design, development and deployment of project information systems; software development lifecycle." });
    expect(r.score).toBeLessThan(35);
    expect(r.breakdown.reasons.join(" ")).toMatch(/Hiring signal/);
  });

  it("caps notices that only use generic software words", () => {
    const r = score({ title: "Provision of building and maintenance works", buyer: "County Commissioner Marsabit" });
    expect(r.score).toBeLessThanOrEqual(35);
  });

  it("does not let cloud/security/training terms alone carry a notice", () => {
    const r = score({ title: "Cybersecurity awareness training for staff", buyer: "Equity Bank Limited" });
    expect(r.score).toBeLessThanOrEqual(25);
    expect(r.breakdown.reasons[0]).toMatch(/Not a software build/);
  });

  it("prefers small and mid-sized buyers over multilateral programmes", () => {
    const title = "Development of a monitoring and evaluation information system";
    const ngo = score({ title, buyer: "Amref Health Africa" });
    const au = score({ title, buyer: "African Union Commission" });
    expect(au.breakdown.buyerSegment).toBe("Multilateral & regional programmes"); // most specific term wins over "commission"
    expect(ngo.score - au.score).toBeGreaterThanOrEqual(12);
  });

  it("discounts capability words that only appear in procurement boilerplate", () => {
    const titleHit = score({ title: "Development of a web application for permits" });
    const bodyOnly = score({ title: "Provision of cleaning services", description: "Submit the application form via the website system." });
    expect(titleHit.score - bodyOnly.score).toBeGreaterThan(40);
  });

  it("penalises notices in another working language, even when mislabelled", () => {
    const en = score({ title: "Recruitment of a firm for the digitalisation of agency services", country: "Burundi" });
    const fr = score({ title: "Recrutement d'un cabinet pour la digitalisation des services de l'Agence", country: "Burundi", meta: { language: "fr" } });
    const mislabelled = score({ title: "Recrutement d'un cabinet pour la digitalisation des services de l'Agence", country: "Burundi", meta: { language: "en" } });
    expect(fr.breakdown.reasons.join(" ")).toMatch(/language: fr/);
    expect(mislabelled.score).toBe(fr.score);
    expect(en.score).toBeGreaterThan(fr.score);
  });

  it("prefers comfortable deadlines and flags impossible ones", () => {
    const base = { title: "Development of an online student portal" };
    const comfortable = score({ ...base, deadline: inDays(20) });
    const tight = score({ ...base, deadline: inDays(1) });
    expect(comfortable.score).toBeGreaterThan(tight.score);
    expect(tight.breakdown.reasons.join(" ")).toMatch(/too tight/);
  });

  it("weights geography by priority", () => {
    const title = "Design and development of a management information system";
    const kenya = score({ title, country: "Kenya" });
    const ghana = score({ title, country: "Ghana" });
    const asia = score({ title, country: "Philippines" });
    expect(kenya.score).toBeGreaterThan(ghana.score);
    expect(ghana.score).toBeGreaterThan(asia.score);
  });

  it("matches acronyms case-sensitively", () => {
    expect(score({ title: "Implementation of an ERP for the college" }).breakdown.matchedTerms).toContain("ERP");
    expect(score({ title: "Supply of stationery for the erp office" }).breakdown.matchedTerms).not.toContain("ERP");
  });

  it("maps scores to tiers", () => {
    expect([tierFor(85), tierFor(60), tierFor(40), tierFor(10)]).toEqual(["hot", "warm", "cool", "cold"]);
  });
});
