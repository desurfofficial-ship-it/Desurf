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
       ├── SavedOutputAdapter (default, offline)
       └── OpenRouterAdapter (optional live; --provider openrouter)
```

There is **no** supported web server or dashboard in the 0.1.0 product surface. Desurf is a CLI.

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

| Component | Responsibility |
|-----------|----------------|
| CLI | Parse arguments, select provider, invoke runner, print results, set exit code. |
| Test Runner | Orchestrate loading a suite / case and driving the engine and reliability classification. |
| Assertion Engine | Given a model output + list of assertions → assertion results + overall pass/fail. |
| Repeat / Reliability Engine | Run a case N times, collect outcomes, classify PASS / FLAKY / REGRESSION / ERROR. |
| Offline Test Loader | Read suite.json + linked input / prompt / output files from disk. |
| SavedOutputAdapter | Load saved model output from disk (deterministic; default; CI). |
| OpenRouterAdapter | Optional live OpenRouter HTTP provider (`OPENROUTER_API_KEY`, `--model`). |

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

## Providers and CI

- **Default provider is offline** (saved outputs). Required CI is offline-only and does not use API keys or live models.
- **OpenRouter is opt-in** via `--provider openrouter`. Live model output is not deterministic; contract REGRESSION (exit 1) is not the same as provider ERROR (exit 2).
- Adding another live provider should mean a new `ModelAdapter` implementation only—not engine changes.

## Why this shape

- Keeps evaluation pure and testable in isolation.
- Allows offline deterministic development and CI.
- Makes it possible to add live providers without rewriting the engine.
- Forces a small surface area that a developer can understand and trust.
