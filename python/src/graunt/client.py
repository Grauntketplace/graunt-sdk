"""Client for the Graunt API."""

from __future__ import annotations

import hashlib
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Mapping, Optional, Tuple, cast

from ._version import __version__
from .errors import GrauntConnectionError, GrauntError
from .types import (
    LibraryEntitlement,
    LibraryManifest,
    ListingDetail,
    ListingSearchResult,
    ListingSummary,
)

DEFAULT_BASE_URL = "https://api.graunt.com"
DEFAULT_TIMEOUT = 30.0
# The shape the API itself enforces before any lookup.
_ACCESS_PASS = re.compile(r"^gap_live_[0-9a-fA-F]{64}$")


@dataclass(frozen=True)
class PacketManifest:
    """A packet manifest exactly as Graunt serves it."""

    #: The parsed manifest.
    manifest: Dict[str, Any]
    #: The canonical JSON text, byte-for-byte as served.
    canonical_json: str
    #: Lowercase hex SHA-256 of the canonical bytes, computed by this client.
    sha256: str
    #: The ``x-graunt-*`` headers that accompany a signed manifest, lowercased.
    signature_headers: Dict[str, str] = field(default_factory=dict)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuses every redirect. urllib would otherwise forward Authorization to the target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None


_PUBLIC_OPENER = urllib.request.build_opener()
_PASS_OPENER = urllib.request.build_opener(_NoRedirect())


class Graunt:
    """Client for the Graunt API.

    >>> graunt = Graunt()
    >>> page = graunt.listings.search(q="holidays", free_only=True)
    """

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        access_pass: Optional[str] = None,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        base = base_url.rstrip("/")
        parts = urllib.parse.urlsplit(base)
        if parts.scheme not in ("http", "https") or not parts.netloc:
            raise ValueError("base_url must be an absolute http(s) URL.")
        if access_pass is not None and not _ACCESS_PASS.match(access_pass):
            # The value is deliberately left out of the message: it is a credential.
            raise ValueError("access_pass must be a Graunt access pass: gap_live_ followed by 64 hex characters.")
        if not timeout > 0:
            raise ValueError("timeout must be a positive number of seconds.")
        self._base_url = base
        self._access_pass = access_pass
        self._timeout = float(timeout)
        #: Public catalog: search, listing detail and packet manifests.
        self.listings = Listings(self)
        #: Machine-readable facts about the marketplace.
        self.meta = Meta(self)
        #: What the access pass can read. Every call sends the pass; it never writes.
        self.library = Library(self)

    def __repr__(self) -> str:
        # Never print the pass itself.
        return f"Graunt(base_url={self._base_url!r}, access_pass={'<set>' if self._access_pass else None})"

    def get(self, path: str, query: Optional[Mapping[str, Any]] = None) -> Any:
        """GET any public endpoint and return its parsed JSON body unchanged."""
        status, _headers, body = self._send(path, query=query)
        return _parse_json(status, body, path)

    # -- plumbing ---------------------------------------------------------

    def _send(
        self,
        path: str,
        *,
        query: Optional[Mapping[str, Any]] = None,
        use_pass: bool = False,
    ) -> Tuple[int, Dict[str, str], bytes]:
        if not path.startswith("/"):
            raise ValueError("path must start with /")
        url = self._base_url + path
        params = {key: _query_value(value) for key, value in (query or {}).items() if value is not None}
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"Accept": "application/json", "User-Agent": f"graunt-python/{__version__}"}
        if use_pass:
            if self._access_pass is None:
                raise ValueError("This call needs an access pass: Graunt(access_pass='gap_live_...').")
            headers["Authorization"] = f"Bearer {self._access_pass}"
        # Errors name the origin and path only: a query can carry a search term.
        where = self._base_url + path
        request = urllib.request.Request(url, headers=headers, method="GET")
        opener = _PASS_OPENER if use_pass else _PUBLIC_OPENER
        try:
            with opener.open(request, timeout=self._timeout) as response:
                return response.status, _lower(response.headers.items()), response.read()
        except urllib.error.HTTPError as err:
            raise _to_error(err) from None
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            reason = getattr(err, "reason", err)
            raise GrauntConnectionError(f"GET {where} failed: {_describe(reason)}") from err

    def _data(self, path: str, *, query: Optional[Mapping[str, Any]] = None, use_pass: bool = False) -> Any:
        status, _headers, body = self._send(path, query=query, use_pass=use_pass)
        parsed = _parse_json(status, body, path)
        if isinstance(parsed, dict) and parsed.get("ok") is True and "data" in parsed:
            return parsed["data"]
        raise GrauntError(
            status=status,
            code="UNEXPECTED_RESPONSE",
            message=f"GET {path} did not return Graunt's {{ok: true, data}} envelope.",
        )


