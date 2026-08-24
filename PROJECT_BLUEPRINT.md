# Desurf — Master Project Blueprint

## 0. Project Identity

**Project name:** Desurf

**Working description:**  
Desurf is a developer tool for testing AI prompts and detecting prompt regressions before they reach users.

The first version is an offline-first, CLI-based regression testing tool for developers building applications that depend on LLM prompts.

**Meaning:**  
AI outputs surf on the surface. Desurf checks what is underneath — the behavioral contract.

**The core problem:**  
Developers change prompts, models, system instructions, or AI application logic, but they do not have a reliable engineering mechanism for detecting whether those changes broke previously working behavior.

Desurf should make AI behavior testable using familiar software-testing concepts:

- test cases
- assertions
- repeated execution
- pass/fail classification
- regression detection
- flaky behavior detection
- exit codes
- CI integration

---

## 1. The Product Thesis

Traditional software tests assume:

```
same input + same code = same output
```

LLM applications frequently behave more like:

```
same input + same prompt + same model
        ↓
potentially different output
```

Therefore ordinary exact-output testing is insufficient.

Desurf’s initial thesis is:

> AI behavior should be tested against explicit behavioral assertions and repeated execution, rather than relying exclusively on exact output matching.

The first product should NOT attempt to solve every problem in AI evaluation.

---

## 2. The Narrow MVP

The MVP solves exactly this workflow:

```
Developer changes a prompt
        ↓
Desurf runs known test cases
        ↓
Desurf evaluates behavioral assertions
        ↓
Desurf can repeat tests
        ↓
Desurf classifies reliability
        ↓
CLI returns deterministic exit code
        ↓
CI can block a bad change
```

The MVP supports four reliability states:

| State       | Meaning                                                                 |
|-------------|-------------------------------------------------------------------------|
| **PASS**    | All requested executions pass.                                          |
| **FLAKY**   | At least one execution passes and at least one fails, with no execution error. |
| **REGRESSION** | All executions complete but fail the assertions.                     |
| **ERROR**   | One or more executions could not be evaluated because of an execution/provider/configuration error. |

---

## 3–27. Full detail

The complete sections (What Desurf Is NOT, Product Principle, Target User, Example Product, Architecture, Core Concepts, Assertions, Evaluation Model, Offline-First Design, Provider Abstraction, Repeated Execution, Exit Code Contract, CLI, Test Suite Format, Repository Structure, Development Philosophy, Anti-Hallucination Protocol, AI Coding Agent Protocol, Milestone System Stages 0–6, Features That Must Wait, Success Criteria, Most Important Metric, Definition of Done, Restart Rule, Final Product Vision) are maintained in the project workspace and will be kept in sync with this repository.

**Current stage:** Stage 1 — Minimal Offline Test Runner (implemented in this repo).

**Trust is the product.**
