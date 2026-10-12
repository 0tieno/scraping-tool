import { useEffect, useState } from "react";
import { api, ApiError, session } from "./api";
import { BrandMark, Empty, Icon, Spinner } from "./components/ui";
import { useAsync, useInterval, useRoute } from "./hooks";
import { OpportunityDetailPage } from "./pages/OpportunityDetail";
import { PipelinePage } from "./pages/Pipeline";
import { RadarPage } from "./pages/Radar";
import { SettingsPage } from "./pages/Settings";
import { SourcesPage } from "./pages/Sources";

export function App() {
  const route = useRoute();
  const [authNeeded, setAuthNeeded] = useState(false);
  const meta = useAsync(() => api.meta(), []);
  const stats = useAsync(() => api.stats(), [route[0]]);
  const health = useAsync(() => api.sources(), []);
  useInterval(health.reload, 30_000);

  useEffect(() => {
    const onUnauthorized = () => setAuthNeeded(true);
    window.addEventListener("radar:unauthorized", onUnauthorized);
    return () => window.removeEventListener("radar:unauthorized", onUnauthorized);
  }, []);

  if (authNeeded) return <Login onDone={() => location.reload()} />;
  if (meta.error && !(meta.error instanceof ApiError && meta.error.status === 401)) {
    return (
      <Empty title="Cannot reach the radar server">
        <p>{meta.error.message}</p>
        <button className="btn" onClick={meta.reload}>Retry</button>
      </Empty>
    );
  }
  if (!meta.data) {
    return (
      <div className="login">
        <Spinner />
      </div>
    );
  }

  const running = health.data?.filter((s) => s.running) ?? [];
  const lastRun = health.data
    ?.map((s) => s.lastRun?.finishedAt)
    .filter((d): d is string => Boolean(d))
    .sort()
    .pop();
  const pipelineCount = ["shortlisted", "in_proposal", "submitted"].reduce((n, k) => n + (stats.data?.byStatus[k as "new"] ?? 0), 0);
  const page = route[0] ?? "";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">Opportunity Radar</div>
            <div className="brand-sub">{meta.data.company}</div>
          </div>
        </div>
        <NavLink href="#/" active={page === "" || page === "opportunity"} icon="radar" label="Radar" count={stats.data?.open} />
        <NavLink href="#/pipeline" active={page === "pipeline"} icon="board" label="Pipeline" count={pipelineCount || undefined} />
        <NavLink href="#/sources" active={page === "sources"} icon="sources" label="Sources" />
        <NavLink href="#/settings" active={page === "settings"} icon="settings" label="Settings" />
        <div className="sidebar-foot">
          <div>
            <span className={`dot ${running.length ? "busy" : "on"}`} />
            {running.length ? `Scraping ${running.length} source${running.length > 1 ? "s" : ""}…` : "Idle"}
          </div>
          <div>Last sync: {lastRun ? new Date(lastRun).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "never"}</div>
          <div>AI briefs: {meta.data.aiEnabled ? "on" : "off"}</div>
        </div>
      </aside>
      <main className="main">
        {page === "opportunity" && route[1] ? (
          <OpportunityDetailPage id={route[1]} meta={meta.data} />
        ) : page === "pipeline" ? (
          <PipelinePage />
        ) : page === "sources" ? (
          <SourcesPage />
        ) : page === "settings" ? (
          <SettingsPage meta={meta.data} onReloaded={meta.reload} />
        ) : (
          <RadarPage meta={meta.data} />
        )}
      </main>
    </div>
  );
}

function NavLink({ href, active, icon, label, count }: { href: string; active: boolean; icon: "radar" | "board" | "sources" | "settings"; label: string; count?: number }) {
  return (
    <a href={href} className={`nav-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <Icon name={icon} size={17} />
      {label}
      {count !== undefined && <span className="count">{count}</span>}
    </a>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [token, setToken] = useState("");
  return (
    <div className="login">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          session.setToken(token.trim());
          onDone();
        }}
      >
        <div className="row">
          <BrandMark />
          <div>
            <div className="brand-name">Opportunity Radar</div>
            <div className="muted small">Enter the dashboard access token</div>
          </div>
        </div>
        <input className="input" type="password" autoFocus value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access token" aria-label="Access token" />
        <button className="btn primary" type="submit" disabled={!token.trim()}>
          Continue
        </button>
      </form>
    </div>
  );
}
