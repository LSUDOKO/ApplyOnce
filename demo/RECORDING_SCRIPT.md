# ApplyOnce - complete recording script

Everything below was run and verified. Copy the prompts verbatim.

**Two halves, and you need both:**
- **Claude web** proves it is really deployed, and shows webcmd's token savings in the answer.
- **Local (Claude Code)** proves the fill, the approval gate, and self-heal. Claude web cannot fill - no browser, no documents.

Total runtime: about 3 minutes. For a strict 2-minute cut, drop Shot 3 and Shot 8.

---

## SETUP - run these before you hit record

### Terminal 1 - the demo portal (leave running)
```bash
cd ~/Desktop/hackathon_projects/ApplyOnce
node fixtures/portal/server.mjs
```
Expect: `ApplyOnce fixture portal on http://localhost:4173`

### Terminal 2 - the slides (leave running)
```bash
cd ~/Desktop/hackathon_projects/ApplyOnce
python3 -m http.server 4174 --directory demo
```

### Terminal 3 - the one you record
```bash
cd ~/Desktop/hackathon_projects/ApplyOnce
npm run build                       # picks up the latest server
webcmd doctor                       # every line must read [OK]
webcmd session create -f json       # copy the sessionId
export SID=session_xxxxxxxx
webcmd list -f json | grep -c applyonce      # expect 6
rm -f data/runs/ledger.json                   # so the learn-once banner is clean
```

### Log in to Internshala once (webcmd's browser, not your Chrome)
```bash
printf 'await page.goto("https://internshala.com/login/student"); return page.url();' \
  | webcmd --session $SID browser run --stdin
```
Sign in by hand in the window that opens. ApplyOnce never handles credentials.

### Verify the live server is awake (Render free tier sleeps)
```bash
curl -s https://applyonce-mcp.onrender.com/health
```
Expect `{"ok":true,...}`. If it takes ~50s, that is the cold start. Do this a minute before recording.

### Screen layout
Terminal LEFT (55%) - Chrome RIGHT (45%). Terminal font 16pt or larger.
Record at 1920x1080.

---

# PART A - CLAUDE WEB (0:00 - 1:05)

## Shot 1 - Cold open (0:00-0:12)
**Screen:** `http://localhost:4174/token-chart.html`

> An AI agent filling one scholarship form reads five and a half thousand tokens
> just to work out where the fields are. Every single time.
> With webcmd it reads fifteen hundred. Let me show you it working.

## Shot 2 - It is really deployed (0:12-0:25)
**Screen:** claude.ai - Settings, Connectors. Show `applyonce1` connected with its 5 tools.

**Prompt:**
```
Which portals have you learned, and what engine are you using?
```

**Point at:** `"engine": { "webcmd": true, "command": "web/fetch" }`

> This is a real MCP server on Render, connected to claude.ai over OAuth.
> It reports its own engine: webcmd.

## Shot 3 - Live discovery (0:25-0:45)
**Prompt:**
```
Use ApplyOnce to find web development internships for me. Show me the stipends and how many tokens webcmd saved.
```

**Point at:** real company names and stipends, then the summary line.

> Live Internshala data. And look at the last line of the tool result.

## Shot 4 - The webcmd number, in the answer (0:45-1:05)
**Prompt:**
```
Now check whether I'm eligible for the first one. My skills are JavaScript, React and TypeScript, I can do a 6-month in-office internship, and I'm available from 1 September 2026. Tell me what webcmd reported about token usage.
```

**Claude will read out, verbatim:**
```
Served by webcmd v0.7.4 (web/fetch; tier: plain) - 594 tokens used vs ~5,538
if the agent had explored the page itself. Saved ~4,944 tokens (89%) and 34
browser steps.
```

> That is webcmd reporting its own saving inside the answer. Five hundred and
> ninety-four tokens instead of five and a half thousand. And the eligibility
> check shows its reasoning per criterion, so a student can disagree with it.

**Say this once:** *"Claude web can discover and check eligibility. It cannot
fill an application, because filling needs my own logged-in browser and my own
documents. That is deliberate. Here is the local server."*

---

# PART B - LOCAL (1:05 - 2:50)

## Shot 5 - What exploring actually costs (1:05-1:25)
**Terminal 3:**
```bash
node scripts/measure-token-cost.mjs $SID http://localhost:4173/apply/sch-medhavi-2026
```

