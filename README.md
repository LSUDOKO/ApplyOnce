<div align="center">

# ApplyOnce

**A self-learning MCP agent that fills student scholarship, internship and job applications from one stored profile — and never submits without a human.**

[![CI](https://github.com/LSUDOKO/ApplyOnce/actions/workflows/ci.yml/badge.svg)](https://github.com/LSUDOKO/ApplyOnce/actions/workflows/ci.yml)
[![Security](https://github.com/LSUDOKO/ApplyOnce/actions/workflows/security.yml/badge.svg)](https://github.com/LSUDOKO/ApplyOnce/actions/workflows/security.yml)
[![Release](https://github.com/LSUDOKO/ApplyOnce/actions/workflows/release.yml/badge.svg)](https://github.com/LSUDOKO/ApplyOnce/actions/workflows/release.yml)
[![semantic-release](https://img.shields.io/badge/semantic--release-conventionalcommits-e10079?logo=semantic-release)](https://github.com/semantic-release/semantic-release)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Powered by webcmd](https://img.shields.io/badge/engine-%40agentrhq%2Fwebcmd-7C3AED)](https://github.com/agentrhq/webcmd)

</div>

---

Indian students re-type the same 40 facts — name as per Aadhaar, 12th board, family income, IFSC — into every scholarship and internship portal. ApplyOnce stores that profile **once, locally**, learns each portal's form **once**, and then fills future applications instantly from a compiled command. It stops at the final submit button every single time.

```
  Claude ──MCP──▶ ApplyOnce ──CLI──▶ webcmd ──▶ your logged-in browser ──▶ form filled
                     │                                                        │
                     │                                                   ⛔ STOP
                     └──── { status: "ready_for_review", submit_url } ◀───────┘
```

## Contents

- [What it does](#what-it-does)
- [The learn-once advantage](#the-learn-once-advantage)
- [Hard rules (safety)](#hard-rules-safety)
- [Setup](#setup)
- [Register in Claude](#register-in-claude)
- [The five tools](#the-five-tools)
- [How self-healing works](#how-self-healing-works)
- [Architecture](#architecture)
- [Verified design notes](#verified-design-notes)
- [Development](#development)
- [Roadmap](#roadmap)

## What it does

| You ask Claude | ApplyOnce does | Writes anything? |
|---|---|---|
| "Find internships for me" | Searches live portals from your profile's preferences | No |
| "Am I eligible for this?" | Reads the scheme's criteria and shows its reasoning per check | No |
| "Fill this application" | Drives the portal, fills every field it can map, **stops before submit** | Yes — human-gated |
| "Which portals have you learned?" | Reads `webcmd list -f json` | No |
| "What's closing soon?" | Aggregates deadlines across portals, urgency-sorted | No |

Two portals are fully wired: **Internshala** (internships, logged-in session) and a **scholarship aggregator** (261 live Indian scholarships).

## The learn-once advantage

This is the point of the project, so it is surfaced, not hidden. Every run logs which path it took:

```
[reuse.hit]  Compiled command found for scholarship: EXECUTING INSTANTLY (no exploration)
[mapping.result] Mapped 27/28 form fields from the profile
[tool.end]   reuse run finished in 13.0s across 3 steps
```

On **first contact** with a portal there is no compiled command, so an agent must explore it in a live browser — dozens of steps of page-reading and reasoning. ApplyOnce captures that workflow as a webcmd adapter. On **every later run** the adapter executes as one deterministic CLI call: no reasoning about layout, no token spend on navigation. `list_learned_portals` makes this auditable by reading webcmd's own registry.

Measured on the demo form (28 fields), not estimated:

| | Run 1 (learn) | Run 2+ (reuse) | Saved |
|---|---|---|---|
| What happens | Explore the portal one control at a time | Execute the compiled command | |
| Browser steps | **36** | **3** | 92% |
| Wall time | 29.2 s | 13.9 s | 52% |
| Reasoning about layout | Yes | **None** | |
| Survives a redesign | — | Yes, via [self-healing](#how-self-healing-works) | |

The "before" is recorded by `scripts/record-learn-cost.mjs`, which replays a first-contact exploration and writes its real step count to a local run ledger. The banner above prints on every reuse run that has a recorded learn run to compare against — it never relabels a reuse as a learn to manufacture a saving.

## Hard rules (safety)

These are enforced **in code**, tested, and gated in CI — not conventions. A reviewer can verify all five from [`src/safety.ts`](src/safety.ts) and [`src/safety.test.ts`](src/safety.test.ts).

| # | Rule | Where it is enforced |
|---|---|---|
| 1 | **Never auto-submit or pay.** Fill to the final button, then stop and require a human. | `assertNotSubmit()` guards every click/fill/upload target. The submit control is located *only to be reported*. Every fill result is hard-wired `submitted: false`, and the MCP layer throws if an adapter ever claims otherwise. `scripts/check-adapters.mjs` fails CI if a fill adapter lacks the guard. |
| 2 | **Use the user's own logged-in session.** No fake accounts. | Adapters use webcmd `Strategy.COOKIE` profiles. If not logged in, the tool returns `LOGIN_REQUIRED` with a hint — it never enters credentials. |
| 3 | **Discovery and eligibility are read-only.** | `find_opportunities`, `check_eligibility`, `track_deadlines`, `list_learned_portals` call adapters declared `access: 'read'`. `assertWriteAllowed()` blocks writes outside `fill_application`. |
| 4 | **Respect each site.** Low volume, no aggressive retries, honour anti-bot signals. | `POLITENESS` budget (1.5 s between calls, max 2 attempts). `assertNoAntiBot()` **stops** on challenge pages rather than evading. See [why the fixture exists](#why-a-local-fixture-exists). |
| 5 | **Personal data stays local.** Never shipped to third parties, masked in logs. | Profile is a local JSON file; no network call touches it. `maskDeep()` redacts Aadhaar, PAN, bank and IFSC in every log line and every tool response. |

Every time `fill_application` stops, it prints this gate to stderr and logs `gate.approval_required`:

```
╔══════════════════════════════════════════════════════════════╗
║  ⛔ HUMAN APPROVAL REQUIRED — NOT SUBMITTED                   ║
╟──────────────────────────────────────────────────────────────╢
║  Fields filled     : 21                                      ║
║  Unmapped fields   : 1                                       ║
║  ApplyOnce filled this application up to the final submit    ║
║  button and STOPPED. No submit or payment action was taken.  ║
║  Review and submit yourself: http://…/apply/sch-medhavi-2026 ║
╚══════════════════════════════════════════════════════════════╝
```

## Setup

Requires **Node.js 20.6+**.

```bash
# 1. The engine — verified against @agentrhq/webcmd 0.7.4
npm install -g @agentrhq/webcmd
webcmd doctor                      # must be green: daemon, runtime, browser binary

# 2. ApplyOnce
git clone https://github.com/LSUDOKO/ApplyOnce.git
cd ApplyOnce
npm install
npm run build

# 3. Register the adapters with webcmd (they become compiled commands)
webcmd plugin install "$PWD/plugins/applyonce"
webcmd list -f json | grep -c applyonce   # expect 6 commands

# 4. Your profile — local only
cp data/profiles/sample_profile.json data/profiles/me.json
$EDITOR data/profiles/me.json             # validated against schemas/profile.schema.json
```

Log in to each portal **once** in webcmd's browser (it is a separate window from your normal Chrome):

```bash
webcmd session create -f json
# note the sessionId, then open the portal and sign in yourself:
printf 'await page.goto("https://internshala.com/login/student"); return page.url();' \
  | webcmd --session <sessionId> browser run --stdin
```

ApplyOnce never enters credentials. Sign in by hand; the cookie jar persists in your webcmd profile.

## Register in Claude

### Claude Desktop

Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`, Linux: `~/.config/Claude/`):

```json
{
  "mcpServers": {
    "applyonce": {
      "command": "node",
      "args": ["/absolute/path/to/ApplyOnce/dist/mcp/server.js"],
      "env": {
        "APPLYONCE_LOG_LEVEL": "info"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add applyonce -- node /absolute/path/to/ApplyOnce/dist/mcp/server.js
```

Restart the client. Ask: *"Use ApplyOnce to list the portals you've learned."*

## The five tools

All return machine-readable JSON. Errors carry `{ code, message, recovery_hint }` — never a bare stack trace.

### `find_opportunities` — read-only

```json
{ "query": "web development", "portal": "all", "limit": 10 }
```
Returns `opportunities[]` with `title, organisation, value, deadline, deadline_iso, days_to_go, eligibility, url`, plus a `learn_once` block per portal. Defaults `query` and `location` to your profile's preferences.

### `check_eligibility` — read-only, shows reasoning

```json
{ "opportunity_url": "https://internshala.com/internship/detail/…" }
```
Reads the stated criteria and returns per-check verdicts with evidence:

```
[PASS] Application window is open: Closes in 14 day(s) (2026-09-05).
[PASS] Work mode: The role is in-office and your preferences include onsite/hybrid work.
[PASS] Duration commitment: The internship runs 6 month(s); you can commit 6.
[PASS] Start-date window: You are available from 2026-09-01, inside the required start window.
[PASS] Skills match: You have 3/5 of the listed skills: JavaScript, Node.js, React.
```

Also evaluates income ceilings, minimum marks, gender-restricted and category-restricted schemes, and level of study. A criterion it cannot parse becomes `unknown` and lands in `needs_human_confirmation` — it never silently passes. `recommendation` is `apply`, `apply_with_review`, or `skip`.

### `fill_application` — human-gated, never submits

```json
{ "opportunity_url": "https://…/apply/…", "dry_run": false }
```
Returns:
```json
{
  "status": "ready_for_review",
  "submitted": false,
  "human_approval_required": true,
  "submit_url": "…",
  "filled_count": 21,
  "filled_fields": { "#first_name": "Arpit", "#aadhaar_name": "**************ARMA", … },
  "selects_set": { "#state": "Rajasthan", "#district": "Jaipur", "#category": "OBC" },
  "uploads": [ { "selector": "#custom_resume", "path": "…/resume.pdf" } ],
  "mapping": [ { "label": "Contact number", "profile_key": "personal.phone", "confidence": 0.95, "method": "alias" }, … ],
  "unmapped_fields": [ { "label": "Do you own a pet dinosaur?", "reason": "no confident profile match" } ],
  "missing_documents": [],
  "submit_control": { "text": "Submit application", "id": "submit_application", "disabled": false },
  "learn_once": { "mode": "reuse", "steps": 3, "duration_ms": 13030, "used_compiled_command": true }
}
```
`dry_run: true` scrapes and maps without typing anything.

### `list_learned_portals` — read-only

No arguments. Reads `webcmd list -f json` and reports each portal's compiled commands and capabilities (`discover`, `read_detail`, `fill`).

### `track_deadlines` — read-only

```json
{ "within_days": 60 }
```
Returns `upcoming[]` sorted soonest-first with `urgency` ∈ `critical | soon | upcoming`, plus `closed[]` and `unknown_deadline[]`.

## How self-healing works

Portals reskin constantly. ApplyOnce survives that at three layers:

**1. Labels, not selectors.** The semantic field mapper ([`src/mapping/field-map.ts`](src/mapping/field-map.ts)) resolves the *visible human label* of each control to a profile key through a scored cascade — exact → alias → regex → fuzzy — and refuses to guess below 0.5 confidence. Ids and classes can change freely; "Contact number" still means `personal.phone`. The demo fixture proves this: `?layout=v2` renames every id and class, and the fill result is identical.

**2. Ordered fallback chains.** Every container and field an adapter reads carries a list of strategies, newest layout first. On Buddy4Study — a Next.js app whose CSS-module class names carry a per-deploy hash (`Listing_scholarshipName__b3ok_`) — adapters target the stable prefix via `[class*="Listing_scholarshipName"]`. When a fallback beyond index 0 wins, the adapter writes a `self-heal` line to stderr so the recovery is visible, not silent.

**3. Dependent fields are deferred, not abandoned.** A `<select>` with no options yet is recognised as the child of a cascade (state → district). The parent is set first, the page is given time to repopulate, and the child is resolved with a single bounded retry.

When all strategies fail, the tool returns `SELF_HEAL_FAILED` with the hint to re-author that step. It does not loop.

## How webcmd is used (both deployments)

ApplyOnce runs webcmd in **two different modes**, because the two deployments have
different capabilities. Neither reimplements it.

| | Local server (stdio) | Remote server (HTTP) |
|---|---|---|
| webcmd surface | the `webcmd` CLI + compiled adapters | `web/fetch`, imported in-process |
| Browser | yes — CloakBrowser via webcmd | none |
| Learn-once registry | `webcmd list -f json` | n/a |
| Fill applications | ✅ | ❌ read-only by design |

**Local — webcmd's full stack.** `src/webcmd/bridge.ts` spawns the real `webcmd`
binary. The six adapters in `plugins/applyonce/` are registered webcmd commands
(`cli()` from `@agentrhq/webcmd/registry`), so they appear in `webcmd list -f json`
— that registry lookup *is* the learn-once branch point. Filling drives webcmd's
`IPage`: `fillText()` with verified read-back, `uploadFiles()`, `setChecked()`.

**Remote — webcmd's browserless tier.** A cloud host has no display, so the remote
server imports webcmd's own `web/fetch` command and calls the same `func()` the CLI
invokes. That command is declared browserless in webcmd's manifest, which is
exactly why it works there:

```json
{ "site": "web", "name": "fetch", "browser": false,
  "clientOwned": true, "packageExport": "./fetch/command" }
```

What that buys over a bare `fetch()`:

- **Tier escalation** — a plain request first; if the site refuses, webcmd retries
  through `impit` with a real Chrome/Firefox TLS + header fingerprint. The tier it
  needed is returned to the caller as `fetched_via` and logged as a self-heal.
- **SSRF-safe proxy** — private and loopback destinations are refused.
- **Readability extraction** — clean role/scheme prose with navigation and ads
  stripped. That text is what `check_eligibility` reasons over.

Structured fields that live in markup (the stipend chip, the `APPLY BY`
heading/body pair, skill tabs) still come from raw HTML parsing, because webcmd's
fetch always returns extracted text. Each tool does the job it is good at, and
`list_learned_portals` reports which engine answered.

## Architecture

```
src/
├── mcp/server.ts              MCP surface (stdio JSON-RPC). Logs → stderr only.
├── tools/                     One file per tool. fill-application.ts owns the gate.
├── webcmd/bridge.ts           Shells out to webcmd. hasCompiledCommand() = learn-once branch.
├── mapping/
│   ├── field-map.ts           Label → profile-key resolver (semantic layer)
│   └── formatters.ts          Dates, phones, CGPA↔%, dropdown synonyms, essay trimming
├── profile/loader.ts          Local-only load + JSON Schema 2020-12 validation
├── safety.ts                  HARD RULES 1–5, enforced
├── errors.ts                  Machine-readable errors with recovery hints
└── logging/logger.ts          Learn-once before/after + approval-gate banners

plugins/applyonce/             webcmd adapters (the compiled commands)
├── internshala-{search,detail,fill}.js
├── scholarship-{search,detail,fill}.js
└── utils.js                   Self-healing resolver, form scraper, safety mirror

schemas/profile.schema.json    The student profile contract
data/profiles/                 Your profiles — gitignored except the sample
fixtures/portal/               Local demo portal (see below)
scripts/check-adapters.mjs     CI gate: adapters load, no backticks in evaluate(), fill guards present
```

**Layer 1 — profile.** One local JSON. Name variants (full / first-middle-last / as per Aadhaar / as per marksheet), a qualifications repeater, family income, documents as absolute paths, reusable long answers.

**Layer 2 — adapters.** webcmd `cli({ site, name, func(page, kwargs) })` registrations. `func` receives webcmd's `IPage` (`fillText` with verified read-back, `uploadFiles`, `setChecked`, `evaluate`). Fill adapters take the mapped `{selector: value}` plan as arguments, so they hold no profile data and no hardcoded field list.

**Layer 3 — MCP server.** Validates input, loads the profile, checks the learn-once branch, runs a read-only dry pass to scrape labels, maps them, then (only for `fill_application`) runs the single write pass — and stops.

## Verified design notes

Before any integration code was written, the real [agentrhq/webcmd](https://github.com/agentrhq/webcmd) repository and the installed CLI (v0.7.4) were checked. Findings that shaped the design:

- **webcmd ships no MCP server.** Its `start.md` states MCP support is *"not implemented yet"*. Adapters are CLI commands. So ApplyOnce is the MCP server and webcmd is its engine, driven over the CLI. This is the better arrangement anyway: the safety gates live in code a judge can read.
- **`webcmd list -f json` is documented as "the source of truth for agents."** `list_learned_portals` reads it directly.
- **Adapter contract** is `cli()` from `@agentrhq/webcmd/registry` with typed errors from `@agentrhq/webcmd/errors` — the same pattern as the upstream `indeed` and `mercury` plugins. The Mercury adapter upstream also refuses to click a final Submit; ApplyOnce adopts the same posture and tests it.
- **Inside `webcmd browser run`, `page` is a raw Playwright page;** inside an adapter `func`, it is webcmd's `IPage`. The two APIs differ and the code uses each correctly.
- **Profiles are cookie jars; sessions are windows.** Interactive sign-in is done by the human in webcmd's browser, never via credentials in chat.

### Why a local fixture exists

Internshala serves its 73-field application form to a human's Chrome but redirects webcmd's automated browser away from `/student/resume` — a deliberate anti-automation signal. HARD RULE 4 says stop, not evade. So live **discovery, detail, eligibility and deadlines** run against the real Internshala and scholarship sites, while the **fill** path is demonstrated against [`fixtures/portal`](fixtures/portal/server.mjs): a clearly-labelled local replica built from the *exact labels scraped from the live Internshala form*. It has dependent state→district dropdowns, file uploads, essays, an inert submit button, and a `?layout=v2` mode that renames every id for the self-heal demo. Nothing is faked; the limitation is documented where it applies.

## Development

```bash
npm test                  # 111 tests incl. a suite per HARD RULE and live-label regressions
npm run typecheck
node scripts/check-adapters.mjs
npm run build
npm run dev               # run the MCP server from source

node fixtures/portal/server.mjs          # demo portal on :4173
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by commitlint on PRs). `semantic-release` cuts versions, changelog and GitHub releases from `main`; Dependabot opens weekly grouped PRs. The `security` workflow **blocks on any production vulnerability** and reports dev-only ones.

Environment variables: `APPLYONCE_LOG_LEVEL` (`debug|info|warn|error`), `APPLYONCE_LOG_FORMAT=json` for structured logs, `APPLYONCE_WEBCMD_BIN` to point at a specific webcmd binary.

## Roadmap

Deliberately **not** built in this scope; listed so the boundary is explicit.

- **More portals** — NSP (National Scholarship Portal) is a login-gated Angular SPA requiring OTP/Aadhaar sign-in, which ApplyOnce will not automate; it is a read-only-discovery candidate once a human session exists. Company career pages on Greenhouse/Lever are straightforward next adapters.
- **Bot-hostile ATS (Workday, LinkedIn Easy Apply)** — supported by the architecture (an adapter is an adapter), intentionally not targeted: they violate HARD RULE 4 in practice.
- **Shared community adapter library** — publish `plugins/applyonce` as a webcmd community plugin so learned portals are shared, not re-learned per user.
- **Resume tailoring** — per-role long-answer generation from the profile's base essays.
- **WhatsApp / Telegram front-end** — a chat surface over the same MCP tools for students without a desktop client.
- **Screenshot capture at the approval gate** — the `IPage` API exposes snapshots; wiring a PNG into `fill_application`'s response is a small follow-up.

## License

Apache-2.0. Built on [webcmd](https://github.com/agentrhq/webcmd) by AgentR.
