# Releasing

Every release publishes `graunt` to npm and PyPI from [`release.yml`](.github/workflows/release.yml) through trusted publishing (OIDC). No long-lived registry token lives in this repository, and npm attaches provenance to each version.

## One-time setup

### GitHub

Settings → Environments: create `npm` and `pypi`. For each, under **Deployment branches and tags**, allow only tags matching `v*`.

### PyPI

PyPI creates the project on its first trusted publish, through a pending publisher. Sign in at [pypi.org](https://pypi.org) with two-factor authentication, open **Your account → Publishing**, and add a pending GitHub publisher:

| Field | Value |
|---|---|
| PyPI project name | `graunt` |
| Owner | `Grauntketplace` |
| Repository name | `graunt-sdk` |
| Workflow name | `release.yml` |
| Environment name | `pypi` |

### npm

npm attaches a trusted publisher only to a package that already exists, so the first version is published with a short-lived token and every later version through OIDC.

1. Sign in at [npmjs.com](https://www.npmjs.com) with two-factor authentication. **Access Tokens → Generate New Token → Granular Access Token**: read and write on packages, expiry 7 days.
2. Settings → Environments → `npm` → add the secret `NPM_TOKEN` with that token.
3. Cut the first release (below).
4. On npmjs.com, open **graunt → Settings → Trusted Publisher → GitHub Actions** and enter: organization `Grauntketplace`, repository `graunt-sdk`, workflow filename `release.yml`, environment `npm`. Then set **Publishing access** to require two-factor authentication and disallow tokens.
5. Delete the `NPM_TOKEN` secret and revoke the token on npmjs.com.

## Cutting a release

1. Set the same version in all four places: `js/package.json`, `js/src/version.ts`, `python/pyproject.toml` and `python/src/graunt/_version.py`. The unit tests fail when a constant disagrees with its manifest, and the release workflow refuses a tag that disagrees with any of them.
2. Merge to `main` with CI green.
3. Publish a GitHub release with the tag `v<version>` (for example `v0.1.0`) on `main`.
4. The workflow runs both clients' unit tests and the live quickstart against api.graunt.com, then publishes both packages. When a check fails, nothing is published.

Published versions are permanent on both registries. A mistake is corrected by publishing a new version.
