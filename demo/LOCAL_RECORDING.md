# Recording the local half (Part B)

Every command below was executed today and the expected output is what it
actually returned. Runtime: about 2 minutes.

This is where webcmd's full stack is on show - compiled adapters, a real
browser, and the fill that Claude web cannot do.

---

## SETUP - before you hit record

### Terminal 1 - demo portal (leave running)
```bash
cd ~/Desktop/hackathon_projects/ApplyOnce
node fixtures/portal/server.mjs
```

### Terminal 2 - slides (leave running)
```bash
python3 -m http.server 4174 --directory demo
```
If you see `Address already in use`, it is already running. Skip it.

### Terminal 3 - the one you record
```bash
cd ~/Desktop/hackathon_projects/ApplyOnce
npm run build
export SID=$(cat /tmp/applyonce_session)   # or: webcmd session create -f json
```

### Reset so the learn-once banner is honest
```bash
rm -f data/runs/ledger.json
node scripts/record-learn-cost.mjs $SID http://localhost:4173/apply/sch-medhavi-2026 scholarship
```
Expect: `[learn] DONE: 36 steps in 35.9s for scholarship`

This records what first contact ACTUALLY costs, so the comparison in Shot 4 is
measured rather than asserted. Do this off camera.

### Frame it
Terminal LEFT (55%), Chrome RIGHT (45%) showing
`http://localhost:4173/apply/sch-medhavi-2026`. Terminal font 16pt or larger.

---

## SHOT 1 - Prove webcmd is actually the engine (20s)

Two commands. This is the answer to "did you really use webcmd?"

```bash
webcmd list --tag applyonce -f json
```

**Verified output - 6 commands in webcmd's own registry:**
```
internshala/detail     access=read    browser=True
internshala/fill       access=write   browser=True
internshala/search     access=read    browser=True
scholarship/detail     access=read    browser=True
scholarship/fill       access=write   browser=True
scholarship/search     access=read    browser=True
```

> These are webcmd commands, not mine. ApplyOnce did not wrap a browser
> library - it compiled six adapters into webcmd's own registry. That registry
> lookup is the learn-once branch point.

Then run one directly, with no Claude in the loop at all:

```bash
webcmd --session $SID scholarship search --limit 3 -f json
```

**Verified live output:**
```
Reliance Foundation Undergraduate Scholarships   2026-10-05   43d
Kotak Kanya Scholarship 2026-27                  2026-08-31    8d
Parivartan ECSS Programme for School Students    2026-08-31    8d
```

> Real scholarships, real deadlines, straight out of webcmd. No AI involved in
> that call.

---

## SHOT 2 - What exploring actually costs (20s)

```bash
node scripts/measure-token-cost.mjs $SID http://localhost:4173/apply/sch-medhavi-2026
```

Let the 35 step lines scroll past. Land on:

```
TOKEN COST: exploring vs a compiled webcmd command
  WITHOUT webcmd (agent explores the form)
    steps:   35   observations:   22114 chars  ~   5529 tokens
  WITH webcmd (compiled command)
    steps:    1   observations:    6179 chars  ~   1545 tokens
  SAVED:   3984 tokens (72%)   .   34 steps (97%)
```

> That is not an estimate. It counts the real bytes the model has to read on
> every browser round-trip. Thirty-five steps just to work out where the fields
> are - and an agent pays that on every single run.

---

## SHOT 3 - Fill it, then STOP (40s)

Show the portal in Chrome first.

**Say this once, out loud:**
> This is a local replica of a real Indian scholarship form. Internshala blocks
> automated browsers from its own form, so ApplyOnce stops rather than evading
> it. The field labels here were scraped from the real thing.

**Prompt into Claude Code:**
```
Fill the Medhavi scholarship application at http://localhost:4173/apply/sch-medhavi-2026 from my profile.
```

**Watch the form fill in Chrome.** Call out State populating District.

