import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { Due, Empty, Icon, ScoreRing, Spinner, TierPill, useToast } from "../components/ui";
import { formatDate, humanizeCapability, relativeTime, sourceLabel, STATUSES, STATUS_LABELS, TYPE_LABELS } from "../format";
import { useAsync } from "../hooks";
import type { Analysis, Meta, Opportunity, PipelineStatus } from "../types";

export function OpportunityDetailPage({ id, meta }: { id: string; meta: Meta }) {
  const detail = useAsync(() => api.get(id), [id]);

  if (detail.error) {
    return (
      <Empty title={detail.error instanceof ApiError && detail.error.status === 404 ? "Opportunity not found" : "Could not load opportunity"}>
        <a href="#/">Back to the radar</a>
      </Empty>
    );
  }
  if (!detail.data) {
    return (
      <div className="stack">
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 300 }} />
      </div>
    );
  }

  const { opportunity: o, analysis, activity } = detail.data;
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="btn ghost sm" onClick={() => history.back()}>
          <Icon name="back" /> Back
        </button>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className="card card-pad">
            <div className="detail-hero">
              <ScoreRing score={o.score} tier={o.tier} large />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <TierPill tier={o.tier} />
                  <span className="pill">{TYPE_LABELS[o.type]}</span>
                  {o.category && <span className="pill">{o.category}</span>}
                  {o.meta.agpo === true && <span className="pill warn">AGPO reserved</span>}
                </div>
                <h1 className="detail-title">{o.title}</h1>
                <div className="page-sub">{o.buyer ?? "Buyer not stated"}</div>
              </div>
            </div>
            <div className="facts" style={{ marginTop: 20 }}>
              <Fact label="Deadline" value={<><div>{formatDate(o.deadline, true)}</div><Due deadline={o.deadline} /></>} />
              <Fact label="Country" value={o.country ?? "—"} />
              <Fact label="Reference" value={o.referenceNo ? <span className="mono">{o.referenceNo}</span> : "—"} />
              <Fact label="Published" value={formatDate(o.publishedAt)} />
              <Fact label="Source" value={sourceLabel(o.source)} />
              <Fact label="First seen" value={relativeTime(o.firstSeenAt)} />
            </div>
            <div className="row" style={{ marginTop: 18 }}>
              <a className="btn primary" href={o.url} target="_blank" rel="noopener noreferrer">
                Open original notice <Icon name="external" size={14} />
              </a>
            </div>
          </div>

          <AnalysisCard opportunity={o} initial={analysis} meta={meta} onDone={detail.reload} />

          {o.description && (
            <div className="card">
              <div className="card-head">
                <div className="card-title">Notice text</div>
              </div>
              <div className="card-pad description">{o.description}</div>
            </div>
          )}

          {o.documents.length > 0 && (
            <div className="card card-pad">
              <div className="section-label">Documents</div>
              <div className="docs">
                {o.documents.map((d) => (
                  <a className="doc" key={d.url} href={d.url} target="_blank" rel="noopener noreferrer">
                    <Icon name="file" /> <span style={{ flex: 1 }}>{d.name}</span> <Icon name="external" size={13} />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="stack">
          <PipelineCard o={o} onSaved={detail.reload} />
          <ScoreCard o={o} meta={meta} />
          <div className="card card-pad">
            <div className="section-label">Activity</div>
            {activity.length ? (
              <ul className="timeline">
                {activity.map((a, i) => (
                  <li key={i}>
                    <div>
                      <div>{a.detail ?? a.action}</div>
                      <div className="muted small">
                        {relativeTime(a.at)}
                        {a.actor ? ` · ${a.actor}` : ""}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="muted small">No activity yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="fact-label">{label}</div>
      <div className="fact-value">{value}</div>
    </div>
  );
}

function ScoreCard({ o, meta }: { o: Opportunity; meta: Meta }) {
  const b = o.breakdown;
  const rows: [string, number, number][] = [
    ["Software fit", b.capability, 50],
    ["Buyer fit", b.buyer, 17],
    ["Geography", b.geography, 12],
    ["Supporting skills", b.secondary, 8],
    ["Type & category", b.opportunityType, 8],
    ["Deadline", b.deadline, 5],
  ];
  return (
    <div className="card card-pad">
      <div className="section-label">Why this score</div>
      <div className="bars">
        {rows.map(([label, v, max]) => (
          <div className="bar-row" key={label}>
            <span className="muted">{label}</span>
            <div className="bar">
              <i style={{ width: `${Math.min(100, (v / max) * 100)}%` }} />
            </div>
            <b>{Math.round(v)}</b>
          </div>
        ))}
        {b.penalty > 0 && (
          <div className="bar-row">
            <span className="muted">Penalties</span>
            <div className="bar neg">
              <i style={{ width: `${Math.min(100, (b.penalty / 60) * 100)}%` }} />
            </div>
            <b>−{Math.round(b.penalty)}</b>
          </div>
        )}
      </div>
      <ul className="reasons" style={{ marginTop: 14 }}>
        {b.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {b.capabilities.length > 0 && (
        <div className="opp-tags" style={{ marginTop: 12 }}>
          {b.capabilities.map((c) => (
            <span className="chip" key={c}>
              {humanizeCapability(c, meta.capabilities)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({ o, onSaved }: { o: Opportunity; onSaved: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<PipelineStatus>(o.status);
  const [owner, setOwner] = useState(o.owner ?? "");
  const [notes, setNotes] = useState(o.notes);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setStatus(o.status);
    setOwner(o.owner ?? "");
    setNotes(o.notes);
  }, [o]);

  const dirty = status !== o.status || owner !== (o.owner ?? "") || notes !== o.notes;
  const save = async () => {
    setSaving(true);
    try {
      await api.update(o.id, { status, owner: owner.trim() || null, notes });
      toast("Saved");
      onSaved();
    } catch (e) {
      toast(`Save failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad stack" style={{ gap: 12 }}>
      <div className="section-label" style={{ margin: 0 }}>Pipeline</div>
      <label className="stack" style={{ gap: 4 }}>
        <span className="fact-label">Status</span>
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as PipelineStatus)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="fact-label">Owner</span>
        <input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Who is leading this bid?" maxLength={120} />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="fact-label">Notes</span>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Partners, eligibility checks, pricing thoughts…" />
      </label>
      <div className="row">
        <button className="btn primary" disabled={!dirty || saving} onClick={save}>
          {saving ? <Spinner /> : null} Save
        </button>
        {o.status === "new" && !dirty && (
          <>
            <button className="btn" disabled={saving} onClick={() => quick("shortlisted")}>
              Shortlist
            </button>
            <button className="btn ghost danger" disabled={saving} onClick={() => quick("dismissed")}>
              Dismiss
            </button>
          </>
        )}
      </div>
    </div>
  );

  async function quick(next: PipelineStatus) {
    setSaving(true);
    try {
      await api.update(o.id, { status: next });
      toast(next === "dismissed" ? "Dismissed" : "Added to shortlist");
      onSaved();
    } catch (e) {
      toast(`Update failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }
}

function AnalysisCard({ opportunity, initial, meta, onDone }: { opportunity: Opportunity; initial: Analysis | null; meta: Meta; onDone: () => void }) {
  const toast = useToast();
  const [analysis, setAnalysis] = useState(initial);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setAnalysis(initial), [initial]);

  const run = async () => {
    setRunning(true);
    setError(null);
    try {
      setAnalysis(await api.analyze(opportunity.id));
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const copyOutline = async () => {
    if (!analysis) return;
    const md = [
      `# Proposal: ${opportunity.title}`,
      `Buyer: ${opportunity.buyer ?? "—"} · Deadline: ${formatDate(opportunity.deadline, true)}`,
      "",
      "## Win themes",
      ...analysis.winThemes.map((t) => `- ${t}`),
      "",
      ...analysis.proposalOutline.flatMap((s, i) => [`## ${i + 1}. ${s.section}`, ...s.keyPoints.map((p) => `- ${p}`), ""]),
      "## Team",
      ...analysis.suggestedTeam.map((t) => `- ${t}`),
    ].join("\n");
    try {
      await navigator.clipboard.writeText(md);
      toast("Proposal outline copied as Markdown");
    } catch {
      toast("Clipboard unavailable");
    }
  };

  if (!analysis) {
    return (
      <div className="card card-pad ai-panel">
        <div className="row">
          <Icon name="spark" size={18} />
          <div style={{ flex: 1 }}>
            <div className="card-title">AI bid brief</div>
            <div className="muted small">
              {meta.aiEnabled
                ? "Get a bid/no-bid verdict, eligibility checklist, risks, win themes and a proposal outline."
                : "Set ANTHROPIC_API_KEY on the server to enable AI bid briefs."}
            </div>
          </div>
          <button className="btn primary" disabled={!meta.aiEnabled || running} onClick={run}>
            {running ? <><Spinner /> Analysing…</> : "Generate brief"}
          </button>
        </div>
        {running && <div className="muted small" style={{ marginTop: 10 }}>This usually takes 20–60 seconds.</div>}
        {error && <div className="alert" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    );
  }

  return (
    <div className="card ai-panel">
      <div className="card-head">
        <div className="ai-head">
          <span className={`verdict ${analysis.recommendation}`}>{analysis.recommendation}</span>
          <div>
            <div className="card-title">AI bid brief · fit {analysis.fitScore}/100</div>
            <div className="muted small">
              {analysis.model} · {relativeTime(analysis.createdAt)} · prep effort {analysis.effortEstimate}
            </div>
          </div>
        </div>
        <div className="row">
          <button className="btn sm" onClick={copyOutline}>
            <Icon name="copy" size={14} /> Copy outline
          </button>
          <button className="btn sm ghost" disabled={running || !meta.aiEnabled} onClick={run} title="Re-run analysis">
            {running ? <Spinner /> : <Icon name="refresh" size={14} />}
          </button>
        </div>
      </div>
      <div className="card-pad stack">
        {error && <div className="alert">{error}</div>}
        <p style={{ margin: 0 }}>{analysis.summary}</p>
        <div className="ai-cols">
          <ListBlock title="Why Kipeo" items={analysis.whyKipeo} />
          <ListBlock title="Gaps to close" items={analysis.gaps} />
          <ListBlock title="Eligibility checks" items={analysis.eligibilityChecks} />
          <ListBlock title="Risks" items={analysis.risks} />
          <ListBlock title="Win themes" items={analysis.winThemes} />
          <ListBlock title="Questions for the buyer" items={analysis.clarificationQuestions} />
        </div>
        <div>
          <div className="section-label">Proposal outline</div>
          <div className="outline">
            {analysis.proposalOutline.map((s) => (
              <div className="outline-sec" key={s.section}>
                <h4>{s.section}</h4>
                <ul>
                  {s.keyPoints.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        {analysis.suggestedTeam.length > 0 && (
          <div>
            <div className="section-label">Suggested team</div>
            <div className="opp-tags">
              {analysis.suggestedTeam.map((t) => (
                <span className="chip neutral" key={t}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="section-label">{title}</div>
      <ul className="ai-list">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}
