"""Unit tests against a real local HTTP server, so urllib's own behaviour is exercised."""

from __future__ import annotations

import hashlib
import json
import re
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import parse_qsl, urlsplit

import pytest

from graunt import Graunt, GrauntConnectionError, GrauntError, __version__

PASS = "gap_live_" + "ab12" * 16


class Reply:
    def __init__(self, body: Any = None, status: int = 200, headers: Optional[Dict[str, str]] = None, raw: Optional[bytes] = None, delay: float = 0.0):
        self.status = status
        self.headers = {"Content-Type": "application/json", **(headers or {})}
        self.raw = raw if raw is not None else json.dumps(body).encode("utf-8")
        self.delay = delay


class FakeApi:
    """A local server answering from `route(path, query, headers)`; records every request."""

    def __init__(self) -> None:
        self.route: Callable[[str, Dict[str, str], Dict[str, str]], Reply] = lambda p, q, h: Reply({"ok": True, "data": {}})
        self.calls: List[Dict[str, Any]] = []
        api = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                parts = urlsplit(self.path)
                query = dict(parse_qsl(parts.query))
                headers = {k.lower(): v for k, v in self.headers.items()}
                api.calls.append({"path": parts.path, "raw_path": self.path, "query": query, "headers": headers})
                reply = api.route(parts.path, query, headers)
                if reply.delay:
                    time.sleep(reply.delay)
                self.send_response(reply.status)
                for name, value in reply.headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(reply.raw)))
                self.end_headers()
                self.wfile.write(reply.raw)

            def log_message(self, *args: Any) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def api():
    server = FakeApi()
    yield server
    server.close()


def ok(data: Any) -> Reply:
    return Reply({"ok": True, "data": data})


def test_version_matches_pyproject_and_is_sent_as_user_agent(api: FakeApi) -> None:
    pyproject = (Path(__file__).parent.parent / "pyproject.toml").read_text()
    declared = re.search(r'^version = "([^"]+)"', pyproject, re.MULTILINE)
    assert declared is not None and __version__ == declared.group(1)
    api.route = lambda p, q, h: ok({"listings": [], "pagination": {"page": 1, "limit": 20, "total": 0}})
    Graunt(base_url=api.base_url).listings.search()
    assert api.calls[0]["headers"]["user-agent"] == f"graunt-python/{__version__}"


def test_search_maps_filters_to_api_query_names_and_unwraps_data(api: FakeApi) -> None:
    page = {"listings": [{"id": "l1", "dataset_name": "A", "category": "c", "price_cents": 0, "tags": []}], "pagination": {"page": 2, "limit": 5, "total": 6}}
    api.route = lambda p, q, h: ok(page)
    out = Graunt(base_url=api.base_url).listings.search(
        q="holidays", free_only=True, packet_only=False, asset_class="PACKET_BUNDLE", min_price_cents=0, max_price_cents=900,
        sort="newest", page=2, limit=5, industry_tag="legal", extra={"has_manifest_hash": "true", "q": "overridden"},
    )
    assert out == page
    assert api.calls[0]["path"] == "/v1/listings"
    assert api.calls[0]["query"] == {
        "q": "holidays", "free_only": "true", "packet_only": "false", "asset_class": "PACKET_BUNDLE", "min_price": "0",
        "max_price": "900", "sort": "newest", "page": "2", "limit": "5", "industry_tag": "legal", "has_manifest_hash": "true",
    }


def test_catalog_calls_never_send_the_access_pass(api: FakeApi) -> None:
    api.route = lambda p, q, h: ok({"listings": [], "pagination": {"page": 1, "limit": 20, "total": 0}} if p == "/v1/listings" else {"id": "l1"})
    graunt = Graunt(base_url=api.base_url, access_pass=PASS)
    graunt.listings.search()
    graunt.listings.get("l1")
    graunt.meta.pricing()
    assert all("authorization" not in call["headers"] for call in api.calls)


