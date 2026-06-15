import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentReady, ApiError } from "../src/index";

type FetchArgs = [string, RequestInit];

/** Install a fetch stub that responds from a queue of [status, json] pairs. */
function stubFetch(responses: Array<[number, unknown]>): () => FetchArgs[] {
  const calls: FetchArgs[] = [];
  let i = 0;
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push([url, init]);
    const [status, body] = responses[Math.min(i, responses.length - 1)]!;
    i += 1;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return () => calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("AgentReady", () => {
  it("throws ApiError('missing_api_key') for key-required calls without a key", async () => {
    const ar = new AgentReady({ apiKey: "" });
    await expect(ar.startScan("https://example.com")).rejects.toMatchObject({
      name: "ApiError",
      code: "missing_api_key",
    });
  });

  it("scanMcp() posts the endpoint with no key required", async () => {
    const getCalls = stubFetch([
      [201, { scan: { id: "m1", mcpScore: 92, mcpRating: "excellent" }, shareUrl: "/mcp-server-scanner/m1" }],
    ]);
    const ar = new AgentReady({ apiKey: "" });
    const res = await ar.scanMcp("https://mcp.example.com/mcp");
    expect(res.scan.mcpScore).toBe(92);
    expect(res.shareUrl).toBe("/mcp-server-scanner/m1");
    const [url, init] = getCalls()[0]!;
    expect(url).toBe("https://agent-ready.dev/api/v1/scan/mcp");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      endpoint: "https://mcp.example.com/mcp",
    });
  });

  it("scan() starts then polls getScan until it leaves 'running'", async () => {
    const getCalls = stubFetch([
      [200, { id: "abc", status: "running", url: "https://example.com", pollUrl: "/x" }],
      [200, { id: "abc", status: "running" }],
      [200, { id: "abc", status: "completed", vercelScore: 96, vercelRating: "excellent", percentile: 98, corpusTotal: 1234 }],
    ]);
    const ar = new AgentReady({ apiKey: "ar_live_x" });
    const scan = await ar.scan("https://example.com", { pollIntervalMs: 0 });
    expect(scan.status).toBe("completed");
    expect(scan.vercelScore).toBe(96);
    // Corpus benchmark passes through the typed response.
    expect(scan.percentile).toBe(98);
    expect(scan.corpusTotal).toBe(1234);
    const calls = getCalls();
    expect(calls[0]![1].method).toBe("POST"); // startScan
    expect(calls[0]![0]).toContain("/api/v1/scans");
    expect(calls[1]![1].method).toBe("GET"); // first poll
    expect(calls).toHaveLength(3);
  });

  it("sends the Bearer header and respects baseUrl", async () => {
    const getCalls = stubFetch([[200, { id: "z", status: "completed" }]]);
    const ar = new AgentReady({ apiKey: "ar_live_secret", baseUrl: "https://stage.example/" });
    await ar.getScan("z");
    const [url, init] = getCalls()[0]!;
    expect(url).toBe("https://stage.example/api/v1/scans/z");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ar_live_secret");
  });

  it("maps a non-ok response to ApiError with the API error code", async () => {
    stubFetch([[429, { error: { code: "rate_limited", message: "slow down" } }]]);
    const ar = new AgentReady({ apiKey: "ar_live_x" });
    await expect(ar.getScan("z")).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });

  it("ask() works without a key and passes the _meta envelope through on 404", async () => {
    stubFetch([[404, { _meta: { code: "NO_RESULTS" }, items: [] }]]);
    const ar = new AgentReady({ apiKey: "" });
    const res = (await ar.ask("what is llms.txt?")) as { _meta: { code: string } };
    expect(res._meta.code).toBe("NO_RESULTS");
  });
});

describe("ApiError", () => {
  it("carries code and status", () => {
    const e = new ApiError("unauthorized", "no", 401);
    expect(e.code).toBe("unauthorized");
    expect(e.status).toBe(401);
    expect(e).toBeInstanceOf(Error);
  });
});
