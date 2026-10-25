# graunt

Client for the [Graunt](https://graunt.com) API. Graunt is the agent-native marketplace for AI data.

```sh
npm install @graunt/sdk
```

Node.js 20 or later, or any runtime with `fetch` and Web Crypto. No runtime dependencies.

## Quickstart

```js
import { Graunt } from "@graunt/sdk";

const graunt = new Graunt();

const { listings, pagination } = await graunt.listings.search({ freeOnly: true, limit: 5 });
console.log(`${pagination.total} free listings`);

const listing = await graunt.listings.get(listings[0].id);
console.log(listing.dataset_name, listing.dataset_description);
```

Search takes the filters the API takes, in camelCase: `q`, `category`, `assetClass`, `fileFormat`, `dataPurpose`, `minPriceCents`, `maxPriceCents`, `freeOnly`, `packetOnly`, `tag`, `industryTag`, `sort`, `page` and `limit`. `extra` passes any other query parameter as written. `searchAll` walks every page:

```js
for await (const listing of graunt.listings.searchAll({ q: "sanctions" })) {
  console.log(listing.id, listing.dataset_name);
}
```

## Packet manifests

```js
const { manifest, canonicalJson, sha256, signatureHeaders } = await graunt.listings.manifest(listingId);
```

`sha256` is computed by this client over the exact bytes Graunt served, so you can compare it with a hash you already hold. `signatureHeaders` holds the `X-Graunt-*` headers that accompany a signed manifest. A listing without a packet manifest raises `GrauntError` with code `NO_MANIFEST`.

## Access passes

An access pass (`gap_live_` followed by 64 hex characters) reads your Graunt library. It is read-only and you can revoke it at any time. Create one from your library at [graunt.com/library](https://graunt.com/library); the token is shown once.

```js
const graunt = new Graunt({ accessPass: process.env.GRAUNT_ACCESS_PASS });

const library = await graunt.library.manifest();
for (const item of library.active_entitlements) {
  console.log(item.listing_title, item.delivery_kind);
}
```

A pass whose library is empty returns `[]` from `library.list()`, and `library.manifest()` raises `GrauntError` with code `ACCESS_PASS_LIBRARY_EMPTY`.

The client sends the pass only on `library` calls and only over https (plain http is accepted for localhost alone), refuses redirects on those calls so the pass reaches nothing but the configured origin, and never puts the pass in an error message or its `cause`.

## Errors

| Error | When | Fields |
|---|---|---|
| `GrauntError` | The API answered with an error status. | `status`, `code` (for example `NOT_FOUND` or `RATE_LIMITED`), `message`, `details`, `retryAfterSeconds` |
| `GrauntConnectionError` | No response: DNS, connection, TLS, or the timeout. | `message`, `cause` |

```js
import { GrauntError } from "@graunt/sdk";

try {
  await graunt.listings.get("not-a-listing");
} catch (err) {
  if (err instanceof GrauntError && err.status === 404) console.log("no such listing");
  else throw err;
}
```

## Options

| Option | Default | |
|---|---|---|
| `baseUrl` | `https://api.graunt.com` | API origin. |
| `accessPass` | none | Read-only pass for the `library` methods. |
| `timeoutMs` | `30000` | Per-request timeout. |
| `fetch` | global `fetch` | Any `fetch`-compatible function. |

## API

| Method | Endpoint |
|---|---|
| `listings.search(params)` | `GET /v1/listings` |
| `listings.searchAll(params)` | `GET /v1/listings`, every page |
| `listings.get(id)` | `GET /v1/listings/{id}` |
| `listings.manifest(id)` | `GET /v1/listings/{id}/manifest` |
| `meta.capabilities()` | `GET /v1/meta/capabilities` |
| `meta.pricing()` | `GET /v1/meta/pricing` |
| `library.manifest()` | `GET /v1/access-passes/manifest` |
| `library.list()` | `GET /v1/access-passes/resources` |
| `library.get(resourceId)` | `GET /v1/access-passes/resources/{resource_id}` |
| `get(path, query)` | Any public `GET`; the body is returned unchanged. |

The full API is described at [api.graunt.com/openapi.json](https://api.graunt.com/openapi.json).

## License

MIT
