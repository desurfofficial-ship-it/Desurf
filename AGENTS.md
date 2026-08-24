# Desurf — Agent Entry Point

This file is the starting point for any AI coding agent working on Desurf.

## Read these first (in order)

1. **PROJECT_BLUEPRINT.md** — What Desurf is, why it exists, the MVP, architecture, milestones, and what must not be built.
2. **DEVELOPMENT_RULES.md** — How agents must work: inspect → explain → plan → implement → test → verify → report. Zero-hallucination rules, offline-first, exit codes, scope discipline.
3. **docs/architecture.md** — Dependency direction and component responsibilities.
4. **docs/cli-contract.md** — Public CLI surface and exit-code contract.
5. **docs/test-case-schema.md** — Formal description of suites, test cases, and assertions.

## Current milestone

**Stage 2 — Reliability** is complete when `--repeat N` and PASS / FLAKY / REGRESSION / ERROR work with deterministic tests.

Next: **Stage 3 — Regression Gate** (exit codes in CI, GitHub Actions offline workflow).

## Hard rules (reminder)

- Implement **only** the current milestone.
- Never invent repository facts.
- Never claim tests passed unless you actually ran them.
- Prefer the smallest correct system a developer can understand and trust.
- Offline-first: the first provider is a saved-output provider.
- Exit codes are part of the public API: 0 = PASS, 1 = REGRESSION/FLAKY, 2 = ERROR.

## Project name meaning

AI outputs surf on the surface.  
**Desurf** checks what is underneath — the behavioral contract.
