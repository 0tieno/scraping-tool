import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_PATH: z.string().default("./data/radar.db"),
  DASHBOARD_TOKEN: optionalString,
  CONFIG_DIR: z.string().default("./config"),

  SCRAPE_CRON: optionalString,
  DIGEST_CRON: optionalString,
  TIMEZONE: z.string().default("Africa/Nairobi"),

  SCRAPER_USER_AGENT: z
    .string()
    .default("KipeoOpportunityRadar/1.0 (+https://kipeoafrika.com; partnership@kipeoafrika.com)"),
  SCRAPER_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(1500),
  SCRAPER_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  SCRAPER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(4),

  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_AUTO_ANALYZE_MIN_SCORE: z.coerce.number().min(0).max(100).default(65),
  AI_MAX_AUTO_ANALYSES_PER_RUN: z.coerce.number().int().nonnegative().default(10),

  DIGEST_MIN_SCORE: z.coerce.number().min(0).max(100).default(50),
  SLACK_WEBHOOK_URL: optionalString,
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  DIGEST_FROM: z.string().default("radar@kipeoafrika.com"),
  DIGEST_TO: optionalString,
  PUBLIC_BASE_URL: z.string().default("http://localhost:8080"),

  RELIEFWEB_APPNAME: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

/** Parses and validates process.env once; fails fast with a readable message on misconfiguration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
