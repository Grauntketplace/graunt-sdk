# graunt

Client for the [Graunt](https://graunt.com) API. Graunt is the marketplace for agent-ready data.

```sh
pip install graunt
```

Python 3.10 or later, with no dependencies outside Python's own standard library.

## Quickstart

```python
from graunt import Graunt

graunt = Graunt()

page = graunt.listings.search(free_only=True, limit=5)
print(page["pagination"]["total"], "free listings")

listing = graunt.listings.get(page["listings"][0]["id"])
print(listing["dataset_name"], listing.get("dataset_description"))
```

Search takes the filters the API takes: `q`, `category`, `asset_class`, `file_format`, `data_purpose`, `min_price_cents`, `max_price_cents`, `free_only`, `packet_only`, `tag`, `industry_tag`, `sort`, `page` and `limit`. `extra` passes any other query parameter as written. `search_all` walks every page:

```python
for listing in graunt.listings.search_all(q="sanctions"):
    print(listing["id"], listing["dataset_name"])
```

## Packet manifests

```python
m = graunt.listings.manifest(listing_id)
m.manifest            # the parsed manifest
m.canonical_json      # the exact text served
m.sha256              # SHA-256 of the exact bytes served, computed by this client
m.signature_headers   # the x-graunt-* headers of a signed manifest
```

Compare `sha256` with a hash you already hold. A listing without a packet manifest raises `GrauntError` with code `NO_MANIFEST`.

## Access passes

An access pass (`gap_live_` followed by 64 hex characters) reads your Graunt library. It is read-only and you can revoke it at any time. Create one from your library at [graunt.com/library](https://graunt.com/library); the token is shown once.

```python
import os
from graunt import Graunt

graunt = Graunt(access_pass=os.environ["GRAUNT_ACCESS_PASS"])

library = graunt.library.manifest()
for item in library["active_entitlements"]:
    print(item["listing_title"], item["delivery_kind"])
```

A pass whose library is empty returns `[]` from `library.list()`, and `library.manifest()` raises `GrauntError` with code `ACCESS_PASS_LIBRARY_EMPTY`.

The client sends the pass only on `library` calls and only over https (plain http is accepted for localhost alone), refuses redirects on those calls so the pass reaches nothing but the configured origin, and never puts the pass in an error message or in `repr()`.

## Errors

| Error | When | Attributes |
|---|---|---|
| `GrauntError` | The API answered with an error status. | `status`, `code` (for example `NOT_FOUND` or `RATE_LIMITED`), `message`, `details`, `retry_after_seconds` |
| `GrauntConnectionError` | No response: DNS, connection, TLS, or the timeout. | the cause is chained as `__cause__` |

```python
from graunt import GrauntError

try:
    graunt.listings.get("not-a-listing")
except GrauntError as err:
    if err.status != 404:
        raise
    print("no such listing")
```

## Options

| Argument | Default | |
|---|---|---|
| `base_url` | `https://api.graunt.com` | API origin. |
| `access_pass` | `None` | Read-only pass for the `library` methods. |
| `timeout` | `30.0` | Per-request timeout in seconds. |

## API

| Method | Endpoint |
|---|---|
| `listings.search(**filters)` | `GET /v1/listings` |
| `listings.search_all(**filters)` | `GET /v1/listings`, every page |
| `listings.get(listing_id)` | `GET /v1/listings/{id}` |
| `listings.manifest(listing_id)` | `GET /v1/listings/{id}/manifest` |
| `meta.capabilities()` | `GET /v1/meta/capabilities` |
| `meta.pricing()` | `GET /v1/meta/pricing` |
| `library.manifest()` | `GET /v1/access-passes/manifest` |
| `library.list()` | `GET /v1/access-passes/resources` |
| `library.get(resource_id)` | `GET /v1/access-passes/resources/{resource_id}` |
| `get(path, query)` | Any public `GET`; the body is returned unchanged. |

The full API is described at [api.graunt.com/openapi.json](https://api.graunt.com/openapi.json).

## License

MIT