def test_library_calls_send_the_pass_and_return_payloads(api: FakeApi) -> None:
    def route(path: str, q: Dict[str, str], h: Dict[str, str]) -> Reply:
        if path == "/v1/access-passes/resources":
            return ok({"resource_ids": ["r1", "r2"]})
        if path == "/v1/access-passes/resources/r%201":  # the path as sent: percent-encoded
            return ok({"id": "r 1", "listing_id": "l1"})
        if path == "/v1/access-passes/manifest":
            return ok({"pass": {"pass_id": "p"}, "active_entitlements": [], "active_subscriptions": [], "notice": "n"})
        return Reply({"ok": False, "error": {"code": "NOT_FOUND", "message": "no"}}, status=404)

    api.route = route
    library = Graunt(base_url=api.base_url, access_pass=PASS).library
    assert library.list() == ["r1", "r2"]
    assert library.get("r 1")["listing_id"] == "l1"
    assert library.manifest()["notice"] == "n"
    assert api.calls[1]["raw_path"] == "/v1/access-passes/resources/r%201"
    assert all(call["headers"]["authorization"] == f"Bearer {PASS}" for call in api.calls)


def test_a_malformed_pass_is_refused_and_never_echoed() -> None:
    bad = "gap_live_not-a-real-token-but-secret-looking-1234"
    with pytest.raises(ValueError) as caught:
        Graunt(access_pass=bad)
    assert bad not in str(caught.value)
    with pytest.raises(ValueError):
        Graunt(access_pass="grnt_agent_" + "a" * 64)


def test_repr_never_shows_the_pass() -> None:
    assert PASS not in repr(Graunt(access_pass=PASS))


def test_a_library_call_without_a_pass_fails_before_any_request(api: FakeApi) -> None:
    with pytest.raises(ValueError):
        Graunt(base_url=api.base_url).library.list()
    assert api.calls == []


def test_an_error_envelope_becomes_a_grauntError(api: FakeApi) -> None:
    api.route = lambda p, q, h: Reply({"ok": False, "error": {"code": "RATE_LIMITED", "message": "Slow down.", "details": {"bucket": "pass"}}}, status=429, headers={"Retry-After": "17"})
    with pytest.raises(GrauntError) as caught:
        Graunt(base_url=api.base_url).listings.get("x")
    err = caught.value
    assert (err.status, err.code, err.message, err.details, err.retry_after_seconds) == (429, "RATE_LIMITED", "Slow down.", {"bucket": "pass"}, 17)


def test_a_non_json_error_body_keeps_an_http_status_code(api: FakeApi) -> None:
    api.route = lambda p, q, h: Reply(raw=b"<html>bad gateway</html>", status=502, headers={"Content-Type": "text/html"})
    with pytest.raises(GrauntError) as caught:
        Graunt(base_url=api.base_url).meta.capabilities()
    assert caught.value.code == "HTTP_502"
    assert caught.value.retry_after_seconds is None


def test_a_200_without_the_envelope_is_unexpected_response(api: FakeApi) -> None:
    api.route = lambda p, q, h: Reply({"listings": []})
    with pytest.raises(GrauntError) as caught:
        Graunt(base_url=api.base_url).listings.search()
    assert caught.value.code == "UNEXPECTED_RESPONSE"


def test_a_refused_connection_is_a_connection_error_without_the_query() -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]  # closed again on exit: nothing listens there
    with pytest.raises(GrauntConnectionError) as caught:
        Graunt(base_url=f"http://127.0.0.1:{port}").listings.search(q="private search term")
    assert "private search term" not in str(caught.value)
    assert caught.value.__cause__ is not None


def test_the_timeout_ends_a_hung_request(api: FakeApi) -> None:
    api.route = lambda p, q, h: Reply({"ok": True, "data": {}}, delay=1.5)
    with pytest.raises(GrauntConnectionError) as caught:
        Graunt(base_url=api.base_url, timeout=0.2).meta.pricing()
    assert "timed out" in str(caught.value)


