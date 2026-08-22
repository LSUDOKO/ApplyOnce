# ApplyOnce — 3-minute live demo script

Every command and prompt below was run and verified on 2026-08-22. Timings are
real. Three beats: **(a)** fill-to-submit with human approval, **(b)** the
second-run instant-reuse moment, **(c)** a deliberate layout change that
triggers self-heal.

## Before you go on stage (5 min, once)

```bash
# Terminal 1 — the demo portal (local fixture; see README "Why a local fixture exists")
node fixtures/portal/server.mjs
#   ApplyOnce fixture portal on http://localhost:4173

# Terminal 2 — the engine
webcmd doctor                                   # all [OK]
webcmd list -f json | grep -c '"site": "'        # 7 (6 applyonce + web/fetch)
webcmd session create -f json                   # copy the sessionId
export SID=session_...

# Terminal 3 — the ApplyOnce logs. Keep this visible on screen the whole time.
# (Claude Desktop: tail its MCP log; Claude Code: logs appear in the session.)

# One-time: log in to Internshala in webcmd's browser window
printf 'await page.goto("https://internshala.com/login/student"); return page.url();' \
  | webcmd --session $SID browser run --stdin
# sign in by hand in the window that opens, then:
printf 'await page.goto("https://internshala.com/student/dashboard"); await page.waitForTimeout(3000); return await page.evaluate(()=>document.body.innerText.match(/Hi,\\s*\\w+/)?.[0]);' \
  | webcmd --session $SID browser run --stdin
#   "Hi, ARPIT"  ← logged in

# Seed the honest "before" number: replay a first-contact exploration of the
# form (36 one-at-a-time browser steps) and record it to the run ledger.
node scripts/record-learn-cost.mjs $SID http://localhost:4173/apply/sch-medhavi-2026 scholarship
#   [learn] DONE: 36 steps in 29.2s for scholarship
```

Open the listings page in a browser tab so the audience can see the form:
`http://localhost:4173/apply/sch-medhavi-2026`

---

## 0:00 — Hook (20 s)

> "Every Indian student types the same forty facts — name as per Aadhaar, 12th board, family income, IFSC — into every portal, every time. ApplyOnce stores them once, learns each portal once, and fills the rest instantly. And it **never** presses submit. Let me show you."

## 0:20 — Beat 1: discovery + eligibility are read-only (35 s)

**Prompt to Claude:**
> Use ApplyOnce to find web development internships for me, then check whether I'm eligible for the first one.

What the audience sees in the logs:
```
[reuse.hit]  Compiled command found for internshala: EXECUTING INSTANTLY (no exploration)
[tool.end]   find_opportunities returned 10 rows
[reuse.hit]  Compiled command found for internshala: EXECUTING INSTANTLY (no exploration)
[tool.end]   check_eligibility: ELIGIBLE (5 pass / 0 fail / 0 unknown)
```

Claude reads back live data — real stipends, a real deadline — and the reasoning:
```
[PASS] Application window is open: Closes in 14 day(s) (2026-09-05).
[PASS] Work mode: The role is in-office and your preferences include onsite/hybrid work.
[PASS] Duration commitment: The internship runs 6 month(s); you can commit 6.
[PASS] Start-date window: You are available from 2026-09-01, inside the required start window.
[PASS] Skills match: You have 3/5 of the listed skills: JavaScript, Node.js, React.
```

> "Nothing was filled yet. Two read-only tools, live against Internshala, and it *showed its working* on every check — so a student can disagree with it."

## 0:55 — Beat 2 (a): fill to the submit button, then STOP (50 s)

**Prompt to Claude:**
> Fill the Medhavi National Scholarship application at http://localhost:4173/apply/sch-medhavi-2026 from my profile.

Switch to the browser tab: the audience watches the form fill itself — name, Aadhaar name, DOB, state, **then district populates after state** (the dependent dropdown), CGPA, three file uploads, two essays.

Then the logs:
```
[mapping.result]  Mapped 27/28 form fields from the profile
[tool.end]        reuse run finished in 13.0s across 3 steps

╔════════════════════════════════════════════════════════════════╗
║  ⛔ HUMAN APPROVAL REQUIRED — NOT SUBMITTED                     ║
╟────────────────────────────────────────────────────────────────╢
║  Fields filled     : 21                                        ║
║  Unmapped fields   : 1                                         ║
║  ApplyOnce filled this application up to the final submit      ║
║  button and STOPPED. No submit or payment action was taken.    ║
╚════════════════════════════════════════════════════════════════╝
[gate.approval_required] Stopped before submit — awaiting human approval
```

Point at three things in Claude's JSON reply:
1. `"submitted": false` and `"human_approval_required": true`
2. `"#aadhaar_name": "**************ARMA"` — **masked**. Personal data never leaves the machine unredacted.
3. `"unmapped_fields": [ "Do you own a pet dinosaur?" ]` — it **refused to guess**. That field is for the human.

