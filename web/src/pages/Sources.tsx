import { api } from "../api";
import { Icon, Spinner, useToast } from "../components/ui";
import { formatDate, relativeTime, sourceLabel } from "../format";
import { useAsync, useInterval } from "../hooks";
import type { ScrapeRun, SourceStatus } from "../types";

export function SourcesPage() {
  const toast = useToast();
  const sources = useAsync(() => api.sources(), []);
  const runs = useAsync(() => api.runs(), []);
  const anyRunning = sources.data?.some((s) => s.running) ?? false;

  // Poll while a scrape is in flight so progress appears without a manual refresh.
  useInterval(() => {
    sources.reload();
    runs.reload();
  }, anyRunning ? 3000 : null);

  const start = async (ids?: string[]) => {
    try {
      await api.scrape(ids);
      toast(ids ? `Started ${sourceLabel(ids[0]!)}` : "Started all enabled sources");
      setTimeout(() => {
        sources.reload();
        runs.reload();
      }, 400);
    } catch (e) {
      toast(`Could not start: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Sources</h1>
          <div className="page-sub">
            Every source is fetched politely: robots.txt and crawl-delays are honoured, and bot challenges are reported, never bypassed.
          </div>
        </div>
        <button className="btn primary" onClick={() => start()} disabled={anyRunning}>
          {anyRunning ? <Spinner /> : <Icon name="play" size={14} />} Run all now
        </button>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Last run</th>
                <th>Open items</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(sources.data ?? []).map((s) => (
                <SourceRow key={s.id} s={s} onRun={() => start([s.id])} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Recent runs</div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Started</th>
                <th>Result</th>
                <th>Fetched</th>
                <th>New</th>
                <th>Updated</th>
                <th>Rejected</th>
              </tr>
            </thead>
            <tbody>
              {(runs.data ?? []).slice(0, 25).map((r) => (
                <tr key={r.id}>
                  <td>{sourceLabel(r.source)}</td>
                  <td className="nowrap">{formatDate(r.startedAt, true)}</td>
                  <td>
                    <RunPill run={r} />
                    {r.error && <div className="muted small" style={{ maxWidth: 420 }}>{r.error}</div>}
                  </td>
                  <td>{r.fetched}</td>
                  <td>{r.created}</td>
                  <td>{r.updated}</td>
                  <td>{r.rejected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function SourceRow({ s, onRun }: { s: SourceStatus; onRun: () => void }) {
  return (
    <tr>
      <td style={{ minWidth: 260 }}>
        <div style={{ fontWeight: 600 }}>
          <a href={s.homepage} target="_blank" rel="noopener noreferrer">
            {s.name}
          </a>{" "}
          <span className="pill">{s.kind.toUpperCase()}</span>
        </div>
        <div className="muted small">{s.description}</div>
      </td>
      <td>
        {s.running ? (
          <span className="pill warn">
            <span className="dot busy" />
            Running
          </span>
        ) : s.enabled ? (
          <span className="pill ok">Enabled</span>
        ) : (
          <span className="pill" title={s.disabledReason ?? undefined}>
            Disabled
          </span>
        )}
        {!s.enabled && s.disabledReason && <div className="muted small" style={{ maxWidth: 260 }}>{s.disabledReason}</div>}
      </td>
      <td className="nowrap">
        {s.lastRun ? (
          <>
            <RunPill run={s.lastRun} /> <span className="muted small">{relativeTime(s.lastRun.finishedAt ?? s.lastRun.startedAt)}</span>
          </>
        ) : (
          <span className="muted">Never</span>
        )}
      </td>
      <td>{s.openCount}</td>
      <td style={{ textAlign: "right" }}>
        <button className="btn sm" onClick={onRun} disabled={s.running || !s.enabled} title={s.enabled ? "Run this source now" : "Enable it in config/sources.yaml first"}>
          Run
        </button>
      </td>
    </tr>
  );
}

function RunPill({ run }: { run: ScrapeRun }) {
  const cls = run.status === "success" ? "ok" : run.status === "failed" ? "bad" : run.status === "partial" ? "warn" : "";
  return <span className={`pill ${cls}`}>{run.status}</span>;
}
