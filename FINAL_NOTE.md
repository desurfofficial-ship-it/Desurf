# B2 Completion Note — v0.6.0 green

## What was repaired

Commit `4d04dbb` delivered B1 (verified) and a **partial** B2. This follow-up finishes B2:

### Fix 1 — `examples/github-actions/drift-watch/lib.sh` (was 0 bytes)

Implemented:

```bash
classify_run <summary.json>   # → drift|infra|flaky|healthy
act <class> <suiteName> <summary.json> <context-json>
```

- **classify_run** precedence (first match): REGRESSION → `drift`, ERROR → `infra`, FLAKY → `flaky`, else `healthy`. Corrupt/missing JSON or missing `cases` array → `infra`. Always exit 0 for classified results.
- **act**:
  - `drift` / `infra` — upsert issue (`desurf-drift` / `desurf-infra`) via suite fingerprint in body; comment on existing or create with remediation pointer to B1 re-baseline loop.
  - `healthy` — comment + close matching open drift/infra issues.
  - `flaky` — safe no-op.
  - Failed `gh` create/comment on drift/infra exits non-zero; healthy/flaky tolerate `gh` failure.

### Fix 2 — `test/action.test.ts` (4 stale assertions)

Rewritten against action.yml + `action/run-gate.sh` reality:

- default version **0.6.0**; `latest` rejection asserted in `run-gate.sh`
- env: block + install isolation (`mktemp -d`, `npm install --prefix`, `--no-package-lock`) in `run-gate.sh`
- `input 'suite' is required` + exit 2 in `run-gate.sh`
- `examples/github-actions/desurf.yml` pin updated **0.4.3 → 0.6.0**

### Fix 3 — drift-watch test coverage (T-A…T-J)

| ID | Assertion |
|----|-----------|
| T-A | REGRESSION → `drift` |
| T-B | ERROR → `infra` |
| T-C | FLAKY → `flaky` |
| T-D | all PASS → `healthy` |
| T-E | corrupt JSON / missing file → `infra` |
| T-F | REGRESSION+ERROR+FLAKY → `drift` (precedence) |
| T-G | `act drift` → `gh issue create` + label `desurf-drift` |
| T-H | second `act drift` → `issue comment` (no duplicate create) |
| T-I | `act healthy` → comment + `issue close` |
| T-J | `act infra` → label `desurf-infra` |

Stub `gh` on PATH records argv to a log file.

### Fix 4 — doc / diff deltas

- `src/cli.ts` accept/revert help + `docs/cli-contract.md`: **`--yes` is always required** (no interactive prompt; zero-deps policy).
- `src/diff.ts`: `unifiedDiff(old, new, maxLines = 200)`; `desurf diff --full` passes 2000; marker `... (N more lines truncated)`.

## Proof

```
npm run typecheck   # pass
npm run build       # pass
npm test            # 347 passed (32 files)
npm ls --prod       # (empty)
```

Version remains **0.6.0** (completes what 4d04dbb started; v0.5.0 was never tagged).

B1 surfaces (`src/history.ts`, `src/record.ts`, accept/revert/diff/history) were **not** modified.
