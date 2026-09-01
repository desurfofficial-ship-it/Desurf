# FINAL_NOTE — F1 Diff-budget & json_path (v0.8.0)

## Version decision
Repo was at **0.7.0** (B3 merged) → bumped to **0.8.0** per §6.

## Decisions implemented
- **D1** `max_diff_lines`: live/record → committed baseline; offline → latest baseline-backup via `latestBaselineBackup`; no history → trivial pass.
- **D2** `json_path`: hand-rolled resolver (dot + numeric indices); equals / oneOf / min|max exclusive.
- **D3** no new `--json` fields; violations flow through assertionResults.

## Deviations
None.

## Tests
`test/f1-assertions.test.ts` — T1–T16 / E1–E18 coverage.

## Proof
- typecheck / build / test green
- npm ls --prod empty
- fixtures/basic offline still exit 0 (T15)
