"""Official Python client SDK for the Agent Ready API.

Scan any public URL for AI agent-readability against the Vercel Agent
Readability Spec, the llmstxt.org standard, and agent-protocol manifests.

    from agent_ready import AgentReady
    ar = AgentReady(api_key="ar_live_...")
    scan = ar.scan("https://example.com")
    print(scan["vercelScore"], scan["vercelRating"])

Zero runtime dependencies — uses only the standard library (``urllib``).
Mirrors the transport in the ``agent-ready-client`` (JS) and ``agent-ready-cli``
packages so behaviour stays consistent across surfaces.
"""

from __future__ import annotations

import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

try:  # TypedDict is in typing on 3.8+, but keep the import defensive.
    from typing import TypedDict
except ImportError:  # pragma: no cover
    TypedDict = None  # type: ignore[assignment]

__all__ = [
    "AgentReady",
    "ApiError",
    "CheckResult",
    "Scan",
    "ScanSummary",
    "ScanListResponse",
    "StartScanResponse",
]

DEFAULT_BASE_URL = "https://agent-ready.dev"
DEFAULT_TIMEOUT = 30.0
DEFAULT_SCAN_TIMEOUT = 120.0
DEFAULT_POLL_INTERVAL = 2.0


class ApiError(Exception):
    """Raised for every API, network, and timeout failure.

    Attributes:
        code: Stable machine code (e.g. ``"unauthorized"``, ``"rate_limited"``,
            ``"timeout"``).
        status: HTTP status when the failure came from a response, else ``None``.
    """

    def __init__(self, code: str, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code
        self.status = status

    def __str__(self) -> str:
        message = super().__str__()
        return f"[{self.code}] {message}" if self.code else message


if TypedDict is not None:

    class CheckResult(TypedDict):
        checkId: str
        name: str
        status: str  # "pass" | "fail" | "warn" | "error"
        message: str
        howToFix: Optional[str]
        details: Dict[str, Any]

    class _PageResult(TypedDict):
        url: str
        checks: List[CheckResult]

    class _Benchmark(TypedDict, total=False):
        # Corpus benchmark — the share of scanned sites this score beats, and
        # the corpus size it's measured against. Null/absent on a thin corpus.
        # Optional (``total=False``) so mixing it into a strict TypedDict keeps
        # these keys non-required.
        percentile: Optional[int]
        corpusTotal: Optional[int]

    class Scan(_Benchmark, total=False):
        id: str
        rootUrl: str
        status: str  # "running" | "completed" | "failed"
        createdAt: str
        completedAt: Optional[str]
        pagesDiscovered: int
        pagesScanned: int
        vercelScore: int
        vercelRating: str
        llmstxtScore: int
        siteChecks: List[CheckResult]
        llmstxtChecks: List[CheckResult]
        pageResults: List[_PageResult]
        shareToken: str

    class StartScanResponse(TypedDict):
        id: str
        status: str
        url: str
        pollUrl: str

    class ScanSummary(_Benchmark):
        id: str
        shareToken: str
        domain: str
        rootUrl: str
        vercelScore: Optional[int]
        vercelRating: Optional[str]
        llmstxtScore: Optional[int]
        pagesScanned: Optional[int]
        createdAt: str

    class ScanListResponse(TypedDict, total=False):
        data: List[ScanSummary]
        nextCursor: str
else:  # pragma: no cover - typing fallback for very old runtimes
    CheckResult = Dict[str, Any]  # type: ignore[misc,assignment]
    Scan = Dict[str, Any]  # type: ignore[misc,assignment]
    StartScanResponse = Dict[str, Any]  # type: ignore[misc,assignment]
    ScanSummary = Dict[str, Any]  # type: ignore[misc,assignment]
    ScanListResponse = Dict[str, Any]  # type: ignore[misc,assignment]


class AgentReady:
    """Client for the Agent Ready REST API. Stateless and reusable."""

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        key = api_key if api_key is not None else os.environ.get("AGENT_READY_API_KEY")
        self.api_key: Optional[str] = (key or "").strip() or None
        self.base_url: str = base_url.rstrip("/")
        self.timeout: float = timeout

    def start_scan(
        self, url: str, page_limit: Optional[int] = None
    ) -> "StartScanResponse":
        """Start a scan and return immediately (does not wait for completion)."""
        body: Dict[str, Any] = {"url": url}
        if page_limit is not None:
            body["pageLimit"] = page_limit
        return self._request("POST", "/api/v1/scans", body=body)

    def get_scan(self, scan_id: str) -> "Scan":
        """Fetch a scan (running or finished) by id."""
        return self._request(
            "GET", "/api/v1/scans/" + urllib.parse.quote(scan_id, safe="")
        )

    def scan(
        self,
        url: str,
        page_limit: Optional[int] = None,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
        timeout: float = DEFAULT_SCAN_TIMEOUT,
    ) -> "Scan":
        """Start a scan and poll until it completes, returning the full result.

        Raises ``ApiError("timeout")`` if it is still running past ``timeout``
        seconds — the scan keeps running server-side, so re-fetch it later with
        :meth:`get_scan` using the id from the error message.
        """
        started = self.start_scan(url, page_limit=page_limit)
        deadline = time.monotonic() + timeout
        while True:
            result = self.get_scan(started["id"])
            if result.get("status") != "running":
                return result
            if time.monotonic() >= deadline:
                raise ApiError(
                    "timeout",
                    "Scan {0} still running past the wait budget. "
                    "Re-fetch it with get_scan({0!r}).".format(started["id"]),
                )
            time.sleep(poll_interval)

    def list_scans(
        self, limit: Optional[int] = None, cursor: Optional[str] = None
    ) -> "ScanListResponse":
        """List your scans, newest first."""
        params: Dict[str, str] = {}
        if limit is not None:
            params["limit"] = str(limit)
        if cursor:
            params["cursor"] = cursor
        path = "/api/v1/scans"
        if params:
            path += "?" + urllib.parse.urlencode(params)
        return self._request("GET", path)

    def ask(
        self,
        query: str,
        item_type: Optional[str] = None,
        mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Natural-language search over Agent Ready's docs (NLWeb ``/ask``).

        Public — no API key required. Returns the ``_meta`` envelope as-is,
        including for no-results (404) and rate-limited (429) responses.
        """
        body: Dict[str, Any] = {"query": {"q": query, "itemType": item_type}}
        if mode:
            body["prefer"] = {"mode": mode}
        return self._request(
            "POST",
            "/api/v1/ask",
            body=body,
            require_key=False,
            pass_envelope_on_error=True,
        )

    # ---- transport ----------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        body: Optional[Dict[str, Any]] = None,
        require_key: bool = True,
        pass_envelope_on_error: bool = False,
    ) -> Any:
        if require_key and not self.api_key:
            raise ApiError(
                "missing_api_key",
                "No API key set. Issue a Pro key at "
                "https://agent-ready.dev/dashboard/api-keys and pass api_key= "
                "or set AGENT_READY_API_KEY.",
            )

        headers: Dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"

        req = urllib.request.Request(
            self.base_url + path, data=data, headers=headers, method=method
        )

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                text = resp.read().decode("utf-8")
        except urllib.error.HTTPError as err:
            status = err.code
            text = err.read().decode("utf-8", "replace")
        except (socket.timeout, TimeoutError) as err:
            raise ApiError(
                "timeout",
                "Request to {0} timed out after {1}s.".format(path, self.timeout),
            ) from err
        except urllib.error.URLError as err:
            reason = err.reason
            if isinstance(reason, (socket.timeout, TimeoutError)):
                raise ApiError(
                    "timeout",
                    "Request to {0} timed out after {1}s.".format(path, self.timeout),
                ) from err
            raise ApiError(
                "network_error",
                "Network error calling {0}: {1}".format(path, reason),
            ) from err

        payload: Any = None
        if text:
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                payload = None

        # `/ask` answers and failures both carry a `_meta` envelope; pass through.
        if (
            pass_envelope_on_error
            and isinstance(payload, dict)
            and "_meta" in payload
        ):
            return payload

        if status < 200 or status >= 300:
            detail = payload.get("error") if isinstance(payload, dict) else None
            code = detail.get("code") if isinstance(detail, dict) else None
            message = detail.get("message") if isinstance(detail, dict) else None
            raise ApiError(
                code or "http_{0}".format(status),
                message or text or "HTTP {0} from {1}".format(status, path),
                status,
            )

        return payload
