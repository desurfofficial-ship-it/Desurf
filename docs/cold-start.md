# Cold-start recipe (published package)

A new developer should be able to install Desurf from npm, initialize a suite, seal, and get a green offline gate without reading the full source tree.

## 1. Install

```bash
npm install @desurfofficial-ship-it/desurf@1.0.0
npx desurf --version
```

Expected: the installed version string (e.g. `0.9.0` or `1.0.0`).

## 2. Initialize, seal, test

```bash
mkdir mysuite && cd mysuite
npx desurf init .
npx desurf seal --suite . --force
npx desurf test --suite .
```

Expected: seal exit 0; test **PASS**, exit **0**.

## 3. Wire a CI gate (optional)

Copy `examples/github-actions/desurf.yml` into your repo and pin the Action/`desurf` package version explicitly (never `latest`). The Desurf repository’s own CI demonstrates a green offline gate — e.g. [CI run 33613345725](https://github.com/desurfofficial-ship-it/Desurf/actions/runs/33613345725).

## 4. Next steps

- Live capture: `desurf record --suite . --provider openrouter` (requires API key)
- Authoring guidance: [assertions-cookbook.md](assertions-cookbook.md)
- Drift monitoring: [drift-watch.md](drift-watch.md)

Raw environment transcripts for the v1.0.0 definition-of-done live under `docs/audits/v1.0.0-dod.md`.
