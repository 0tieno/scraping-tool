import type { SourcesConfig } from "../config/loader.js";
import type { Env } from "../config/env.js";
import type { Logger } from "../core/logger.js";
import { createAfdbSource } from "./afdb.js";
import { createFeedSource } from "./feed.js";
import { createHtmlPageSource } from "./html-page.js";
import { createPpipSource } from "./ppip-kenya.js";
import { createReliefWebSource } from "./reliefweb.js";
import type { Source } from "./types.js";
import { createWorldBankSource } from "./world-bank.js";

export interface RegisteredSource {
  source: Source;
  enabled: boolean;
  /** Why a source is disabled, surfaced in the dashboard. */
  disabledReason?: string;
}

/** Builds every known source from config, keeping disabled ones visible so the UI can explain them. */
export function buildSources(cfg: SourcesConfig, env: Env, logger: Logger): RegisteredSource[] {
  const b = cfg.builtin;
  const list: RegisteredSource[] = [
    { source: createPpipSource(b["ppip-kenya"]), enabled: b["ppip-kenya"].enabled },
    { source: createWorldBankSource(b["world-bank"]), enabled: b["world-bank"].enabled },
    { source: createAfdbSource(), enabled: b.afdb.enabled },
  ];

  const rwEnabled = b.reliefweb.enabled && Boolean(env.RELIEFWEB_APPNAME);
  list.push({
    source: createReliefWebSource({ appname: env.RELIEFWEB_APPNAME ?? "", countries: b.reliefweb.countries }),
    enabled: rwEnabled,
    ...(rwEnabled ? {} : { disabledReason: env.RELIEFWEB_APPNAME ? "Disabled in sources.yaml" : "Set RELIEFWEB_APPNAME (approved appname) to enable" }),
  });

  for (const feed of cfg.feeds) list.push({ source: createFeedSource(feed), enabled: feed.enabled });
  for (const page of cfg.pages) list.push({ source: createHtmlPageSource(page), enabled: page.enabled });

  const ids = new Set<string>();
  for (const { source } of list) {
    if (ids.has(source.id)) throw new Error(`Duplicate source id "${source.id}" in config/sources.yaml`);
    ids.add(source.id);
  }
  for (const r of list) if (!r.enabled && !r.disabledReason) r.disabledReason = "Disabled in sources.yaml";
  logger.debug({ sources: list.map((s) => `${s.source.id}:${s.enabled ? "on" : "off"}`) }, "sources registered");
  return list;
}
