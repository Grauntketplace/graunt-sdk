"""Live checks against the production API: the README's quickstart, run for real.

Opt in with GRAUNT_LIVE=1 (CI sets it); GRAUNT_BASE_URL points them elsewhere.
"""

from __future__ import annotations

import os
import re

import pytest

from graunt import DEFAULT_BASE_URL, Graunt, GrauntError

pytestmark = pytest.mark.skipif(os.environ.get("GRAUNT_LIVE") != "1", reason="set GRAUNT_LIVE=1 to run against the live API")

graunt = Graunt(base_url=os.environ.get("GRAUNT_BASE_URL") or DEFAULT_BASE_URL)


def test_quickstart_search_free_listings_then_fetch_the_first() -> None:
    page = graunt.listings.search(free_only=True, limit=5)
    assert page["listings"], "production returned no free listings"
    assert page["pagination"]["total"] >= len(page["listings"])
    first = page["listings"][0]
    assert first["price_cents"] == 0
    detail = graunt.listings.get(first["id"])
    assert detail["id"] == first["id"]
    assert isinstance(detail["dataset_name"], str)


def test_a_packet_listings_manifest_hashes_to_64_hex() -> None:
    listings = graunt.listings.search(packet_only=True, limit=10)["listings"]
    if not listings:
        pytest.skip("no packet listings in production")
    for listing in listings:
        try:
            manifest = graunt.listings.manifest(listing["id"])
        except GrauntError as err:
            if err.code == "NO_MANIFEST":
                continue
            raise
        assert re.fullmatch(r"[0-9a-f]{64}", manifest.sha256)
        assert isinstance(manifest.manifest, dict)
        return
    pytest.skip("no listing in the first page carries a manifest")


def test_capabilities_and_pricing_answer_with_objects() -> None:
    assert isinstance(graunt.meta.capabilities(), dict)
    assert isinstance(graunt.meta.pricing(), dict)
