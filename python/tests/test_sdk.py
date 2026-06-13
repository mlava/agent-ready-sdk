import io
import json
import urllib.error

import pytest

from agent_ready import AgentReady, ApiError


class FakeResp:
    """Minimal stand-in for the urlopen() context manager."""

    def __init__(self, status, body):
        self.status = status
        self._body = json.dumps(body).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def patch_urlopen(monkeypatch, responses):
    """Queue of (status, body) tuples; HTTP >=400 raises HTTPError like urllib."""
    calls = []
    state = {"i": 0}

    def fake_urlopen(req, timeout=None):
        calls.append(req)
        status, body = responses[min(state["i"], len(responses) - 1)]
        state["i"] += 1
        if status >= 400:
            raise urllib.error.HTTPError(
                req.full_url, status, "err", {}, io.BytesIO(json.dumps(body).encode())
            )
        return FakeResp(status, body)

    monkeypatch.setattr("agent_ready.client.urllib.request.urlopen", fake_urlopen)
    return calls


def test_missing_api_key():
    ar = AgentReady(api_key="")
    with pytest.raises(ApiError) as exc:
        ar.start_scan("https://example.com")
    assert exc.value.code == "missing_api_key"


def test_scan_starts_then_polls(monkeypatch):
    calls = patch_urlopen(
        monkeypatch,
        [
            (200, {"id": "abc", "status": "running", "url": "u", "pollUrl": "/x"}),
            (200, {"id": "abc", "status": "running"}),
            (
                200,
                {
                    "id": "abc",
                    "status": "completed",
                    "vercelScore": 96,
                    "percentile": 98,
                    "corpusTotal": 1234,
                },
            ),
        ],
    )
    ar = AgentReady(api_key="ar_live_x")
    scan = ar.scan("https://example.com", poll_interval=0)
    assert scan["status"] == "completed"
    assert scan["vercelScore"] == 96
    # Corpus benchmark passes through the typed response.
    assert scan["percentile"] == 98
    assert scan["corpusTotal"] == 1234
    assert calls[0].method == "POST"  # start_scan
    assert calls[1].method == "GET"  # first poll
    assert len(calls) == 3


def test_bearer_header_and_base_url(monkeypatch):
    calls = patch_urlopen(monkeypatch, [(200, {"id": "z", "status": "completed"})])
    ar = AgentReady(api_key="ar_live_secret", base_url="https://stage.example/")
    ar.get_scan("z")
    req = calls[0]
    assert req.full_url == "https://stage.example/api/v1/scans/z"
    assert req.headers["Authorization"] == "Bearer ar_live_secret"


def test_error_response_maps_to_apierror(monkeypatch):
    patch_urlopen(
        monkeypatch,
        [(429, {"error": {"code": "rate_limited", "message": "slow down"}})],
    )
    ar = AgentReady(api_key="ar_live_x")
    with pytest.raises(ApiError) as exc:
        ar.get_scan("z")
    assert exc.value.code == "rate_limited"
    assert exc.value.status == 429


def test_ask_no_key_passes_envelope(monkeypatch):
    patch_urlopen(monkeypatch, [(404, {"_meta": {"code": "NO_RESULTS"}, "items": []})])
    ar = AgentReady(api_key="")
    res = ar.ask("what is llms.txt?")
    assert res["_meta"]["code"] == "NO_RESULTS"
