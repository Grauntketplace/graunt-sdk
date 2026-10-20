# Releasing

Every release publishes `@graunt/sdk` to npm and `graunt` to PyPI from [`release.yml`](.github/workflows/release.yml) through trusted publishing (OIDC). No long-lived registry token lives in this repository, and npm attaches provenance to each version.

## One-time setup

### GitHub

Settings → Environments: create `npm` and `pypi`. For each, under **Deployment branches and tags**, allow only tags matching `v*`.

Settings → Rules → Rulesets: one ruleset keeps `main` from being deleted or force-pushed, and another keeps every `v*` tag from being deleted or moved, so a published version always points at the commit it was built from.

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

npm attaches a trusted publisher only to a package that already exists, so the first version is published with a short-lived token and every later version through OIDC. npm refuses the unscoped name `graunt` as too close to `grunt`, so the npm package lives under the `graunt` account's own scope.

1. Sign in at [npmjs.com](https://www.npmjs.com) with two-factor authentication. **Access Tokens → Generate New Token → Granular Access Token**: read and write on packages, **Bypass two-factor authentication** ticked (CI cannot answer a one-time code), expiry 7 days.
2. Settings → Environments → `npm` → add the secret `NPM_TOKEN` with that token.
3. Cut the first release (below).
4. On npmjs.com, open **@graunt/sdk → Settings → Trusted Publisher → GitHub Actions** and enter: organization `Grauntketplace`, repository `graunt-sdk`, workflow filename `release.yml`, environment `npm`. Then set **Publishing access** to require two-factor authentication and disallow tokens.
5. Delete the `NPM_TOKEN` secret and revoke the token on npmjs.com. From the next release on, the workflow configures no token and publishes through OIDC alone.

## Cutting a release

1. Set the same version in all four places: `js/package.json`, `js/src/version.ts`, `python/pyproject.toml` and `python/src/graunt/_version.py`. The unit tests fail when a constant disagrees with its manifest, and the release workflow refuses a tag that disagrees with any of them.
2. Merge to `main` with CI green.
3. Publish a GitHub release with the tag `v<version>` (for example `v0.1.0`) on `main`.
4. The workflow's `build` job runs both clients' unit tests and the live quickstart against api.graunt.com, packs the npm tarball, builds the sdist and wheel with pinned tools, and installs each into a clean consumer that runs the quickstart. Only then do the `npm` and `pypi` jobs, the only ones allowed to request an OIDC token, download those exact files and publish them; they check out, install and build nothing. When a check fails, nothing is published.

Published versions are permanent on both registries. A mistake is corrected by publishing a new version.
