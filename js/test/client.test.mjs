// Unit tests against the built package (dist/), with an injected fetch.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { Graunt, GrauntConnectionError, GrauntError, VERSION } from "../dist/index.js";

const PASS = `gap_live_${"ab12".repeat(16)}`;
const json = (body, init = {}) => ({ body: JSON.stringify(body), status: 200, headers: { "content-type": "application/json" }, ...init });

/** A fetch that records every call and answers from `route(url, init)`. */
function fakeFetch(route) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: new URL(String(url)), init });
    const r = await route(new URL(String(url)), init);
    return new Response(r.body, { status: r.status ?? 200, headers: r.headers ?? {} });
  };
  f.calls = calls;
  return f;
}

test("VERSION matches package.json and is sent as the User-Agent", async () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(VERSION, pkg.version);
  const fetch = fakeFetch(() => json({ ok: true, data: { listings: [], pagination: { page: 1, limit: 20, total: 0 } } }));
  await new Graunt({ fetch }).listings.search();
  assert.equal(fetch.calls[0].init.headers["user-agent"], `graunt-js/${VERSION}`);
});

test("search maps camelCase filters to the API's query names and unwraps data", async () => {
  const page = { listings: [{ id: "l1", dataset_name: "A", category: "c", price_cents: 0, tags: [] }], pagination: { page: 2, limit: 5, total: 6 } };
  const fetch = fakeFetch(() => json({ ok: true, data: page }));
  const out = await new Graunt({ fetch }).listings.search({
    q: "holidays", freeOnly: true, packetOnly: false, assetClass: "PACKET_BUNDLE", minPriceCents: 0, maxPriceCents: 900,
    sort: "newest", page: 2, limit: 5, industryTag: "legal", extra: { has_manifest_hash: "true", q: "overridden" },
  });
  assert.deepEqual(out, page);
  const { url } = fetch.calls[0];
  assert.equal(url.origin + url.pathname, "https://api.graunt.com/v1/listings");
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    q: "holidays", free_only: "true", packet_only: "false", asset_class: "PACKET_BUNDLE", min_price: "0", max_price: "900",
    sort: "newest", page: "2", limit: "5", industry_tag: "legal", has_manifest_hash: "true",
  });
});

test("catalog calls never send the access pass, even when one is configured", async () => {
  const fetch = fakeFetch((url) =>
    url.pathname === "/v1/listings"
      ? json({ ok: true, data: { listings: [], pagination: { page: 1, limit: 20, total: 0 } } })
      : json({ ok: true, data: { id: "l1" } }),
  );
  const graunt = new Graunt({ fetch, accessPass: PASS });
  await graunt.listings.search();
  await graunt.listings.get("l1");
  await graunt.meta.pricing();
  for (const call of fetch.calls) assert.equal(call.init.headers.authorization, undefined);
});

test("library calls send the pass as a Bearer token and return the payloads", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname === "/v1/access-passes/resources") return json({ ok: true, data: { resource_ids: ["r1", "r2"] } });
    if (url.pathname === "/v1/access-passes/resources/r%201") return json({ ok: true, data: { id: "r 1", listing_id: "l1" } });
    if (url.pathname === "/v1/access-passes/manifest") return json({ ok: true, data: { pass: { pass_id: "p" }, active_entitlements: [], active_subscriptions: [], notice: "n" } });
    return json({ ok: false, error: { code: "NOT_FOUND", message: "no" } }, { status: 404 });
  });
  const library = new Graunt({ fetch, accessPass: PASS }).library;
  assert.deepEqual(await library.list(), ["r1", "r2"]);
  assert.equal((await library.get("r 1")).listing_id, "l1");
  assert.equal((await library.manifest()).notice, "n");
  for (const call of fetch.calls) {
    assert.equal(call.init.headers.authorization, `Bearer ${PASS}`);
    // The pass can only reach the configured origin: redirects are refused.
    assert.equal(call.init.redirect, "error");
  }
});

test("catalog calls follow redirects; they carry no credential", async () => {
  const fetch = fakeFetch(() => json({ ok: true, data: {} }));
  await new Graunt({ fetch, accessPass: PASS }).meta.capabilities();
  assert.equal(fetch.calls[0].init.redirect, "follow");
});

test("a malformed access pass is refused at construction, and its value is never echoed", () => {
  const bad = "gap_live_not-a-real-token-but-secret-looking-1234";
  assert.throws(() => new Graunt({ accessPass: bad }), (err) => err instanceof TypeError && !err.message.includes(bad));
  assert.throws(() => new Graunt({ accessPass: `grnt_agent_${"a".repeat(64)}` }), TypeError);
});

test("a library call without a pass fails before any request is made", async () => {
  const fetch = fakeFetch(() => json({ ok: true, data: {} }));
  await assert.rejects(new Graunt({ fetch }).library.list(), TypeError);
  assert.equal(fetch.calls.length, 0);
});

test("an error envelope becomes a GrauntError with status, code, message, details and Retry-After", async () => {
  const fetch = fakeFetch(() =>
    json({ ok: false, error: { code: "RATE_LIMITED", message: "Slow down.", details: { bucket: "pass" } } }, {
      status: 429, headers: { "content-type": "application/json", "retry-after": "17" },
    }),
  );
  const err = await new Graunt({ fetch }).listings.get("x").catch((e) => e);
  assert.ok(err instanceof GrauntError);
  assert.equal(err.status, 429);
  assert.equal(err.code, "RATE_LIMITED");
  assert.equal(err.message, "Slow down.");
  assert.deepEqual(err.details, { bucket: "pass" });
  assert.equal(err.retryAfterSeconds, 17);
});

