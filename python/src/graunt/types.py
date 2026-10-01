"""Response shapes, as typed dictionaries.

From Graunt's OpenAPI document (https://api.graunt.com/openapi.json) and the
access-pass handlers. The client returns plain ``dict`` objects; these types are
for editors and type checkers. A field the API adds later is still in the dict.
"""

from __future__ import annotations

from typing import Any, List, Literal, Optional, TypedDict

AssetClass = Literal["DATASET", "TEXT_ASSET", "PACKET_BUNDLE"]
ListingSort = Literal["relevance", "price_asc", "price_desc", "newest"]


class _ListingSummaryRequired(TypedDict):
    id: str
    dataset_name: str
    category: str
    price_cents: int
    tags: List[str]


class ListingSummary(_ListingSummaryRequired, total=False):
    """One listing as search returns it."""

    asset_class: AssetClass
    file_format: str
    currency: Literal["usd"]
    is_free: bool
    acquisition_mode: Literal["PAID_ENTITLED", "AUTHENTICATED_FREE_ENTITLED", "PUBLIC_TOKEN_GRANT_FREE"]
    payment_required: bool
    registration_required: bool
    bundle_asset_count: Optional[int]
    bundle_total_bytes: Optional[int]
    created_at: str


class ListingDetail(ListingSummary, total=False):
    """A listing's full public detail."""

    dataset_description: str
    dataset_row_count: Optional[int]
    intended_uses: List[str]
    delivery_kind: Literal["SINGLE_FILE", "PACKET_BUNDLE"]
    content_excerpt: dict
    public_free_access: Optional[dict]
    commercial_terms: dict
    provenance: dict
    rights_passport: dict
    packet_bundle: Optional[dict]
    related_listings: List[Any]


class Pagination(TypedDict):
    page: int
    limit: int
    total: int


class ListingSearchResult(TypedDict):
    listings: List[ListingSummary]
    pagination: Pagination


class LibraryEntitlement(TypedDict, total=False):
    """One item an access pass can read."""

    id: str
    listing_id: str
    listing_title: str
    content_kind: str
    packet_kind: Optional[str]
    packet_family: Optional[str]
    delivery_kind: Literal["SINGLE_FILE", "PACKET_BUNDLE"]
    created_at: str
    rights_summary: dict
    provenance_summary: Optional[dict]
    packet_bundle: Optional[dict]
    supported_access_modes: List[str]
    access_pass_resource_url: str


# Functional form: "pass" is a Python keyword, so the class syntax cannot name it.
LibraryManifest = TypedDict(
    "LibraryManifest",
    {
        "pass": dict,
        "active_entitlements": List[LibraryEntitlement],
        "active_subscriptions": List[dict],
        "notice": str,
    },
    total=False,
)
"""The access pass's view of its library."""
