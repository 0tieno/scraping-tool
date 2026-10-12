# Kipeo Opportunity Radar

Opportunity intelligence for **Kipeo Afrika**. The radar finds organisations that will **pay Kipeo to build software for them and then maintain it**: SACCOs and microfinance institutions, schools, hospitals, NGOs, SMEs and county bodies. It reads their tenders, RFPs, EOIs and consultancy calls across Kenya and Africa. It scores each one against Kipeo's service lines and gives the bid team a triage dashboard, a bid pipeline and AI-written bid/no-bid briefs with proposal outlines.

```
 Sources ──► Polite HTTP client ──► Adapters ──► Validate ──► Score ──► SQLite (+FTS)
 (APIs, RSS,   robots.txt, crawl-delay,  normalise   zod schema   explainable   │
  HTML pages)  per-host throttle, retries                         0–100 score    ├─► Dashboard & REST API
                                                                                  ├─► Claude bid briefs (optional)
                                                                                  └─► Email / Slack digests (optional)
```

## What you get

- **Radar dashboard**: every open opportunity ranked by fit, with search, filters by tier, source and type, deadline countdowns and CSV export.
- **Explainable scoring**: each score breaks down into capability, sector, geography, type and deadline points, plus penalties, and states the reasons ("Cybersecurity: penetration testing, ISO 27001 · Location: Kenya · Closes in 12 days").
- **Bid pipeline**: drag-and-drop board (Shortlisted → In proposal → Submitted → Won/Lost) with owners, notes and a full activity log.
- **AI bid briefs** (Claude): a bid / consider / pass verdict, why Kipeo fits, gaps, eligibility checks (AGPO, KRA, ICTA…), risks, questions for the buyer, win themes, a section-by-section proposal outline and a suggested team. One click copies the outline as Markdown.
- **Change detection**: deadline extensions and notice edits at the source are detected and logged.
- **Scheduling and digests**: scrapes twice daily by default and sends a weekday-morning digest of new relevant opportunities by email and/or Slack.

## Quick start

Requires **Node.js 22.13+**. No database server is needed; it uses Node's built-in SQLite.

```bash
npm install
npm --prefix web install
cp .env.example .env          # optional: add ANTHROPIC_API_KEY, SMTP/Slack, DASHBOARD_TOKEN
npm run build
npm run scrape                # first harvest (~1 minute)
npm start                     # dashboard at http://localhost:8080
```

