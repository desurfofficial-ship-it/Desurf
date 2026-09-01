# Drift-watch — scheduled live contract monitoring

## The problem

Offline `desurf test` only sees **saved cassettes**. When a provider changes a model server-side, the offline gate stays green forever while production behavior drifts.

## The loop

1. **Schedule** — weekly (default Monday 06:00 UTC) or `workflow_dispatch`
2. **Live test** — `desurf test --suite <path> --provider <live> --repeat 3 --json`
3. **Classify** (from JSON, not exit code alone):
   - ≥1 `REGRESSION` → **drift** issue (`desurf-drift`)
   - else ≥1 `ERROR` → **infra** issue (`desurf-infra`)
   - else ≥1 `FLAKY` → warning only (not drift)
   - else all `PASS` → close open drift/infra issues
4. **Human triage** → fix prompt **or** accept the new behavior
5. **Re-baseline (B1)**:
   ```bash
   desurf record --suite ./suite --provider openrouter
   desurf diff --suite ./suite --case <id>
   desurf accept --suite ./suite --case <id> --yes
   # commit refreshed cassettes
   ```
6. Next scheduled run closes the issue when healthy.

## False-positive controls

- Default temperature 0; recommend `--repeat 3` so only **sustained** REGRESSION files an issue
- FLAKY ≠ drift; ERROR ≠ drift
- Live runs are **never** merge gates (no push/PR triggers)

## Setup

Copy `examples/github-actions/desurf-drift-watch.yml` and `examples/github-actions/drift-watch/lib.sh` into the consumer repo. Set provider API key secrets. Pin npm package version (never `latest`).

## Security

Minimal `issues: write` permission; keys only via `${{ secrets.* }}`.