def test_manifest_returns_exact_bytes_their_sha256_and_only_graunt_headers(api: FakeApi) -> None:
    canonical = '{"b":1,"a":"é"}'.encode("utf-8")
    api.route = lambda p, q, h: Reply(raw=canonical, headers={"Content-Type": "application/json; charset=utf-8", "X-Graunt-Signature": "sig", "x-graunt-key-id": "k1", "Cache-Control": "public"})
    out = Graunt(base_url=api.base_url).listings.manifest("l1")
    assert api.calls[0]["path"] == "/v1/listings/l1/manifest"
    assert out.canonical_json.encode("utf-8") == canonical
    assert out.manifest == {"b": 1, "a": "é"}
    assert out.sha256 == hashlib.sha256(canonical).hexdigest()
    assert out.signature_headers == {"x-graunt-signature": "sig", "x-graunt-key-id": "k1"}


def test_a_listing_without_a_manifest_surfaces_no_manifest(api: FakeApi) -> None:
    api.route = lambda p, q, h: Reply({"ok": False, "error": {"code": "NO_MANIFEST", "message": "none"}}, status=404)
    with pytest.raises(GrauntError) as caught:
        Graunt(base_url=api.base_url).listings.manifest("l1")
    assert (caught.value.status, caught.value.code) == (404, "NO_MANIFEST")


def test_search_all_walks_pages_until_the_total(api: FakeApi) -> None:
    items = [{"id": f"l{i}", "dataset_name": "x", "category": "c", "price_cents": 0, "tags": []} for i in range(5)]

    def route(path: str, q: Dict[str, str], h: Dict[str, str]) -> Reply:
        page, limit = int(q["page"]), int(q["limit"])
        return ok({"listings": items[(page - 1) * limit : page * limit], "pagination": {"page": page, "limit": limit, "total": len(items)}})

    api.route = route
    seen = [listing["id"] for listing in Graunt(base_url=api.base_url).listings.search_all(limit=2)]
    assert seen == ["l0", "l1", "l2", "l3", "l4"]
    assert len(api.calls) == 3


def test_search_all_stops_on_an_empty_page(api: FakeApi) -> None:
    api.route = lambda p, q, h: ok({"listings": [], "pagination": {"page": 1, "limit": 2, "total": 99}})
    assert list(Graunt(base_url=api.base_url).listings.search_all()) == []
    assert len(api.calls) == 1
    with pytest.raises(TypeError):
        list(Graunt(base_url=api.base_url).listings.search_all(page=2))


def test_pass_calls_refuse_redirects_so_the_pass_never_leaves_the_origin(api: FakeApi) -> None:
    other = FakeApi()
    # The decoy answers like the real endpoint, so a client that followed the
    # redirect would succeed quietly instead of failing for an unrelated reason.
    other.route = lambda p, q, h: ok({"resource_ids": ["stolen"]})
    try:
        api.route = lambda p, q, h: Reply({}, status=302, headers={"Location": other.base_url + "/steal"})
        with pytest.raises(GrauntError) as caught:
            Graunt(base_url=api.base_url, access_pass=PASS).library.list()
        assert caught.value.status == 302
        assert other.calls == []  # the redirect target never saw a request, let alone the pass
    finally:
        other.close()


def test_base_url_is_normalised_and_validated_and_ids_are_encoded(api: FakeApi) -> None:
    api.route = lambda p, q, h: ok({"id": "a/b"})
    Graunt(base_url=api.base_url + "///").listings.get("a/b")
    assert api.calls[0]["raw_path"] == "/v1/listings/a%2Fb"
    for bad in ("not a url", "ftp://example.com"):
        with pytest.raises(ValueError):
            Graunt(base_url=bad)
    with pytest.raises(ValueError):
        Graunt(timeout=0)
    with pytest.raises(ValueError):
        Graunt(base_url=api.base_url).listings.get("")


def test_get_returns_any_public_body_unchanged(api: FakeApi) -> None:
    api.route = lambda p, q, h: ok({"anything": 1})
    assert Graunt(base_url=api.base_url).get("/v1/meta/search-contract", {"page": 1}) == {"ok": True, "data": {"anything": 1}}
    assert api.calls[0]["query"] == {"page": "1"}
    assert re.match(r"^/v1/meta/search-contract\?page=1$", api.calls[0]["raw_path"])