Let the 35 step lines scroll. Land on:
```
WITHOUT webcmd (agent explores the form)
  steps:   35   observations:   22150 chars  ~   5538 tokens
WITH webcmd (compiled command)
  steps:    1   observations:    6179 chars  ~   1545 tokens
SAVED:   3993 tokens (72%)   .   34 steps (97%)
```

> Not an estimate. It counts the real bytes the model has to read on every
> browser round-trip. Thirty-five steps just to understand one form.

## Shot 6 - Fill it, then STOP (1:25-2:00)
**Screen:** show the portal at `http://localhost:4173/apply/sch-medhavi-2026` first.

**Say:** *"This is a local replica of a real Indian scholarship form. Internshala
blocks automated browsers from its own form, so ApplyOnce stops rather than
evading it. The labels here were scraped from the real thing."*

**Prompt into Claude Code:**
```
Fill the Medhavi scholarship application at http://localhost:4173/apply/sch-medhavi-2026 from my profile.
```

**Watch the form fill.** Call out state to district populating.

Then the terminal:
```
HUMAN APPROVAL REQUIRED - NOT SUBMITTED
Fields filled     : 21
ApplyOnce filled this application up to the final submit
button and STOPPED. No submit or payment action was taken.
```

**Point at these four, in order:**
1. `"submitted": false`
2. `"submit_control": {"text": "Submit application", "id": "submit_application"}` - found, not clicked
3. `"#aadhaar_name": "**************ARMA"` - masked
4. `"unmapped_fields": ["Do you own a pet dinosaur?"]` - refused to guess

> Twenty-eight fields found, twenty-seven mapped, twenty-one filled - including
> a dependent dropdown and three file uploads. It located the submit button,
> reported it, and did not click it. There is no code path in this project that
> can - that is a test that fails the build. Aadhaar comes back masked. And it
> refused to invent an answer to a question it did not understand.

## Shot 7 - The second run (2:00-2:20)
**Prompt:**
```
Fill the same application again.
```

```
LEARN-ONCE ADVANTAGE
RUN 1  (LEARN)   steps :   36   time : 29.5s
RUN 2  (REUSE)   steps :    3   time : 13.4s
SAVED  : 33 steps (92%)  .  16.1s (55%)
```

> The first run learns the portal. Every run after it reasons about nothing.

## Shot 8 - Break the layout (2:20-2:40)
Open `http://localhost:4173/apply/sch-medhavi-2026?layout=v2`.
View-source for two seconds - show `fname_v2`, `district_v2`.

**Prompt:**
```
Fill the application at http://localhost:4173/apply/sch-medhavi-2026?layout=v2
```

**Verified result:** `filled_count: 21` - identical. Selectors are now
`#fname_v2, #lname_v2, #aadhaarName_v2, #emailId_v2`.

> Every HTML id renamed. Same twenty-one fields. It targets the human label,
> not the selector - so a portal redesign does not break it.

## Shot 9 - Close (2:40-2:55)
**Screen:** `http://localhost:4174/architecture.html`

> webcmd's browser and compiled commands locally. webcmd's browserless fetch in
> the cloud, connected to claude.ai over OAuth. One profile, learn once, reuse
> forever - and a human always presses submit.

---

## Showing webcmd explicitly (optional 15s insert, after Shot 5)

If a judge needs to see webcmd itself, not just its effect:

```bash
# The six ApplyOnce adapters, registered as real webcmd commands
webcmd list --tag applyonce -f json | python3 -m json.tool | head -20

# Run one directly - no Claude in the loop at all
webcmd --session $SID scholarship search --limit 3 -f json
```

> These are webcmd commands. ApplyOnce did not wrap a browser library; it
> compiled six adapters into webcmd's own registry. That registry lookup is
> what makes run two cheap.

---

## Backup prompts if a live site is slow

- `Use ApplyOnce to track my deadlines for the next 60 days.`
- `Run fill_application in dry-run mode on http://localhost:4173/apply/sch-medhavi-2026`
- `Which portals have you learned?`

## If something breaks on camera

| Symptom | Fix |
|---|---|
| Claude web tool fails | Render slept. `curl .../health`, wait 50s, retry. |
| `LOGIN_REQUIRED` | Cookies expired. Re-run the login command from Setup. |
| `SESSION_REQUIRED` | `webcmd session create -f json`, re-export `$SID`. |
| Fixture 404 | Terminal 1 died. Restart it. |
| No learn-once banner | `rm data/runs/ledger.json`, then run Shot 5 before Shot 7. |

Every error carries a `recovery_hint`. Read it aloud - it was written for this moment.
