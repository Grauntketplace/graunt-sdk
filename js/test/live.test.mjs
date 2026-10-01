// Live checks against the production API. They run the README's quickstart for
// real, so a release never ships a quickstart that does not work. Opt in with
// GRAUNT_LIVE=1 (CI sets it); GRAUNT_BASE_URL points them elsewhere.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Graunt } from "../dist/index.js";

const live = process.env.GRAUNT_LIVE === "1";
const graunt = new Graunt({ baseUrl: process.env.GRAUNT_BASE_URL || undefined });

test("quickstart: search free listings, then fetch the first one", { skip: !live }, async () => {
  const { listings, pagination } = await graunt.listings.search({ freeOnly: true, limit: 5 });
  assert.ok(listings.length > 0, "production returned no free listings");
  assert.ok(pagination.total >= listings.length);
  const first = listings[0];
  assert.equal(typeof first.id, "string");
  assert.equal(first.price_cents, 0);
  const detail = await graunt.listings.get(first.id);
  assert.equal(detail.id, first.id);
  assert.equal(typeof detail.dataset_name, "string");
});

test("a packet listing's manifest hashes to 64 hex characters", { skip: !live }, async (t) => {
  const { listings } = await graunt.listings.search({ packetOnly: true, limit: 10 });
  if (listings.length === 0) return t.skip("no packet listings in production");
  let checked = 0;
  for (const listing of listings) {
    try {
      const m = await graunt.listings.manifest(listing.id);
      assert.match(m.sha256, /^[0-9a-f]{64}$/);
      assert.equal(typeof m.manifest, "object");
      checked += 1;
      break;
    } catch (err) {
      if (err?.code !== "NO_MANIFEST") throw err;
    }
  }
  if (checked === 0) t.skip("no listing in the first page carries a manifest");
});

test("capabilities and pricing answer with objects", { skip: !live }, async () => {
  assert.equal(typeof (await graunt.meta.capabilities()), "object");
  assert.equal(typeof (await graunt.meta.pricing()), "object");
});
