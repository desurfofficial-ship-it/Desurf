# Publishing strategy

Desurf is versioned and published as the npm package `@desurfofficial-ship-it/desurf`.

## Versioning

Semantic Versioning (`MAJOR.MINOR.PATCH`):

| Change | Bump |
|--------|------|
| Breaking CLI or exit-code changes | MAJOR |
| New assertions, options, providers (backward compatible) | MINOR |
| Bug fixes, docs, packaging | PATCH |

Current version: **0.4.0**.

Exit codes `0` / `1` / `2` are part of the **public API**. Do not change their meanings without a major version bump.

## What gets published

`package.json` `files` field limits the tarball to:

- `dist/` — compiled CLI and libraries
- `LICENSE`
- `README.md`

Source, tests, fixtures, and examples stay in the Git repository. They are not required to run the installed CLI (suites are provided by the user).

## Build before publish

```bash
npm run build          # tsc → dist/
npm run pack:check     # dry-run of npm pack
```

`prepublishOnly` runs `npm run build` automatically on `npm publish`.

## Publish steps (maintainer)

1. Ensure `main` is green (CI offline gate).
2. Bump `version` in `package.json` if needed.
3. `npm run build && npm test && npm run test:offline`
4. `npm publish` (requires npm auth; package is configured `access: public`).
5. Tag the release in git: `git tag v0.4.0 && git push --tags`

## Local install without publishing

```bash
npm install
npm run build
npm link                 # optional: put desurf on PATH
desurf test --suite fixtures/basic
```

Or without linking:

```bash
node dist/cli.js test --suite fixtures/basic
```

## Development install

```bash
npm install
npx tsx src/cli.ts test --suite fixtures/basic
```

No build step required for day-to-day development.
