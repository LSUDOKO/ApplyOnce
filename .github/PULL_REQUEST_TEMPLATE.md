## What

## Why

## Hard-rule checklist
- [ ] No new code path can click a submit / pay / final control
- [ ] Read-only tools remain read-only
- [ ] No personal data can reach logs or responses unmasked
- [ ] No retry loops or anti-bot evasion added
- [ ] `npm test`, `npm run typecheck`, `node scripts/check-adapters.mjs` all pass

## Commit message
Conventional Commits (`feat(scope): …`, `fix(scope): …`) — this drives the release version.
