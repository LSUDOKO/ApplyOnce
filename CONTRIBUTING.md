# Contributing to ApplyOnce

Thanks for helping. Two things matter above everything else here.

## The hard rules are not negotiable

Any change must keep these true, and `npm test` + `scripts/check-adapters.mjs` enforce them:

1. No code path may click a final submit or a payment control.
2. Only the user's own logged-in session is used; credentials never enter the codebase.
3. Discovery and eligibility tools stay read-only.
4. Sites are treated politely; anti-bot signals stop the run, they are never evaded.
5. Personal data stays local and is masked in logs and responses.

A PR that weakens one of these will be closed, however clever.

## Workflow

```bash
npm install
npm test && npm run typecheck && node scripts/check-adapters.mjs
```

- Commits follow [Conventional Commits](https://www.conventionalcommits.org/). `commitlint` checks PRs; `semantic-release` versions from `main`.
  Scopes: `mcp`, `adapters`, `mapping`, `profile`, `safety`, `fixture`, `deps`, `README`, `ci`.
- Adding a portal? Copy `plugins/applyonce/scholarship-*.js`, keep `access: 'read'` on search/detail, import `assertNotSubmit` in the fill adapter, and return `submitted: false`. Then register it in `plugins/applyonce/index.js` and add the site to `APPLYONCE_SITES` in `src/tools/list-learned-portals.ts`.
- Adding a field label? Extend `FIELD_DEFINITIONS` in `src/mapping/field-map.ts` and add a regression test with the *real* label text you saw on the portal.
- Never put a backtick inside a `page.evaluate(\`…\`)` template — it terminates the literal. The adapter gate catches this.

## Reporting a security issue

See [SECURITY.md](SECURITY.md). Please do not open a public issue for anything that could expose a student's data.