test("a non-JSON error body keeps an HTTP_<status> code", async () => {
  const fetch = fakeFetch(() => ({ body: "<html>bad gateway</html>", status: 502, headers: { "content-type": "text/html" } }));
  const err = await new Graunt({ fetch }).meta.capabilities().catch((e) => e);
  assert.ok(err instanceof GrauntError);
  assert.equal(err.code, "HTTP_502");
  assert.equal(err.retryAfterSeconds, undefined);
});

test("a 200 without the success envelope is UNEXPECTED_RESPONSE", async () => {
  const fetch = fakeFetch(() => json({ listings: [] }));
  const err = await new Graunt({ fetch }).listings.search().catch((e) => e);
  assert.ok(err instanceof GrauntError);
  assert.equal(err.code, "UNEXPECTED_RESPONSE");
});

test("a network failure is a GrauntConnectionError carrying the cause, without the query string", async () => {
  const boom = new Error("getaddrinfo ENOTFOUND api.graunt.com");
  const fetch = fakeFetch(() => { throw boom; });
  const err = await new Graunt({ fetch }).listings.search({ q: "private search term" }).catch((e) => e);
  assert.ok(err instanceof GrauntConnectionError);
  assert.equal(err.cause, boom);
  assert.ok(!err.message.includes("private search term"));
});

test("the timeout aborts a hung request as a GrauntConnectionError", async () => {
  // AbortSignal.timeout's timer is unref'd (a finished request never holds the
  // process open). A real request's socket keeps the loop alive; this fake
  // holds a ref'd timer in its place until the abort arrives.
  const fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      const keepAlive = setTimeout(() => {}, 10_000);
      init.signal.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(init.signal.reason);
      });
    });
  const err = await new Graunt({ fetch, timeoutMs: 20 }).meta.pricing().catch((e) => e);
  assert.ok(err instanceof GrauntConnectionError);
  assert.match(err.message, /timed out/);
});

test("manifest returns the exact bytes served, their SHA-256 and only the X-Graunt-* headers", async () => {
  const canonical = '{"b":1,"a":"é"}';
  const fetch = fakeFetch(() => ({
    body: canonical,
    headers: { "content-type": "application/json; charset=utf-8", "X-Graunt-Signature": "sig", "x-graunt-key-id": "k1", "cache-control": "public" },
  }));
  const out = await new Graunt({ fetch }).listings.manifest("l1");
  assert.equal(fetch.calls[0].url.pathname, "/v1/listings/l1/manifest");
  assert.equal(out.canonicalJson, canonical);
  assert.deepEqual(out.manifest, { b: 1, a: "é" });
  assert.equal(out.sha256, createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex"));
  assert.deepEqual(out.signatureHeaders, { "x-graunt-signature": "sig", "x-graunt-key-id": "k1" });
});

test("a listing without a manifest surfaces the API's NO_MANIFEST code", async () => {
  const fetch = fakeFetch(() => json({ ok: false, error: { code: "NO_MANIFEST", message: "none" } }, { status: 404 }));
  const err = await new Graunt({ fetch }).listings.manifest("l1").catch((e) => e);
  assert.equal(err.code, "NO_MANIFEST");
  assert.equal(err.status, 404);
});

test("searchAll walks pages until the reported total, then stops", async () => {
  const all = Array.from({ length: 5 }, (_, i) => ({ id: `l${i}`, dataset_name: "x", category: "c", price_cents: 0, tags: [] }));
  const fetch = fakeFetch((url) => {
    const page = Number(url.searchParams.get("page"));
    const limit = Number(url.searchParams.get("limit"));
    return json({ ok: true, data: { listings: all.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: all.length } } });
  });
  const seen = [];
  for await (const listing of new Graunt({ fetch }).listings.searchAll({ limit: 2 })) seen.push(listing.id);
  assert.deepEqual(seen, ["l0", "l1", "l2", "l3", "l4"]);
  assert.equal(fetch.calls.length, 3);
});

test("searchAll stops on an empty page even if the total says otherwise", async () => {
  const fetch = fakeFetch(() => json({ ok: true, data: { listings: [], pagination: { page: 1, limit: 2, total: 99 } } }));
  const seen = [];
  for await (const listing of new Graunt({ fetch }).listings.searchAll()) seen.push(listing);
  assert.equal(seen.length, 0);
  assert.equal(fetch.calls.length, 1);
});

test("baseUrl is normalised and validated; ids are path-encoded", async () => {
  const fetch = fakeFetch(() => json({ ok: true, data: { id: "a/b" } }));
  await new Graunt({ fetch, baseUrl: "https://api-staging.graunt.com///" }).listings.get("a/b");
  assert.equal(fetch.calls[0].url.href, "https://api-staging.graunt.com/v1/listings/a%2Fb");
  assert.throws(() => new Graunt({ baseUrl: "not a url" }), TypeError);
  assert.throws(() => new Graunt({ baseUrl: "ftp://example.com" }), TypeError);
  assert.throws(() => new Graunt({ timeoutMs: 0 }), TypeError);
  await assert.rejects(new Graunt({ fetch }).listings.get(""), TypeError);
});

test("get() returns any public endpoint's body unchanged", async () => {
  const fetch = fakeFetch(() => json({ ok: true, data: { anything: 1 } }));
  const body = await new Graunt({ fetch }).get("/v1/meta/search-contract", { page: 1 });
  assert.deepEqual(body, { ok: true, data: { anything: 1 } });
  assert.equal(fetch.calls[0].url.search, "?page=1");
});
