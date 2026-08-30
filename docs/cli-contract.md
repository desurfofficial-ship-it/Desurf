# Desurf — CLI Contract

This document is part of the public surface of Desurf.  
Do not change the exit-code meanings without explicit approval.

## Commands overview

| Command | Role |
|---------|------|
| `desurf test` | Evaluate suite offline or live |
| `desurf init` | Scaffold offline suite |
| `desurf record` | Live capture + provenance |
| `desurf seal` | Offline provenance for existing outputs |
| `desurf inspect` | Read-only provenance inspection |

After prompt or input changes on a sealed/recorded suite, `desurf test` returns **exit 2** (stale provenance). That is distinct from **exit 1** (assertions evaluated and failed). Refresh offline with `desurf seal --force` (keeps existing output; no provider), or obtain a new output with `desurf record --force`.
