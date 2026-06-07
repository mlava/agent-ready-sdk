# agent-ready-client (Python SDK)

Official **Python** client SDK for the [Agent Ready](https://agent-ready.dev) API — scan any public URL for **AI agent-readability** against the Vercel Agent Readability Spec, the [llmstxt.org](https://llmstxt.org) standard, and agent-protocol manifests (MCP server cards, A2A, `agents.json`, `agent-permissions.json`, UCP, x402, NLWeb).

Zero runtime dependencies — pure standard library (`urllib`). Python 3.8+.

> Prefer the terminal? Use the [`agent-ready-scanner`](https://www.npmjs.com/package/agent-ready-scanner) CLI. Working in JS/TS? See [`agent-ready-client`](https://www.npmjs.com/package/agent-ready-client) on npm. This package is for calling the API **from your own Python code**.

## Install

```bash
pip install agent-ready-client
```

## Quick start

```python
import os
from agent_ready import AgentReady

ar = AgentReady(api_key=os.environ["AGENT_READY_API_KEY"])

scan = ar.scan("https://example.com")          # start + poll to completion
print(scan["vercelScore"], scan["vercelRating"])  # 96 "excellent"

for check in scan["siteChecks"]:
    if check["status"] == "fail":
        print(check["checkId"], check["name"], "->", check["howToFix"])
```

## Authentication

`scan`, `start_scan`, `get_scan`, and `list_scans` require a **Pro API key**
(issue one at <https://agent-ready.dev/dashboard/api-keys>). Pass it explicitly
or set `AGENT_READY_API_KEY` in the environment:

```python
ar = AgentReady()                       # reads AGENT_READY_API_KEY
ar = AgentReady(api_key="ar_live_...")  # or pass it in
```

`ask` is **public** and needs no key.

## API

```python
AgentReady(api_key=None, base_url="https://agent-ready.dev", timeout=30.0)
```

| Method | Returns | Notes |
| --- | --- | --- |
| `scan(url, page_limit=None, poll_interval=2.0, timeout=120.0)` | `Scan` | Start **and poll** to completion. |
| `start_scan(url, page_limit=None)` | `StartScanResponse` | Queue only; returns the id. |
| `get_scan(id)` | `Scan` | Fetch a scan (running or finished). |
| `list_scans(limit=None, cursor=None)` | `ScanListResponse` | Your scans, newest first. |
| `ask(query, item_type=None, mode=None)` | `dict` | NLWeb doc search. **No key required.** |

### Fire-and-forget + poll later

```python
started = ar.start_scan("https://example.com", page_limit=25)
# ...later...
scan = ar.get_scan(started["id"])
if scan["status"] == "completed":
    print(scan["vercelScore"])
```

### Errors

Every failure raises `ApiError` with a stable `code` and (when from a response)
an HTTP `status`:

```python
from agent_ready import ApiError

try:
    ar.scan("https://example.com")
except ApiError as err:
    if err.code == "rate_limited":
        ...  # back off and retry
```

Common codes: `missing_api_key`, `unauthorized`, `subscription_required`,
`rate_limited`, `invalid_request`, `timeout`, `network_error`.

## Links

- API docs & OpenAPI 3.1 spec: <https://agent-ready.dev/docs/api> · <https://agent-ready.dev/api/v1/openapi.json>
- Methodology (all checks): <https://agent-ready.dev/methodology>
- JS/TS SDK: <https://www.npmjs.com/package/agent-ready-client> · CLI: <https://www.npmjs.com/package/agent-ready-scanner>

## License

MIT © Agent Ready
