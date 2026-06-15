# agent-ready-client

Official **JavaScript / TypeScript** client SDK for the [Agent Ready](https://agent-ready.dev) API — scan any public URL for **AI agent-readability** against the Vercel Agent Readability Spec, the [llmstxt.org](https://llmstxt.org) standard, and agent-protocol manifests (MCP server cards, A2A, `agents.json`, `agent-permissions.json`, UCP, x402, NLWeb).

Zero runtime dependencies — uses the global `fetch`, so it runs on Node 18+, Deno, Bun, edge runtimes, and browsers.

> Prefer the terminal? Use the [`agent-ready-scanner`](https://www.npmjs.com/package/agent-ready-scanner) CLI. Want MCP-native tools? See [`agent-ready-mcp`](https://www.npmjs.com/package/agent-ready-mcp). This package is for calling the API **from your own code**. A [Python SDK](https://pypi.org/project/agent-ready-client/) is also available.

## Install

```bash
npm install agent-ready-client
```

## Quick start

```ts
import { AgentReady } from "agent-ready-client";

const ar = new AgentReady({ apiKey: process.env.AGENT_READY_API_KEY });

// Start a scan and wait for the result:
const scan = await ar.scan("https://example.com");
console.log(scan.vercelScore, scan.vercelRating); // 96 "excellent"

// Inspect failing checks:
for (const check of scan.siteChecks.filter((c) => c.status === "fail")) {
  console.log(check.checkId, check.name, "→", check.howToFix);
}
```

## Authentication

`scan`, `startScan`, `getScan`, and `listScans` require a **Pro API key** (issue one at
<https://agent-ready.dev/dashboard/api-keys>). Pass it explicitly or set
`AGENT_READY_API_KEY` in the environment:

```ts
const ar = new AgentReady();                       // reads AGENT_READY_API_KEY
const ar = new AgentReady({ apiKey: "ar_live_…" }); // or pass it in
```

`ask` is **public** and needs no key.

## API

```ts
new AgentReady({ apiKey?, baseUrl?, timeoutMs? })
```

| Method | Returns | Notes |
| --- | --- | --- |
| `scan(url, { pageLimit?, pollIntervalMs?, timeoutMs? })` | `Promise<Scan>` | Start **and poll** to completion. |
| `startScan(url, { pageLimit? })` | `Promise<StartScanResponse>` | Queue only; returns the id immediately. |
| `getScan(id)` | `Promise<Scan>` | Fetch a scan (running or finished). |
| `listScans({ limit?, cursor? })` | `Promise<ScanListResponse>` | Your scans, newest first. |
| `ask(query, { itemType?, mode? })` | `Promise<AskResponse>` | NLWeb doc search. **No key required.** |
| `scanMcp(endpoint)` | `Promise<McpScanResponse>` | Grade a live MCP server (tools/resources/prompts). **No key required.** |

### Fire-and-forget + poll later

```ts
const { id } = await ar.startScan("https://example.com", { pageLimit: 25 });
// …later…
const scan = await ar.getScan(id);
if (scan.status === "completed") console.log(scan.vercelScore);
```

### Errors

Every failure throws an `ApiError` with a stable `code` and (when from a response) an HTTP `status`:

```ts
import { ApiError } from "agent-ready-client";

try {
  await ar.scan("https://example.com");
} catch (err) {
  if (err instanceof ApiError && err.code === "rate_limited") {
    // back off and retry
  }
}
```

Common codes: `missing_api_key`, `unauthorized`, `subscription_required`,
`rate_limited`, `invalid_request`, `timeout`, `network_error`.

## Types

`Scan`, `CheckResult`, `ScanSummary`, `ScanListResponse`, `StartScanResponse`,
`CheckStatus`, `ScanStatus`, `VercelRating`, and `ApiError` are all exported.

## Links

- API docs & OpenAPI 3.1 spec: <https://agent-ready.dev/docs/api> · <https://agent-ready.dev/api/v1/openapi.json>
- Methodology (all checks): <https://agent-ready.dev/methodology>
- CLI: <https://www.npmjs.com/package/agent-ready-scanner> · MCP server: <https://www.npmjs.com/package/agent-ready-mcp>

## License

MIT © Agent Ready
