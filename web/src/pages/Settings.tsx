import { useState } from "react";
import { api, session } from "../api";
import { Spinner, useToast } from "../components/ui";
import type { Meta } from "../types";

export function SettingsPage({ meta, onReloaded }: { meta: Meta; onReloaded: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<"reload" | "digest" | null>(null);
  const [actor, setActor] = useState(session.actor());

  const reload = async () => {
    setBusy("reload");
    try {
      const r = await api.reload();
      toast(`Profile ${r.profileVersion} loaded · ${r.rescored} opportunities rescored`);
      onReloaded();
    } catch (e) {
      toast(`Reload failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const digest = async () => {
    setBusy("digest");
    try {
      const r = await api.digest();
      toast(r.count ? `Digest sent: ${r.count} items via ${r.channels.join(", ")}` : "Nothing new to send");
    } catch (e) {
      toast(`Digest failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Settings</h1>
          <div className="page-sub">Configuration lives in version-controlled YAML. This page applies and checks it.</div>
        </div>
      </div>
      <div className="stack" style={{ maxWidth: 820 }}>
        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="card-title">Capability profile</div>
          <div className="muted">
            Scoring is driven by <span className="mono">config/profile.yaml</span>: build/maintain keywords, buyer types, geography, penalties for
            hardware, policy work, staff jobs and grants, and deadline rules. After editing it, reload to rescore every stored opportunity.
          </div>
          <div className="opp-tags">
            {meta.capabilities.map((c) => (
              <span className={`chip${c.role === "core" ? "" : " neutral"}`} key={c.id} title={c.role === "core" ? "Core: what clients pay Kipeo for" : "Supporting expertise"}>
                {c.label}
              </span>
            ))}
          </div>
          <div className="muted small">Highlighted lines are core (build & maintain); grey lines only support a bid.</div>
          <div className="row">
            <button className="btn primary" onClick={reload} disabled={busy !== null}>
              {busy === "reload" && <Spinner />} Reload config & rescore
            </button>
            <span className="muted small">
              Active profile <span className="mono">{meta.profileVersion}</span>
            </span>
          </div>
        </div>

        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="card-title">AI bid briefs</div>
          <div className="row">
            <span className={`pill ${meta.aiEnabled ? "ok" : ""}`}>{meta.aiEnabled ? "Enabled" : "Not configured"}</span>
            <span className="muted small">{meta.aiEnabled ? `Model ${meta.aiModel}` : "Set ANTHROPIC_API_KEY on the server to enable."}</span>
          </div>
        </div>

        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="card-title">Notifications</div>
          <div className="row">
            {meta.notificationChannels.length ? (
              meta.notificationChannels.map((c) => (
                <span className="pill ok" key={c}>
                  {c}
                </span>
              ))
            ) : (
              <span className="muted">No channel configured. Set SLACK_WEBHOOK_URL and/or SMTP_* + DIGEST_TO.</span>
            )}
          </div>
          <div className="row">
            <button className="btn" onClick={digest} disabled={busy !== null || !meta.notificationChannels.length}>
              {busy === "digest" && <Spinner />} Send last-24h digest now
            </button>
          </div>
        </div>

        <div className="card card-pad stack" style={{ gap: 10 }}>
          <div className="card-title">Your name</div>
          <div className="muted small">Recorded on pipeline changes in the activity log. Stored only in this browser.</div>
          <div className="row">
            <input className="input" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="e.g. Ronney" maxLength={80} />
            <button
              className="btn"
              onClick={() => {
                session.setActor(actor.trim());
                toast("Saved");
              }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
