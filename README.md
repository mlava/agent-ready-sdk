# Agent Ready SDKs

Official client SDKs for the [Agent Ready](https://agent-ready.dev) API — scan any public URL for **AI agent-readability** against the Vercel Agent Readability Spec, the [llmstxt.org](https://llmstxt.org) standard, and agent-protocol manifests (MCP server cards, A2A, `agents.json`, `agent-permissions.json`, UCP, x402, NLWeb).

These are **libraries you import into your own code**. For a terminal tool use the [`agent-ready-scanner`](https://www.npmjs.com/package/agent-ready-scanner) CLI; for MCP-native tools use [`agent-ready-mcp`](https://www.npmjs.com/package/agent-ready-mcp).

| Language | Package | Registry | Source |
| --- | --- | --- | --- |
| JavaScript / TypeScript | `agent-ready-client` | [npm](https://www.npmjs.com/package/agent-ready-client) | [`js/`](./js) |
| Python | `agent-ready-client` | [PyPI](https://pypi.org/project/agent-ready-client/) | [`python/`](./python) |

Both wrap the same REST API (`scan` / `getScan` / `listScans` / `ask`), are
zero-runtime-dependency, and expose the same `AgentReady` client shape.

```ts
// JS / TS
import { AgentReady } from "agent-ready-client";
const ar = new AgentReady({ apiKey: process.env.AGENT_READY_API_KEY });
const scan = await ar.scan("https://example.com");
console.log(scan.vercelScore, scan.vercelRating);
```

```python
# Python
from agent_ready import AgentReady
ar = AgentReady(api_key="ar_live_...")
scan = ar.scan("https://example.com")
print(scan["vercelScore"], scan["vercelRating"])
```

## Develop

```bash
# JS/TS
cd js && npm install && npm test && npm run build

# Python
cd python && python -m pytest tests/   # (pytest), then: python -m build
```

## Publish

- **npm:** `cd js && npm publish` (runs `prepublishOnly` → `tsup` build).
- **PyPI:** `cd python && python -m build && python -m twine upload dist/*`.

## Links

- API docs & OpenAPI 3.1 spec: <https://agent-ready.dev/docs/api> · <https://agent-ready.dev/api/v1/openapi.json>
- Methodology: <https://agent-ready.dev/methodology>

## License

[MIT](./LICENSE) © Agent Ready
