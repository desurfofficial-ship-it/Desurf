# Desurf release audit — v<version>

File name: `docs/audits/v<version>.md` (e.g. `v0.9.0.md`).

`ci/audit-gate.sh` checks the two lines below mechanically on every publish.

```
AUDIT-VERDICT: PASS
Audited-commit: <full sha of the release commit>
```

## Checklist

- [ ] **Full suite green** — `npm run typecheck && npm run build && npm test` exit 0 with zero failures.
- [ ] **Zero production dependencies** — `npm ls --prod` is empty (no runtime deps).
- [ ] **Golden-master vs previous publish** — offline single-turn / contract cases match the prior published version (modulo intentional changes).
- [ ] **Lockfile mirror-URL grep** — no `http://` host in `package-lock.json` `resolved` URLs (must use `registry.npmjs.org`).
- [ ] **Example workflow pin bump** — Action / drift-watch examples pin the new semver (never `latest`).
- [ ] **Exit-code spot checks** — pass → 0, assertion REGRESSION → 1, config/infra ERROR → 2.
