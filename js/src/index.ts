/**
 * Official JavaScript/TypeScript client SDK for the Agent Ready API.
 *
 * Scan any public URL for AI agent-readability against the Vercel Agent
 * Readability Spec, the llmstxt.org standard, and agent-protocol manifests.
 *
 * ```ts
 * import { AgentReady } from "agent-ready-client";
 * const ar = new AgentReady({ apiKey: process.env.AGENT_READY_API_KEY });
 * const scan = await ar.scan("https://example.com");
 * console.log(scan.vercelScore, scan.vercelRating);
 * ```
 *
 * Zero runtime dependencies — uses the global `fetch` (Node 18+, Deno, Bun,
 * browsers, and edge runtimes). Mirrors the transport in the `agent-ready-cli`
 * and `agent-ready-mcp` packages so behaviour stays consistent across surfaces.
 */

// ---- Errors ----------------------------------------------------------------

/** Thrown for every API, network, and timeout failure. */
export class ApiError extends Error {
  constructor(
    /** Stable machine code, e.g. `unauthorized`, `rate_limited`, `timeout`. */
    public readonly code: string,
    message: string,
    /** HTTP status when the failure came from a response, else `null`. */
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- Response types (mirror of the REST API schemas) -----------------------

export type CheckStatus = "pass" | "fail" | "warn" | "error";
export type ScanStatus = "running" | "completed" | "failed";
export type VercelRating = "excellent" | "good" | "fair" | "needs_improvement";

export interface CheckResult {
  checkId: string;
  name: string;
  status: CheckStatus;
  message: string;
  howToFix: string | null;
  details: Record<string, unknown>;
}

export interface Scan {
  id: string;
  rootUrl: string;
  status: ScanStatus;
  createdAt: string;
  completedAt: string | null;
  pagesDiscovered: number;
  pagesScanned: number;
  vercelScore: number;
  vercelRating: VercelRating;
  llmstxtScore: number;
  siteChecks: CheckResult[];
  llmstxtChecks: CheckResult[];
  pageResults: { url: string; checks: CheckResult[] }[];
  shareToken: string;
  /**
   * Corpus benchmark: the share of scanned sites this score beats, and the
   * number of sites it's measured against. Both `null` (or absent on an older
   * API) when the corpus is too thin to quote.
   */
  percentile?: number | null;
  corpusTotal?: number | null;
}

export interface StartScanResponse {
  id: string;
  status: ScanStatus;
  url: string;
  pollUrl: string;
}

export interface ScanSummary {
  id: string;
  shareToken: string;
  domain: string;
  rootUrl: string;
  vercelScore: number | null;
  vercelRating: VercelRating | null;
  llmstxtScore: number | null;
  pagesScanned: number | null;
  createdAt: string;
  percentile?: number | null;
  corpusTotal?: number | null;
}

export interface ScanListResponse {
  data: ScanSummary[];
  nextCursor?: string;
}

/** A live MCP server scan (from {@link AgentReady.scanMcp}). */
export interface McpScan {
  id: string;
  shareToken: string;
  endpoint: string;
  host: string;
  status: "completed" | "failed";
  mcpScore: number;
  mcpRating: VercelRating;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  resourceCount: number | null;
  promptCount: number | null;
  checks: CheckResult[];
}

export interface McpScanResponse {
  scan: McpScan;
  shareUrl: string;
}

/** NLWeb `/ask` returns a Schema.org `_meta` envelope for both hits and misses. */
export type AskResponse = Record<string, unknown>;

// ---- Options ---------------------------------------------------------------

export interface AgentReadyOptions {
  /** Pro API key. Defaults to `process.env.AGENT_READY_API_KEY` when present. */
  apiKey?: string;
  /** API base URL. Default `https://agent-ready.dev`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

export interface StartScanOptions {
  /** Cap the number of pages crawled (defaults to your tier's limit). */
  pageLimit?: number;
}

export interface ScanOptions extends StartScanOptions {
  /** Poll interval in ms while the scan runs. Default 2000. */
  pollIntervalMs?: number;
  /** Overall budget in ms to wait for completion. Default 120000. */
  timeoutMs?: number;
}

export interface ListScansOptions {
  limit?: number;
  cursor?: string;
}

export interface AskOptions {
  /** Restrict results to a Schema.org-style item type (e.g. `"checks"`). */
  itemType?: string;
  /** `"list"` (default) returns items; `"summarize"` returns a synthesis. */
  mode?: "list" | "summarize";
}

const DEFAULT_BASE_URL = "https://agent-ready.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_SCAN_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

function readEnvKey(): string | undefined {
  // Read AGENT_READY_API_KEY without depending on @types/node, so the SDK
  // typechecks the same in Node, edge, and browser builds.
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.AGENT_READY_API_KEY;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Client for the Agent Ready REST API. One instance is reusable and stateless;
 * create it once and share it.
 */
export class AgentReady {
  /** Resolved base URL (no trailing slash). */
  readonly baseUrl: string;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(options: AgentReadyOptions = {}) {
    this.apiKey = (options.apiKey ?? readEnvKey() ?? "").trim() || null;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Start a scan and return immediately (does not wait for completion). */
  async startScan(
    url: string,
    options: StartScanOptions = {},
  ): Promise<StartScanResponse> {
    return this.request<StartScanResponse>("POST", "/api/v1/scans", {
      body: { url, pageLimit: options.pageLimit },
    });
  }

  /** Fetch a scan (running or finished) by id. */
  async getScan(id: string): Promise<Scan> {
    return this.request<Scan>("GET", `/api/v1/scans/${encodeURIComponent(id)}`);
  }

  /**
   * Start a scan and poll until it completes, returning the full result.
   * Throws `ApiError("timeout")` if it is still running past the budget — the
   * scan keeps running server-side, so you can re-fetch it later with
   * {@link getScan} using the id from the thrown error's message.
   */
  async scan(url: string, options: ScanOptions = {}): Promise<Scan> {
    const started = await this.startScan(url, { pageLimit: options.pageLimit });
    const interval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS);

    for (;;) {
      const scan = await this.getScan(started.id);
      if (scan.status !== "running") return scan;
      if (Date.now() >= deadline) {
        throw new ApiError(
          "timeout",
          `Scan ${started.id} still running past the wait budget. Re-fetch it with getScan(${JSON.stringify(started.id)}).`,
        );
      }
      await sleep(interval);
    }
  }

  /** List your scans, newest first. */
  async listScans(options: ListScansOptions = {}): Promise<ScanListResponse> {
    const params = new URLSearchParams();
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    if (options.cursor) params.set("cursor", options.cursor);
    const query = params.toString();
    return this.request<ScanListResponse>(
      "GET",
      `/api/v1/scans${query ? `?${query}` : ""}`,
    );
  }

  /**
   * Natural-language search over Agent Ready's own docs (NLWeb `/ask`).
   * Public — no API key required. Returns the `_meta` envelope as-is, including
   * for no-results (404) and rate-limited (429) responses.
   */
  async ask(query: string, options: AskOptions = {}): Promise<AskResponse> {
    const body = {
      query: { q: query, itemType: options.itemType },
      prefer: options.mode ? { mode: options.mode } : undefined,
    };
    return this.request<AskResponse>("POST", "/api/v1/ask", {
      body,
      requireKey: false,
      passEnvelopeOnError: true,
    });
  }

  /**
   * Scan a live, remotely-hosted MCP server: connect over Streamable HTTP and
   * grade its tools, resources, and prompts against MCP best practices.
   * Returns a weighted `mcpScore` (0–100) plus per-check findings. Synchronous
   * (no polling). Public — no API key required. Remote http(s) endpoints only.
   * This is a standalone tool; its score is independent of the site scan score.
   */
  async scanMcp(endpoint: string): Promise<McpScanResponse> {
    return this.request<McpScanResponse>("POST", "/api/v1/scan/mcp", {
      body: { endpoint },
      requireKey: false,
    });
  }

  // ---- transport -----------------------------------------------------------

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    opts: {
      body?: unknown;
      requireKey?: boolean;
      passEnvelopeOnError?: boolean;
    } = {},
  ): Promise<T> {
    const requireKey = opts.requireKey ?? true;
    if (requireKey && !this.apiKey) {
      throw new ApiError(
        "missing_api_key",
        "No API key set. Issue a Pro key at https://agent-ready.dev/dashboard/api-keys and pass it to new AgentReady({ apiKey }) or set AGENT_READY_API_KEY.",
      );
    }

    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        throw new ApiError("timeout", `Request to ${path} timed out after ${this.timeoutMs}ms.`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ApiError("network_error", `Network error calling ${path}: ${message}`);
    }

    const text = await res.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        // Non-JSON body — fall through; surfaced via the error path below.
      }
    }

    // `/ask` answers and failures both carry a `_meta` envelope; pass it through.
    if (
      opts.passEnvelopeOnError &&
      payload &&
      typeof payload === "object" &&
      "_meta" in payload
    ) {
      return payload as T;
    }

    if (!res.ok) {
      const detail =
        payload && typeof payload === "object" && "error" in payload
          ? (payload as { error: { code?: string; message?: string } }).error
          : null;
      const code = detail?.code ?? `http_${res.status}`;
      const message = (detail?.message ?? text) || `HTTP ${res.status} from ${path}`;
      throw new ApiError(code, message, res.status);
    }

    return payload as T;
  }
}

export default AgentReady;
