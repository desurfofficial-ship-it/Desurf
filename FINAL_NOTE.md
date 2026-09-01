# B3 FINAL_NOTE — Multi-turn conversations (v0.7.0)

## Decisions implemented

- D1–D5, D8–D10: schema, loader, offline replay, runner multi-turn, per-turn + case-level assertions, mid-conversation failure policy, `--repeat` whole conversation.
- D4: `ExecuteRequest.history` + `turnIndex`; all four live adapters insert history between system and final user.
- D6 (core): `turnUserSha256[]` on cassette meta; seal fingerprints all turn user files; stale turn index in soft/hard drift.
- D7 (core): record writes atomic transcript; history/accept/revert operate on transcript as unit (diff per-turn labels deferred polish).
- D9: TestResult.turns[] for JSON consumers.

## Deviations

None material. Per-turn unified diff labeling (`== turn N ==`) is available via atomic transcript diff; explicit per-hunk labels can be refined later without schema change.

## Tests

- T1–T6, T16: `test/turns.test.ts` (11)
- T7–T9: `test/turns-adapters.test.ts` (5)
- Full suite green at each milestone (M1: 358, M2: 363, final: see npm test)

## Milestones

- M0 pre-gate: 347 green @ 0.6.0
- M1: schema/loader/offline — committed `b6314f2`
- M2: live adapters history — committed `1fbebce`
- M3–M5: seal turn fingerprints, multi-turn record, docs, version 0.7.0 — this commit

## Proof

`npm run typecheck && npm run build && npm test` green; `npm ls --prod` empty.

---

## B3 Completion addendum (audit gaps closed)

### Fixes applied

1. **`--json` D9 surface** (`src/cli.ts` `summaryToJson`):
   - Each execution includes `turns: [{ index, passed, assertionResults, outputPreview?, error? }]` for multi-turn cases (omitted for single-turn).
   - Each `assertionFailures[]` entry includes `turnIndex` when set.
2. **Transcript integrity (E8)**: multi-turn offline path calls `verifyCassetteOutput` on the full transcript before replay.
3. **`diff` per-turn labels (T13)**: transcript vs transcript renders `== turn N ==` hunks; `--full` uses maxLines 2000.
4. **Docs**: `cli-contract.md` documents JSON turns fields and `diff` exit **1** when no pending snapshot.

### New tests (`test/turns-completion.test.ts`)

| ID | Coverage |
|----|----------|
| T15 | `--json` turns[1].passed=false + turnIndex:1 |
| T10 | seal turnUserSha256[]; edit turn-2 → exit 2, first stale turn index: 1 |
| T11 | recorded soft drift exit 0 + drift.staleTurnIndex in --json |
| T12 | record→drift→accept→test→revert→history on turns case |
| T13 | diff `== turn N ==` labels |
| T14 | --repeat 3 FLAKY/REGRESSION on varying turn output |
| E7 | transcript turn-count mismatch → exit 2 |
| E8 | tampered sealed transcript → exit 2 |
| E11 | provider error turn 2 of 3 → stops, turns[1].error |

### Proof

```
npm run typecheck  ✅
npm run build      ✅
npm test           ✅ 373 passed (35 files)
version            0.7.0 (unchanged)
npm ls --prod      empty
```

Explicit confirmation: **`--json` now exposes `turns` and `turnIndex`.**
