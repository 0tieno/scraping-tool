import { useMemo, useState } from "react";
import { api, downloadCsv, type ListParams } from "../api";
import { Due, Empty, Icon, ScoreRing, SkeletonRows, TierPill, useToast } from "../components/ui";
import { humanizeCapability, sourceLabel, STATUS_LABELS, TIERS, TIER_LABELS, TYPE_LABELS } from "../format";
import { useAsync, useDebounced } from "../hooks";
import type { Meta, Opportunity, Tier } from "../types";

const PAGE_SIZE = 40;
type View = "open" | "pipeline" | "all";

export function RadarPage({ meta }: { meta: Meta }) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [tiers, setTiers] = useState<Tier[]>(["hot", "warm"]);
  const [source, setSource] = useState("");
  const [type, setType] = useState("");
  const [view, setView] = useState<View>("open");
  const [sort, setSort] = useState<NonNullable<ListParams["sort"]>>("score");
  const [page, setPage] = useState(0);
  const debouncedQ = useDebounced(q);

  const params: ListParams = useMemo(
    () => ({
      q: debouncedQ || undefined,
      tier: tiers,
      source: source ? [source] : undefined,
      type: type ? [type] : undefined,
      status: view === "open" ? ["new", "shortlisted"] : view === "pipeline" ? ["shortlisted", "in_proposal", "submitted"] : undefined,
      includeExpired: view === "all",
      sort,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [debouncedQ, tiers, source, type, view, sort, page],
  );

  const stats = useAsync(() => api.stats(), []);
  const list = useAsync(() => api.list(params), [params]);
  const sources = Object.keys(stats.data?.bySource ?? {}).sort();

  const toggleTier = (t: Tier) => {
    setPage(0);
    setTiers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  };
  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setPage(0);
    setter(v);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Opportunity radar</h1>
          <div className="page-sub">Organisations looking for software to be built and maintained, ranked by fit for {meta.company}.</div>
        </div>
        <button className="btn" onClick={() => downloadCsv({ ...params, limit: 500, offset: 0 }).catch(() => toast("Export failed"))}>
          <Icon name="download" /> Export CSV
        </button>
      </div>

      <div className="kpis">
        <Kpi label="Hot matches open" value={stats.data?.hotOpen} hint="Score 70+ and still open" accent />
        <Kpi label="New in last 24h" value={stats.data?.newLast24h} hint="Across all sources" />
        <Kpi label="Relevant, closing ≤ 7 days" value={stats.data?.closingThisWeek} hint="Score 50+, act now" />
        <Kpi label="Open opportunities" value={stats.data?.open} hint="Not dismissed" />
      </div>

      <div className="card">
        <div className="filters">
          <label className="search">
            <Icon name="search" />
            <input
              className="input"
              placeholder="Search titles, buyers, descriptions…"
              value={q}
              onChange={(e) => reset(setQ)(e.target.value)}
              aria-label="Search opportunities"
            />
          </label>
          <div className="seg" role="tablist" aria-label="View">
            {(["open", "pipeline", "all"] as View[]).map((v) => (
              <button key={v} className={view === v ? "on" : ""} onClick={() => reset(setView)(v)}>
                {v === "open" ? "To triage" : v === "pipeline" ? "In pipeline" : "Everything"}
              </button>
            ))}
          </div>
          <div className="row">
            {TIERS.map((t) => (
              <button key={t} className={`chip-toggle${tiers.includes(t) ? " on" : ""}`} onClick={() => toggleTier(t)} aria-pressed={tiers.includes(t)}>
                {TIER_LABELS[t]} <span className="muted">{stats.data?.byTier[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <select className="select" value={source} onChange={(e) => reset(setSource)(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
          <select className="select" value={type} onChange={(e) => reset(setType)(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <div className="spacer" />
          <select className="select" value={sort} onChange={(e) => reset(setSort)(e.target.value as typeof sort)} aria-label="Sort">
            <option value="score">Best match</option>
            <option value="deadline">Closing soonest</option>
            <option value="newest">Newest</option>
          </select>
        </div>

        {list.error && <div className="alert" style={{ margin: 16 }}>{list.error.message}</div>}
        {list.loading && !list.data ? (
          <SkeletonRows />
        ) : list.data && list.data.items.length ? (
          <div className="opp-list" style={{ opacity: list.loading ? 0.6 : 1, transition: "opacity .15s" }}>
            {list.data.items.map((o) => (
              <OpportunityRow key={o.id} o={o} meta={meta} />
            ))}
          </div>
        ) : (
          <Empty title="No opportunities match these filters">
            Widen the tiers, switch to <b>Everything</b>, or run a scrape from the Sources page.
          </Empty>
        )}

        {list.data && list.data.total > PAGE_SIZE && (
          <div className="pager">
            <span>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, list.data.total)} of {list.data.total}
            </span>
            <div className="row">
              <button className="btn sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <button className="btn sm" disabled={(page + 1) * PAGE_SIZE >= list.data.total} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function Kpi({ label, value, hint, accent }: { label: string; value: number | undefined; hint: string; accent?: boolean }) {
  return (
    <div className={`card kpi${accent ? " accent" : ""}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value ?? <span className="skeleton" style={{ display: "inline-block", width: 48, height: 26 }} />}</div>
      <div className="kpi-hint">{hint}</div>
    </div>
  );
}

function OpportunityRow({ o, meta }: { o: Opportunity; meta: Meta }) {
  return (
    <a className="opp" href={`#/opportunity/${o.id}`}>
      <ScoreRing score={o.score} tier={o.tier} />
      <div style={{ minWidth: 0 }}>
        <div className="opp-title">{o.title}</div>
        <div className="opp-meta">
          <span>{o.buyer ?? o.breakdown.buyerSegment ?? sourceLabel(o.source)}</span>
          {o.country && (
            <>
              <span className="sep">•</span>
              <span>{o.country}</span>
            </>
          )}
          <span className="sep">•</span>
          <span>{TYPE_LABELS[o.type]}</span>
          <span className="sep">•</span>
          <span className="muted">{sourceLabel(o.source)}</span>
        </div>
        <div className="opp-tags">
          {o.breakdown.capabilities.slice(0, 3).map((c) => (
            <span className="chip" key={c}>
              {humanizeCapability(c, meta.capabilities)}
            </span>
          ))}
          {o.status !== "new" && <span className="pill brand">{STATUS_LABELS[o.status]}</span>}
        </div>
      </div>
      <div className="opp-side">
        <Due deadline={o.deadline} />
        <TierPill tier={o.tier} />
        {o.hasAnalysis && (
          <span className="ai-mark">
            <Icon name="spark" size={13} /> AI brief
          </span>
        )}
      </div>
    </a>
  );
}
