# Desurf — Development Rules & AI Coding Agent Instructions

## Mission

You are working on **Desurf**, an offline-first CLI tool for testing AI prompt behavior and detecting regressions.

Your job is to implement the **CURRENT milestone only**.  
Do not expand the scope.

---

## 1. Before Changing Anything

Inspect the repository.

At minimum inspect:

- package.json
- tsconfig.json
- README.md
- src/
- test/
- fixtures/
- examples/

Do not claim functionality exists until you have verified it.

---

## 2. Explain Before Implementing

Before editing files, provide:

- **WHAT:** What are we adding?
- **WHY:** What user problem does it solve?
- **WHERE:** Which files need to change?
- **HOW:** How will the new code connect to the existing architecture?
- **TEST:** How will we prove it works?

If the task cannot be explained simply, stop and ask for clarification.

---

## 3. Scope Discipline

Only modify files necessary for the current milestone.

Do not introduce unrelated:

- refactors
- dependencies
- architecture changes
- UI
- databases
- APIs
- dashboards
- caching
- AI agents

---

## 4. Zero-Hallucination Rule

Never fabricate:

- test results
- file contents
- repository state
- package versions
- API behavior
- successful builds
- successful deployments

If you cannot verify something, say:

**UNVERIFIED**

and explain why.

---

## 5. Testing Rule

Never report “Tests pass” unless you actually ran them.

Distinguish:

- FULL REPOSITORY TEST
- from LOCAL RECONSTRUCTION

A reconstructed subset is not full verification.

---

## 6. No Hidden Error Suppression

Never add `|| true` to make a failing command appear successful.

Never suppress:

- TypeScript errors
- test failures
- lint failures
- runtime exceptions

unless the behavior is explicitly required and documented.

---

## 7. Architecture Rule

Keep responsibilities separate.

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

The repeat engine coordinates repeated executions.  
It must not duplicate assertion logic.

---

## 8. Offline First

Tests must work without:

- API keys
- network access
- paid model APIs

Use saved outputs / mocks for deterministic testing.  
Live model providers are secondary.

---

## 9. Determinism

Tests must be reproducible.

If a flaky result is needed for testing, simulate it deterministically.  
Never rely on an actual model randomly producing a flaky response in CI.

---

## 10. Exit Codes

Do not change this contract without explicit approval:

| Code | Meaning                                      |
|------|----------------------------------------------|
| 0    | PASS                                         |
| 1    | REGRESSION or FLAKY                          |
| 2    | ERROR / configuration / tool failure         |

---

## 11. Milestone Completion Report

At the end of every task report:

- Files changed:
- Files added:
- Files removed:
- Tests added:
- Tests executed:
- Tests passed:
- Tests failed:
- Type-check:
- Manual verification:
- Known limitations:
- Unverified items:

Never hide limitations.

---

## 12. Stop Conditions

STOP immediately if:

- the repository structure differs significantly from expectations
- a required file does not exist
- tests fail unexpectedly
- an API behaves differently than expected
- the task requires architectural expansion
- you cannot verify a critical assumption
- the user request conflicts with the current milestone

Report the problem before making speculative changes.

---

## 13. Developer Learning Requirement

The implementation should be understandable by the project owner.

Prefer:

- simple functions
- clear types
- small modules
- explicit data flow

Avoid unnecessary:

- classes
- factories
- dependency injection frameworks
- abstract frameworks
- metaprogramming
- complex generics

unless they solve a demonstrated problem.

---

## 14. Golden Rule

The goal is not:  
“Write the most sophisticated code possible.”

The goal is:  
“Build the smallest correct system that the developer can understand, test, and trust.”

---

## Development Philosophy (from Blueprint)

The project must be built from understanding, not copying.

Every milestone must include:

1. Explanation of what is being built.
2. Explanation of why it exists.
3. Small implementation.
4. Tests.
5. Manual verification.
6. Explanation of how the pieces connect.

The developer must be able to answer:

> “What happens when I run this command?”

without asking an AI.

---

## Anti-Hallucination Protocol (summary)

1. Never invent repository facts.
2. Never claim tests passed without running them.
3. Never silently replace missing dependencies.
4. No fake verification (label any reconstruction clearly).
5. No speculative architecture.

---

## AI Coding Agent Protocol

```
INSPECT → EXPLAIN → PLAN → IMPLEMENT → TEST → VERIFY → REPORT
```

Never: `PROMPT → GENERATE 20 FILES`

Modify only the files required for the current task.