Then the terminal banner:
```
HUMAN APPROVAL REQUIRED - NOT SUBMITTED
Fields filled     : 21
Unmapped fields   : 1
ApplyOnce filled this application up to the final submit
button and STOPPED. No submit or payment action was taken.
```

**Point at these four in the JSON, in this order:**
1. `"submitted": false`
2. `"submit_control": {"text": "Submit application", "id": "submit_application"}`
3. `"#aadhaar_name": "**************ARMA"`
4. `"unmapped_fields": ["Do you own a pet dinosaur?"]`

> Twenty-eight fields found, twenty-seven mapped, twenty-one filled - including
> a dependent dropdown and three file uploads. It located the submit button,
> reported it, and did not click it. There is no code path in this project that
> can, and a CI test fails the build if one appears. Aadhaar comes back masked.
> And it refused to invent an answer to a question it did not understand.

---

## SHOT 4 - The second run (20s)

**Prompt:**
```
Fill the same application again.
```

**Verified banner:**
```
LEARN-ONCE ADVANTAGE
  RUN 1  (LEARN)   explored the portal, authored a command
     steps :   36   time : 35.9s
  RUN 2  (REUSE)   executed the compiled command directly
     steps :    3   time : 13.8s
  SAVED  : 33 steps (92%)  .  22.1s (61%)
  Run 2 performed NO exploration and NO reasoning about layout.
```

> The first run learns the portal once. Every run after it reasons about
> nothing. That is the whole idea.

---

## SHOT 5 - Break the layout (20s)

Open `http://localhost:4173/apply/sch-medhavi-2026?layout=v2`.
View-source for two seconds. Show `fname_v2`, `district_v2`.

**Prompt:**
```
Fill the application at http://localhost:4173/apply/sch-medhavi-2026?layout=v2
```

**Verified:** `filled_count: 21` - identical. Selectors are now
`#fname_v2, #lname_v2, #aadhaarName_v2, #emailId_v2`.

> Every HTML id and class renamed. Same twenty-one fields. It targets the human
> label, not the selector - so a portal redesign does not break it.

---

## SHOT 6 - Close (15s)

**Screen:** `http://localhost:4174/architecture.html`

> webcmd's browser and compiled commands locally. webcmd's browserless fetch in
> the cloud, connected to claude.ai over OAuth. One profile, learn once, reuse
> forever - and a human always presses submit.

---

## The four ways this proves webcmd is really used

If a judge asks "did you actually use webcmd, or just call it webcmd?", these
are your answers, in order of strength:

1. **`webcmd list --tag applyonce`** - six adapters live in webcmd's registry.
   They were registered with `cli()` from `@agentrhq/webcmd/registry`.
2. **`webcmd --session $SID scholarship search`** - the adapter runs standalone.
   No MCP, no Claude, just webcmd.
3. **The learn-once banner** - 36 steps to 3. That gap only exists because
   webcmd compiled the workflow into a command.
4. **`plugins/applyonce/*.js`** - the source. Every file imports from
   `@agentrhq/webcmd/registry` and drives webcmd's `IPage` API: `fillText()`
   with verified read-back, `uploadFiles()`, `setChecked()`.

Optional, if you have 10 seconds spare:
```bash
head -30 plugins/applyonce/scholarship-fill.js
```
Shows the `cli({...})` registration and the `assertNotSubmit` import in one screen.

---

## If something breaks on camera

| Symptom | Fix |
|---|---|
| `SESSION_REQUIRED` | `webcmd session create -f json`, re-export `$SID`. |
| Fixture 404 | Terminal 1 died. Restart `node fixtures/portal/server.mjs`. |
| No learn-once banner | You skipped the ledger reset. Run the two setup commands. |
| Fill returns 0 fields | Fixture not running, or wrong URL. Check port 4173. |
| `webcmd list` shows 1 command | Plugin symlink gone. `ln -s $PWD/plugins/applyonce ~/.webcmd/plugins/applyonce` |

Every ApplyOnce error carries a `recovery_hint`. Read it aloud if one appears -
it was written for exactly this moment.
