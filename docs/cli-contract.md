# Desurf — CLI Contract

This document is part of the public surface of Desurf.  
Do not change the exit-code meanings without explicit approval.

## Commands

| Command | Purpose |
|---------|---------|
| `desurf test` | Evaluate offline (or live) suite against behavioral contract |
| `desurf init` | Scaffold a minimal offline suite |
| `desurf record` | Capture live provider outputs + provenance |
| `desurf seal` | Establish offline provenance from existing outputs |
| `desurf inspect` | Read-only provenance status report |

## Cassette states

| State | Sidecar | Drift detection |
|-------|---------|-----------------|
| UNSEALED | absent | off |
| SEALED | `.desurf` from `seal` (or legacy without `source`) | on → exit 2 |
| RECORDED | `.desurf` from `record` | on → exit 2 |

After prompt or input changes on a sealed/recorded suite, `desurf test` returns **exit 2** (stale provenance). That is distinct from **exit 1** (assertions evaluated and failed). Refresh offline with `desurf seal --force` (keeps existing output; no provider), or obtain a new output with `desurf record --force`.
