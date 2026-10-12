// Ad-hoc scoring probe: npx tsx scripts/score.ts "Title" [country] [language]
import { loadConfig } from "../src/config/loader.js";
import { RelevanceScorer } from "../src/scoring/relevance.js";

const [title = "", country = "Kenya", language] = process.argv.slice(2);
const scorer = new RelevanceScorer(loadConfig("config").profile);
const deadline = new Date(Date.now() + 21 * 86_400_000).toISOString();
const r = scorer.score({ title, description: "", buyer: null, country, type: "tender", category: null, deadline, meta: language ? { language } : {} });
console.log(r.score, r.tier, r.breakdown);