class Listings:
    """Public catalog: search, listing detail and packet manifests. No credential needed."""

    def __init__(self, client: Graunt) -> None:
        self._client = client

    def search(
        self,
        *,
        q: Optional[str] = None,
        category: Optional[str] = None,
        asset_class: Optional[str] = None,
        file_format: Optional[str] = None,
        data_purpose: Optional[str] = None,
        min_price_cents: Optional[int] = None,
        max_price_cents: Optional[int] = None,
        free_only: Optional[bool] = None,
        packet_only: Optional[bool] = None,
        tag: Optional[str] = None,
        industry_tag: Optional[str] = None,
        sort: Optional[str] = None,
        page: Optional[int] = None,
        limit: Optional[int] = None,
        extra: Optional[Mapping[str, Any]] = None,
    ) -> ListingSearchResult:
        """Search active listings. Returns one page: ``{"listings": [...], "pagination": {...}}``.

        Prices are integer cents. ``limit`` is 1 to 100 (the API defaults to 20).
        ``extra`` passes any other query parameter the search endpoint accepts.
        """
        query: Dict[str, Any] = dict(extra or {})
        typed = {
            "q": q,
            "category": category,
            "asset_class": asset_class,
            "file_format": file_format,
            "data_purpose": data_purpose,
            "min_price": min_price_cents,
            "max_price": max_price_cents,
            "free_only": free_only,
            "packet_only": packet_only,
            "tag": tag,
            "industry_tag": industry_tag,
            "sort": sort,
            "page": page,
            "limit": limit,
        }
        query.update({key: value for key, value in typed.items() if value is not None})
        return cast(ListingSearchResult, self._client._data("/v1/listings", query=query))

    def search_all(self, **filters: Any) -> Iterator[ListingSummary]:
        """Every listing that matches, page after page, until the reported total is reached.

        Takes the same keyword filters as :meth:`search`, except ``page``.
        """
        if "page" in filters:
            raise TypeError("search_all walks every page itself; do not pass page.")
        page = 1
        seen = 0
        while True:
            result = self.search(page=page, **filters)
            listings = result["listings"]
            yield from listings
            seen += len(listings)
            if not listings or seen >= result["pagination"]["total"]:
                return
            page += 1

    def get(self, listing_id: str) -> ListingDetail:
        """One listing's full public detail."""
        return cast(ListingDetail, self._client._data(f"/v1/listings/{_segment(listing_id, 'listing_id')}"))

    def manifest(self, listing_id: str) -> PacketManifest:
        """A packet listing's canonical manifest, with the SHA-256 of the exact bytes served.

        A listing without a packet manifest raises :class:`GrauntError` with code ``NO_MANIFEST``.
        """
        path = f"/v1/listings/{_segment(listing_id, 'listing_id')}/manifest"
        status, headers, body = self._client._send(path)
        canonical = body.decode("utf-8")
        try:
            manifest = json.loads(canonical)
        except ValueError:
            raise GrauntError(status=status, code="UNEXPECTED_RESPONSE", message="The manifest is not JSON.") from None
        if not isinstance(manifest, dict):
            raise GrauntError(status=status, code="UNEXPECTED_RESPONSE", message="The manifest is not a JSON object.")
        signature = {name: value for name, value in headers.items() if name.startswith("x-graunt-")}
        return PacketManifest(
            manifest=manifest,
            canonical_json=canonical,
            sha256=hashlib.sha256(body).hexdigest(),
            signature_headers=signature,
        )


class Meta:
    """Machine-readable facts about the marketplace. No credential needed."""

    def __init__(self, client: Graunt) -> None:
        self._client = client

    def capabilities(self) -> Dict[str, Any]:
        """The capabilities Graunt offers today."""
        return cast(Dict[str, Any], self._client._data("/v1/meta/capabilities"))

    def pricing(self) -> Dict[str, Any]:
        """The platform pricing schedule."""
        return cast(Dict[str, Any], self._client._data("/v1/meta/pricing"))


class Library:
    """What an access pass can read. Every call sends the pass; it never writes."""

    def __init__(self, client: Graunt) -> None:
        self._client = client

    def manifest(self) -> LibraryManifest:
        """The pass, its scope, and every item it can read."""
        return cast(LibraryManifest, self._client._data("/v1/access-passes/manifest", use_pass=True))

    def list(self) -> List[str]:
        """The resource IDs the pass can read."""
        data = self._client._data("/v1/access-passes/resources", use_pass=True)
        return list(data["resource_ids"])

    def get(self, resource_id: str) -> LibraryEntitlement:
        """One readable item. An item outside the pass raises a 404 :class:`GrauntError`."""
        path = f"/v1/access-passes/resources/{_segment(resource_id, 'resource_id')}"
        return cast(LibraryEntitlement, self._client._data(path, use_pass=True))


def _segment(value: str, name: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError(f"{name} must be a non-empty string.")
    return urllib.parse.quote(value, safe="")


def _query_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _lower(items: Any) -> Dict[str, str]:
    return {str(name).lower(): str(value) for name, value in items}


def _parse_json(status: int, body: bytes, path: str) -> Any:
    try:
        return json.loads(body.decode("utf-8"))
    except ValueError:
        raise GrauntError(status=status, code="UNEXPECTED_RESPONSE", message=f"GET {path} returned a body that is not JSON.") from None


def _to_error(err: urllib.error.HTTPError) -> GrauntError:
    status = err.code
    code = f"HTTP_{status}"
    message = err.reason if isinstance(err.reason, str) and err.reason else f"HTTP {status}"
    details: Optional[Dict[str, Any]] = None
    try:
        body = json.loads(err.read().decode("utf-8"))
    except (ValueError, OSError):
        body = None  # A body that is not JSON keeps the HTTP_<status> code.
    if isinstance(body, dict) and isinstance(body.get("error"), dict):
        error = body["error"]
        if isinstance(error.get("code"), str):
            code = error["code"]
        if isinstance(error.get("message"), str):
            message = error["message"]
        if isinstance(error.get("details"), dict):
            details = error["details"]
    retry_after = err.headers.get("Retry-After") if err.headers is not None else None
    retry_after_seconds = int(retry_after.strip()) if retry_after and retry_after.strip().isdigit() else None
    return GrauntError(status=status, code=code, message=message, details=details, retry_after_seconds=retry_after_seconds)


def _describe(reason: Any) -> str:
    if isinstance(reason, TimeoutError) or "timed out" in str(reason):
        return "timed out"
    return str(reason)