> "The submit button is right there. ApplyOnce located it — `submit_control` is in the response — and did not click it. There is no code path in this project that can. That's a test, not a promise."

**Human approval moment:** scroll the form, say "looks right", and *you* click submit (the fixture's button is inert — say so).

## 1:45 — Beat 3 (b): the second run — instant reuse (30 s)

**Prompt to Claude:**
> Fill the same application again.

> "Watch the step count."

```
[reuse.hit]  Compiled command found for scholarship: EXECUTING INSTANTLY (no exploration)
[tool.end]   reuse run finished in 13.9s across 3 steps

╔═════════════════════════════════════════════════════════════════╗
║  ⚡ LEARN-ONCE ADVANTAGE                                         ║
║  RUN 1  (LEARN)   explored the portal, authored a command       ║
║     steps :   36   time : 29.2s                                 ║
║  RUN 2  (REUSE)   executed the compiled command directly        ║
║     steps :    3   time : 13.9s                                 ║
║  SAVED  : 33 steps (92%)  •  15.3s (52%)                        ║
║  Run 2 performed NO exploration and NO reasoning about layout.  ║
╚═════════════════════════════════════════════════════════════════╝
```

> "Those numbers are measured, not claimed. Run 1 is a replay of what an agent does on first contact — 36 one-at-a-time browser steps to discover the form. Run 2 is the compiled command." 

**Prompt to Claude:**
> Which portals have you learned?

`list_learned_portals` reads webcmd's own registry:
```json
{ "learned_count": 2,
  "portals": [
    { "portal": "internshala", "capabilities": { "discover": true, "read_detail": true, "fill": true } },
    { "portal": "scholarship", "capabilities": { "discover": true, "read_detail": true, "fill": true } } ] }
```

> "Three steps. Zero reasoning about the page. The first time an agent meets a portal it explores — dozens of steps of reading and deciding. ApplyOnce compiles that into a webcmd command, so every run after the first is a CLI call. This isn't a cache; it's `webcmd list -f json`, the engine's own source of truth."

## 2:15 — Beat 4 (c): break the layout, watch it heal (35 s)

> "Portals redesign constantly. Let's redesign this one right now."

Open the **v2** form in the browser tab and view-source briefly:
`http://localhost:4173/apply/sch-medhavi-2026?layout=v2`

> "Every id is renamed — `first_name` is now `fname_v2`, `district` is `district_v2`, the CSS classes are different. A selector-based bot is dead here."

**Prompt to Claude:**
> Fill the application at http://localhost:4173/apply/sch-medhavi-2026?layout=v2

```
[mapping.result]  Mapped 27/28 form fields from the profile
[tool.end]        reuse run finished in 13.1s across 3 steps
⛔ HUMAN APPROVAL REQUIRED — NOT SUBMITTED   Fields filled : 21
```

Show the JSON: `"#fname_v2": "Arpit"`, `"#district_v2": "Jaipur"`. **Same 21 fields, same result, no re-authoring.**

> "It targets the human label, not the selector. 'Contact number' still means my phone whether the id is `phone` or `mobileNo_v2`. And on real sites with per-deploy class hashes — Buddy4Study is one — the adapters match the stable prefix and log a `self-heal` line when a fallback wins, so recovery is visible, never silent."

## 2:50 — Close (10 s)

> "One profile. Learn once, reuse forever, heal when they redesign — and a human presses submit, every time. ApplyOnce."

---

## Backup prompts (if a live site is slow)

- `Use ApplyOnce to track my deadlines for the next 60 days.` → urgency-sorted table across both portals.
- `Run fill_application in dry_run mode on …` → shows the full mapping plan without typing.
- If Internshala stalls: the scholarship search (`find_opportunities` with `portal: "scholarship"`) is public and fast.

## If something goes wrong

| Symptom | Fix |
|---|---|
| `WEBCMD_UNAVAILABLE` | `webcmd doctor`; restart the daemon. |
| `LOGIN_REQUIRED` | Sign in again in the webcmd browser window (cookies expired). |
| `SESSION_REQUIRED` | `webcmd session create -f json`; pass `session` to the tool. |
| Fixture 404 | Terminal 1 died — `node fixtures/portal/server.mjs`. |
| Every error has a `recovery_hint` | Read it aloud; it is written for exactly this moment. |

## Recording a backup capture

```bash
# Linux (X11/Wayland via wf-recorder or similar); adjust to your OS.
wf-recorder -g "$(slurp)" -f demo-backup.mp4 &
# run beats 1–4, then:
kill %1
```
Keep the logs terminal and the browser tab side by side in frame.
