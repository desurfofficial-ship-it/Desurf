# Desurf — Architecture

## High-level shape

```
Desurf
│
├── CLI
│
├── Test Runner
│
├── Assertion Engine
│
├── Repeat / Reliability Engine
│
├── Offline Test Loader
│
└── Provider Adapter
       │
       ├── Saved Output Provider   ← first provider (Stage 1)
       └── Future Live LLM Providers
```

## Dependency direction (strict)

```
CLI
 ↓
Runner
 ↓
Engine
 ↓
Assertions

Provider
 ↓
Engine
```

### Rules derived from the direction

- The **assertion engine** must not depend on the CLI.
- The **CLI** must not contain evaluation logic.
- The **repeat / reliability engine** coordinates repeated executions; it must **not** duplicate assertion logic.
- The core engine does not care which provider produced the model output.

## Component responsibilities

| Component                  | Responsibility                                                                 |
|----------------------------|---------------------------------------------------------------------------------|
| CLI                        | Parse arguments, load suite, invoke runner, print results, set exit code.       |
| Test Runner                | Orchestrate loading a suite / case and driving the engine (and later the repeat engine). |
| Assertion Engine           | Given a model output + list of assertions → produce assertion results + overall pass/fail. |
| Repeat / Reliability Engine| Run a case N times, collect outcomes, classify PASS / FLAKY / REGRESSION / ERROR. |
| Offline Test Loader        | Read suite.json + linked input / prompt / output files from disk.               |
| Provider Adapter           | `execute(request) → ModelOutput`. First concrete implementation: SavedOutputAdapter. |

## Evaluation flow (conceptual)

```
TestCase + Model Output
        ↓
Evaluate Assertions
        ↓
Assertion Results
        ↓
Test Result (for one execution)
```

With `--repeat N` the reliability engine aggregates multiple Test Results into one of the four reliability states.

## Why this shape

- Keeps evaluation pure and testable in isolation.
- Allows offline deterministic development and CI.
- Makes it possible to add live providers later without rewriting the engine.
- Forces a small surface area that a developer can understand and trust.
