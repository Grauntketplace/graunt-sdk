# Graunt SDK

Clients for the [Graunt](https://graunt.com) API. Graunt is the marketplace for agent-ready data.

| Language | Package | Install | Docs |
|---|---|---|---|
| JavaScript and TypeScript | [`@graunt/sdk` on npm](https://www.npmjs.com/package/@graunt/sdk) | `npm install @graunt/sdk` | [js/README.md](js/README.md) |
| Python | [`graunt` on PyPI](https://pypi.org/project/graunt/) | `pip install graunt` | [python/README.md](python/README.md) |

Both clients cover the same surface:

- **Catalog**, no credential: search listings, fetch a listing's public detail, and read a packet listing's canonical manifest with the SHA-256 of the exact bytes served.
- **Meta**, no credential: the capabilities Graunt offers and the pricing schedule.
- **Library**, with a read-only access pass: the pass's library manifest, its resource IDs and each resource's detail.

The full API is described at [api.graunt.com/openapi.json](https://api.graunt.com/openapi.json), and the agent-facing summary is at [graunt.com/llms.txt](https://graunt.com/llms.txt).

Releases are published from this repository's `release.yml` workflow through npm and PyPI trusted publishing; npm attaches provenance to every version. See [RELEASING.md](RELEASING.md).

## License

MIT