For development, run `npm run dev` (API with reload) together with `npm run dev:web` (Vite at http://localhost:5173, proxied to the API).

### Docker

```bash
cp .env.example .env
docker compose up -d --build
docker compose exec radar node dist/cli.js scrape
```

Data persists in the `radar-data` volume. `config/` is mounted read-only, so you can edit the YAML and click **Settings → Reload config & rescore** without rebuilding.

## Sources

| Source | Method | Status | Notes |
|---|---|---|---|
| **Kenya PPIP** (tenders.go.ke) | JSON API | ✅ On | Every active national and county tender (~570 at a time). The API intermittently returns `200 {"message":"Server Error"}`; this is retried automatically. |
| **NGO Jobs in Africa** (4 feeds) | RSS | ✅ On | Where NGOs, MFIs and faith-based organisations post system EOIs, RFPs and developer consultancies. Each feed returns only the latest 10 items, so scrapes run every 3 hours by default. Staff jobs are scored down, but software hiring is flagged as a possible outsourcing lead. |
| **World Bank** procurement notices | JSON API | ⏸ Off | Mostly large government, regional and policy work rather than software clients. Enable it to watch for occasional system builds. |
| **fundsforNGOs** | RSS | ⏸ Off | Grant calls are funding *for* NGOs, not clients paying Kipeo. |
| **AfDB** project procurement | RSS | ⏸ Off | As of Oct 2026, AfDB's Cloudflare challenges automated HTTP clients. The radar does not bypass bot protection. Enable it if AfDB allow-lists you. |
| **ReliefWeb** consultancies | JSON API | ⏸ Off | Needs an approved appname. Request one at <https://apidoc.reliefweb.int/parameters#appname> and set `RELIEFWEB_APPNAME`. |
| Your own feeds and pages | RSS / CSS selectors | Config | Add entries under `feeds:` or `pages:` in `config/sources.yaml`; no code needed. |

**Considered and excluded:**
- **TenderSoko** and **TendersKenya**: their terms of service prohibit scraping. Subscribe to their email alerts instead; they carry many private-sector and NGO tenders.
- **BidDetail**: its terms limit use to personal purposes.
- **UNDP procurement notices**: their robots.txt disallows all crawlers.
- **UNGM**: rejects scripted searches.

For both, use the portals' own email alerts.

### Adding a source

1. **RSS/Atom feed**: add to `feeds:` with an `id`, `url` and default `type`.
2. **Simple listing page**: add to `pages:` with CSS selectors (`"td a@href"` reads an attribute). See the disabled example in `config/sources.yaml`.
3. **API or complex site**: write an adapter in `src/sources/` that yields `ScrapedOpportunityInput` objects, register it in `src/sources/registry.ts`, and add a test with a fixture in `test/sources.test.ts`. Validation, de-duplication, scoring, persistence and run tracking are handled by the pipeline.

## How scoring works

`config/profile.yaml` is the single source of truth. Every score answers one question: **will an organisation pay Kipeo to build or maintain software?**

| Dimension | Max | Signal |
|---|---|---|
| Software fit | 50 | Build or maintain terms ("loans management system", "web portal", "support and maintenance of the system", ERP/MIS/LMS…). Title hits weigh about 4× description hits. Generic words alone ("system", "digital") are damped and capped. |
| Buyer fit | 17 | SACCOs/MFIs, schools, hospitals, NGOs and SMEs 1.0 → county bodies 0.85 → national government 0.6 → multilateral/regional programmes 0.15. The most specific match wins, so "African Union Commission" counts as multilateral, not as a commission. |
| Geography | 12 | Kenya 1.0, then East Africa or remote 0.6, rest of Africa 0.3, outside Africa 0 |
| Supporting skills | 8 | Cloud, security, data and training. These help a bid but never carry one alone. |
| Type & category | 8 | RFP > RFQ/EOI > tender > consultancy. Goods ×0.5, works ×0, grants 0. |
| Deadline | 5 | Full points at 10+ days; a penalty under 3 days |
| Penalties | − | Title-based: hardware supply (−30), policy/strategy/study work (−25), staff jobs and individual posts (−45), grants and competitions (−45), construction and unrelated services (−30), non-English notices (−15). Hardware, policy and out-of-lane penalties are waived when the title names a software system, e.g. "Supply and installation of an ERP system". |

The tiers are **Hot** (70+), **Warm** (50+), **Cool** (30+) and **Cold**. A notice with no build or maintain signal is capped at 25, and one with only generic software words at 35.

To tune the scoring, edit the profile, then reload from Settings or run `npm run cli -- rescore`. To see how a single title scores:

```bash
npm run score -- "Development of a loans management system for Stima SACCO" Kenya
```

## AI bid briefs

Set `ANTHROPIC_API_KEY`. Briefs use **Claude Opus 5.5** (`AI_MODEL`) with structured outputs, so every brief matches a typed schema. Kipeo's profile sits in a prompt-cached system prompt, so repeat analyses mostly pay only for the notice text. Server-side refusal fallback (`fallbacks: "default"`) is enabled: if the primary model declines a request, the API retries it on a suitable fallback model.

- **On demand**: click **Generate brief** on any opportunity.
- **Automatically**: after each scrape, the top unanalysed opportunities scoring at least `AI_AUTO_ANALYZE_MIN_SCORE` are analysed, up to `AI_MAX_AUTO_ANALYSES_PER_RUN` per run. Set the minimum score to `0` to disable this.
- Notice text is treated as untrusted data. The prompt tells the model to ignore any instructions inside it.

Briefs are decision support. Always read the tender documents before bidding.

## Operations

```bash
npm run cli -- scrape [source...]   # e.g. scrape ppip-kenya world-bank
npm run cli -- top --limit=20       # best open matches in the terminal
npm run cli -- analyze <id>         # one AI brief;  analyze --top  for the queue
npm run cli -- digest --hours=24    # send the digest now
npm run cli -- sources              # source status
npm run cli -- rescore              # reload config and recompute all scores
```

| Variable | Purpose |
|---|---|
| `DASHBOARD_TOKEN` | Bearer token for the API and dashboard. **Set this before exposing the radar beyond localhost.** |
| `SCRAPE_CRON` / `DIGEST_CRON` | Schedules (default: scrape every 3 hours from 06:00 to 21:00, digest 07:30 Mon–Fri, `Africa/Nairobi`) |
| `SCRAPER_MIN_DELAY_MS` | Minimum gap between requests to the same host (a site's crawl-delay wins if it is larger) |
| `DIGEST_MIN_SCORE` | Minimum score for the digest |
| `SLACK_WEBHOOK_URL`, `SMTP_*`, `DIGEST_TO` | Digest channels |

`GET /api/health` is unauthenticated, for uptime checks and the Docker healthcheck.

## Responsible scraping

The crawler identifies itself honestly (`KipeoOpportunityRadar/1.0 (+https://kipeoafrika.com; partnership@kipeoafrika.com)`).

- It obeys robots.txt (RFC 9309), including Crawl-delay.
- It throttles each host and backs off on 429 and 5xx responses, honouring `Retry-After`.
- It **never bypasses bot challenges or logins**. Blocked sources are reported on the Sources page.

Only fields needed for bidding are stored. Account metadata that some APIs expose, such as officials' personal phone numbers, is dropped when the data is parsed.

## Project layout

```
config/             profile.yaml (scoring) · sources.yaml (sources)
src/
  core/             http client (robots, throttling, retries), dates, text, language, types
  sources/          one adapter per source + generic RSS and CSS-selector adapters
  scoring/          explainable relevance scorer
  pipeline/         scrape orchestration, run tracking, auto-analysis
  ai/               Claude bid-brief analyst
  db/               SQLite schema migrations + repository (FTS5 search)
  notify/           email/Slack digests
  server/           Fastify REST API + static dashboard
  app.ts, cli.ts    composition root and CLI/scheduler
web/                React + Vite dashboard
test/               Vitest suites (parsers, robots, HTTP retry, scoring, adapters, repository, AI request shape)
```

Quality gates: `npm run typecheck && npm run lint && npm test` run in CI (`.github/workflows/ci.yml`).
