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
