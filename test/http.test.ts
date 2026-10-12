import pino from "pino";
import { describe, expect, it } from "vitest";
import { AccessDeniedError, HttpClient, HttpError, TransientPayloadError } from "../src/core/http.js";

type Responder = (url: string, init?: RequestInit) => Response;

function client(responder: Responder, maxRetries = 3) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return responder(url, init);
  }) as typeof fetch;
  const http = new HttpClient({
    userAgent: "KipeoOpportunityRadar/1.0 (+https://kipeoafrika.com)",
    minDelayMs: 0,
    timeoutMs: 5000,
    maxRetries,
    logger: pino({ level: "silent" }),
    fetchImpl,
    sleep: async () => {},
  });
  return { http, calls };
}

const robotsAllowAll: Responder = () => new Response("User-agent: *\nDisallow:", { status: 200 });

describe("HttpClient", () => {
  it("retries transient 5xx responses and then succeeds", async () => {
    let attempts = 0;
    const { http } = client((url) => {
      if (url.endsWith("/robots.txt")) return robotsAllowAll(url);
      attempts++;
      return attempts < 3 ? new Response("busy", { status: 503 }) : new Response('{"ok":true}', { status: 200 });
    });
    await expect(http.json("https://api.example.org/items")).resolves.toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it("does not retry client errors", async () => {
    let attempts = 0;
    const { http } = client((url) => {
      if (url.endsWith("/robots.txt")) return robotsAllowAll(url);
      attempts++;
      return new Response("nope", { status: 404 });
    });
    await expect(http.text("https://api.example.org/missing")).rejects.toBeInstanceOf(HttpError);
    expect(attempts).toBe(1);
  });

  it("retries 200 responses that carry an error payload when the caller flags them", async () => {
    let attempts = 0;
    const { http } = client((url) => {
      if (url.endsWith("/robots.txt")) return robotsAllowAll(url);
      attempts++;
      return new Response(attempts === 1 ? '{"message":"Server Error"}' : '{"data":[1]}', { status: 200 });
    });
    const result = await http.json<{ data: number[] }>("https://api.example.org/page", {
      validate: (t) => {
        if (!t.includes('"data"')) throw new TransientPayloadError("error payload", "x");
      },
    });
    expect(result.data).toEqual([1]);
    expect(attempts).toBe(2);
  });

  it("refuses URLs disallowed by robots.txt without fetching them", async () => {
    const { http, calls } = client((url) =>
      url.endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /", { status: 200 }) : new Response("secret"),
    );
    await expect(http.text("https://private.example.org/page")).rejects.toBeInstanceOf(AccessDeniedError);
    expect(calls).toEqual(["https://private.example.org/robots.txt"]);
  });

  it("treats a missing robots.txt (404) as allow-all", async () => {
    const { http } = client((url) => (url.endsWith("/robots.txt") ? new Response("", { status: 404 }) : new Response("ok")));
    await expect(http.text("https://open.example.org/page")).resolves.toBe("ok");
  });

  it("reports bot-protection challenges instead of retrying or bypassing them", async () => {
    let attempts = 0;
    const { http } = client((url) => {
      if (url.endsWith("/robots.txt")) return robotsAllowAll(url);
      attempts++;
      return new Response("<html><head><title>Just a moment...</title></head></html>", { status: 403 });
    });
    await expect(http.text("https://guarded.example.org/feed.xml")).rejects.toBeInstanceOf(AccessDeniedError);
    expect(attempts).toBe(1);
  });

  it("sends an honest User-Agent", async () => {
    let ua = "";
    const { http } = client((url, init) => {
      ua = new Headers(init?.headers).get("user-agent") ?? "";
      return url.endsWith("/robots.txt") ? robotsAllowAll(url) : new Response("ok");
    });
    await http.text("https://ua.example.org/");
    expect(ua).toContain("KipeoOpportunityRadar");
  });
});
