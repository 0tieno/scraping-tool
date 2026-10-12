import nodemailer from "nodemailer";
import type { Env } from "../config/env.js";
import { daysUntil } from "../core/dates.js";
import type { Logger } from "../core/logger.js";
import type { Opportunity } from "../core/types.js";
import type { Repository } from "../db/repository.js";

export interface DigestResult {
  count: number;
  channels: string[];
}

/** Sends a digest of new, relevant opportunities to the configured channels (email and/or Slack). */
export class DigestNotifier {
  constructor(
    private readonly env: Env,
    private readonly repo: Repository,
    private readonly logger: Logger,
  ) {}

  channels(): string[] {
    const c: string[] = [];
    if (this.env.SLACK_WEBHOOK_URL) c.push("slack");
    if (this.env.SMTP_HOST && this.env.DIGEST_TO) c.push("email");
    return c;
  }

  async send(sinceHours = 24): Promise<DigestResult> {
    const channels = this.channels();
    if (!channels.length) {
      this.logger.info("digest skipped: no notification channel configured");
      return { count: 0, channels };
    }
    const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();
    const items = this.repo.newSince(since, this.env.DIGEST_MIN_SCORE);
    if (!items.length) {
      this.logger.info({ sinceHours }, "digest skipped: nothing new above threshold");
      return { count: 0, channels: [] };
    }

    const sent: string[] = [];
    const results = await Promise.allSettled([
      channels.includes("slack") ? this.sendSlack(items).then(() => sent.push("slack")) : null,
      channels.includes("email") ? this.sendEmail(items).then(() => sent.push("email")) : null,
    ]);
    for (const r of results) if (r.status === "rejected") this.logger.error({ err: r.reason }, "digest channel failed");
    this.logger.info({ count: items.length, channels: sent }, "digest sent");
    return { count: items.length, channels: sent };
  }

  private link(o: Opportunity): string {
    return `${this.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/#/opportunity/${o.id}`;
  }

  private async sendSlack(items: Opportunity[]): Promise<void> {
    const top = items.slice(0, 15);
    const blocks = [
      { type: "header", text: { type: "plain_text", text: `Kipeo Radar: ${items.length} new opportunit${items.length === 1 ? "y" : "ies"}` } },
      ...top.map((o) => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*<${this.link(o)}|${escapeSlack(o.title)}>*\n${tierEmoji(o.tier)} *${o.score}* · ${escapeSlack(o.buyer ?? o.source)} · ${o.country ?? "—"} · ${deadlineLabel(o)}\n_${escapeSlack(o.breakdown.reasons.slice(0, 2).join(" · "))}_`,
        },
      })),
    ];
    const res = await fetch(this.env.SLACK_WEBHOOK_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${items.length} new opportunities`, blocks }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`);
  }

  private async sendEmail(items: Opportunity[]): Promise<void> {
    const transport = nodemailer.createTransport({
      host: this.env.SMTP_HOST,
      port: this.env.SMTP_PORT,
      secure: this.env.SMTP_PORT === 465,
      ...(this.env.SMTP_USER ? { auth: { user: this.env.SMTP_USER, pass: this.env.SMTP_PASS } } : {}),
    });
    await transport.sendMail({
      from: this.env.DIGEST_FROM,
      to: this.env.DIGEST_TO,
      subject: `Kipeo Radar: ${items.length} new opportunit${items.length === 1 ? "y" : "ies"} (${items.filter((i) => i.tier === "hot").length} hot)`,
      text: items.map((o) => `[${o.score}] ${o.title}\n  ${o.buyer ?? o.source} · ${o.country ?? "-"} · ${deadlineLabel(o)}\n  ${this.link(o)}`).join("\n\n"),
      html: renderEmail(items, (o) => this.link(o)),
    });
  }
}

function renderEmail(items: Opportunity[], link: (o: Opportunity) => string): string {
  const rows = items
    .map(
      (o) => `<tr>
  <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;">
    <span style="display:inline-block;min-width:34px;text-align:center;padding:4px 6px;border-radius:6px;font-weight:700;color:#fff;background:${tierColor(o.tier)}">${o.score}</span>
  </td>
  <td style="padding:12px 8px;border-bottom:1px solid #e5e7eb;">
    <a href="${link(o)}" style="color:#0f172a;font-weight:600;text-decoration:none;">${escapeHtml(o.title)}</a>
    <div style="color:#475569;font-size:13px;margin-top:4px;">${escapeHtml(o.buyer ?? o.source)} · ${escapeHtml(o.country ?? "—")} · ${escapeHtml(deadlineLabel(o))}</div>
    <div style="color:#64748b;font-size:12px;margin-top:4px;">${escapeHtml(o.breakdown.reasons.slice(0, 2).join(" · "))}</div>
  </td>
</tr>`,
    )
    .join("");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:720px;margin:auto;">
  <h2 style="color:#0f172a;">New opportunities for Kipeo Afrika</h2>
  <table style="border-collapse:collapse;width:100%;">${rows}</table>
  <p style="color:#94a3b8;font-size:12px;">Sent by Kipeo Opportunity Radar.</p>
</div>`;
}

function deadlineLabel(o: Opportunity): string {
  const d = daysUntil(o.deadline);
  if (d === null) return "no deadline listed";
  const date = new Date(o.deadline!).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
  return `closes ${date} (${Math.max(0, Math.floor(d))}d)`;
}

const tierColor = (t: string) => ({ hot: "#dc2626", warm: "#ea580c", cool: "#0284c7", cold: "#64748b" })[t] ?? "#64748b";
const tierEmoji = (t: string) => ({ hot: "🔥", warm: "🟠", cool: "🔵", cold: "⚪" })[t] ?? "⚪";
const escapeSlack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
