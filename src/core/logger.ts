import pino, { type Logger } from "pino";

export type { Logger };

export function createLogger(level: string, pretty = process.stdout.isTTY): Logger {
  return pino({
    level,
    base: { app: "kipeo-radar" },
    redact: { paths: ["*.apiKey", "*.password", "*.token", "headers.authorization"], censor: "[redacted]" },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } } : {}),
  });
}
