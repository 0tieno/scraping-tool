import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { OPPORTUNITY_TYPES } from "../core/types.js";
import { sha1 } from "../core/text.js";

const termList = z.array(z.string().min(1)).default([]);
const weightedGroups = z.object({
  default: z.number().min(0).max(1),
  groups: z.array(z.object({ label: z.string(), weight: z.number().min(0).max(1), terms: termList })),
});

export const ProfileSchema = z.object({
  company: z.object({
    name: z.string(),
    website: z.string(),
    base: z.string(),
    pitch: z.string(),
  }),
  capabilities: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        /** core = what Kipeo is paid for (build/maintain); secondary = supporting expertise only. */
        role: z.enum(["core", "secondary"]),
        strong: termList,
        moderate: termList,
        acronyms: termList,
      }),
    )
    .min(1)
    .refine((caps) => caps.some((c) => c.role === "core"), "at least one capability must have role: core"),
  buyers: weightedGroups,
  geography: weightedGroups,
  opportunityTypes: z.record(z.enum(OPPORTUNITY_TYPES), z.number().min(0).max(1)),
  categories: z.record(z.string(), z.number().min(0).max(1)).default({}),
  languages: z
    .object({ accepted: z.array(z.string()).min(1), penalty: z.number().min(0).max(50) })
    .default({ accepted: ["en"], penalty: 15 }),
  penalties: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        points: z.number().min(0).max(100),
        /** Dropped when the title clearly names core (build/maintain) work. */
        waivedByCore: z.boolean(),
        terms: termList,
      }),
    )
    .default([]),
  deadline: z.object({
    comfortableDays: z.number().positive(),
    minimumDays: z.number().nonnegative(),
  }),
});
export type Profile = z.infer<typeof ProfileSchema>;

const SelectorsSchema = z.object({
  item: z.string().min(1),
  title: z.string().min(1),
  link: z.string().min(1),
  deadline: z.string().default(""),
  reference: z.string().default(""),
  buyer: z.string().default(""),
  description: z.string().default(""),
  published: z.string().default(""),
});

export const SourcesConfigSchema = z.object({
  builtin: z
    .object({
      "ppip-kenya": z.object({ enabled: z.boolean().default(true), maxPages: z.number().int().positive().default(20) }).default({ enabled: true, maxPages: 20 }),
      "world-bank": z
        .object({
          enabled: z.boolean().default(true),
          maxRows: z.number().int().positive().default(600),
          countries: z.array(z.string()).default([]),
          excludeNoticeTypes: z.array(z.string()).default(["Contract Award"]),
        })
        .default({ enabled: true, maxRows: 600, countries: [], excludeNoticeTypes: ["Contract Award"] }),
      afdb: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
      reliefweb: z
        .object({ enabled: z.boolean().default(false), countries: z.array(z.string()).default([]) })
        .default({ enabled: false, countries: [] }),
    })
    .default({
      "ppip-kenya": { enabled: true, maxPages: 20 },
      "world-bank": { enabled: true, maxRows: 600, countries: [], excludeNoticeTypes: ["Contract Award"] },
      afdb: { enabled: true },
      reliefweb: { enabled: false, countries: [] },
    }),
  feeds: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string(),
        url: z.url(),
        homepage: z.url().optional(),
        type: z.enum(OPPORTUNITY_TYPES).default("other"),
        country: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
  pages: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        name: z.string(),
        url: z.url(),
        enabled: z.boolean().default(true),
        type: z.enum(OPPORTUNITY_TYPES).default("tender"),
        country: z.string().optional(),
        selectors: SelectorsSchema,
      }),
    )
    .default([]),
});
export type SourcesConfig = z.infer<typeof SourcesConfigSchema>;
export type FeedConfig = SourcesConfig["feeds"][number];
export type PageConfig = SourcesConfig["pages"][number];

export interface LoadedConfig {
  profile: Profile;
  /** Changes whenever the profile changes, so stale scores can be detected and recomputed. */
  profileVersion: string;
  sources: SourcesConfig;
}

export function loadConfig(configDir: string): LoadedConfig {
  const profileRaw = readFileSync(path.join(configDir, "profile.yaml"), "utf8");
  const sourcesRaw = readFileSync(path.join(configDir, "sources.yaml"), "utf8");
  const profile = parseWith(ProfileSchema, profileRaw, "profile.yaml");
  const sources = parseWith(SourcesConfigSchema, sourcesRaw, "sources.yaml");
  return { profile, profileVersion: sha1(JSON.stringify(profile)).slice(0, 12), sources };
}

function parseWith<T extends z.ZodType>(schema: T, raw: string, file: string): z.infer<T> {
  const result = schema.safeParse(parseYaml(raw));
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid ${file}:\n${issues}`);
  }
  return result.data;
}
