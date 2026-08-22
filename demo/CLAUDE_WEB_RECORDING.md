# Recording the Claude web half

Every prompt below was run against the live server today. The expected output
is what it actually returned, not an illustration.

**Runtime: about 70 seconds.** This is Part A of the video. Part B (fill,
approval gate, self-heal) is recorded locally afterwards - Claude web cannot
fill an application, and saying so on camera is part of the pitch.

---

## Before you hit record

### 1. Wake the server (Render free tier sleeps after 15 min)
```bash
curl -s https://applyonce-mcp.onrender.com/health
```
Expect `{"ok":true,...}`. First call after a sleep takes 25-50s. **Do this a
minute before recording** or your first prompt will hang on camera.

### 2. Open the slide in a second tab
```bash
python3 -m http.server 4174 --directory demo
```
Then open `http://localhost:4174/token-chart.html`.

### 3. Check the connector
claude.ai, Settings, Connectors. `applyonce1` should be listed with 5 tools.
Start a **fresh chat** so there is no earlier context in frame.

### 4. Frame it
Browser only, full screen, 1920x1080. Zoom to 110% so tool output is readable
on a phone. Close other tabs.

---

## SHOT 1 - Cold open (12s)

**Screen:** `http://localhost:4174/token-chart.html`

> An AI agent filling one scholarship form reads five and a half thousand tokens
> just to work out where the fields are. Every single time. With webcmd it reads
> fifteen hundred. Here it is running live.

Then switch to the claude.ai tab.

---

## SHOT 2 - It is genuinely deployed (14s)

Show Settings, Connectors for two seconds: `applyonce1`, 5 tools. Then the chat.

**Prompt:**
```
Which portals have you learned, and what engine are you using?
```

**Verified response contains:**
```json
"engine": { "webcmd": true, "command": "web/fetch" }
"portals": [
  { "portal": "internshala",  "source": "webcmd web/fetch (browserless tier escalation) + structured markup parsing" },
  { "portal": "scholarship",  "source": "buddy4study brand pages, server-rendered __NEXT_DATA__" }
]
"fill_available": false
```

> A real MCP server on Render, connected to claude.ai over OAuth. It reports its
> own engine: webcmd.

---

## SHOT 3 - Live data (20s)

**Prompt:**
```
Use ApplyOnce to find web development internships for me. Show me the stipends and tell me what webcmd reported.
```

**Verified live response:** real companies and stipends, e.g.
```
AI & Automation Developer   Perform Digital        Rs 6,000 - 10,000 /month
Digital Marketing           Onestop4wellness       Rs 3,000 - 5,000 /month
Computer Operator           K4 Media & Technologies Rs 8,000 - 10,000 /month
```
and the summary line:
```
Served via webcmd - 4 rows from 1 page(s), avoiding ~35 browser round-trips
(~5,538 tokens of exploration).
```

> Live Internshala data, right now. And look at the last line of that tool result.

**Note:** the listings are live, so your companies will differ from the above.
That is the point - say "this is live, so these change every day."

---

## SHOT 4 - The webcmd number, inside the answer (24s)

Use this exact URL. It is a Front End role, so a developer profile scores 5/5
and every check passes - the strongest version of this shot.

**Prompt:**
```
Check whether I'm eligible for this internship: https://internshala.com/internship/detail/front-end-development-internship-in-multiple-locations-at-synergy-labs1786004884

My skills are JavaScript, React, Node.js, CSS and HTML. I can do a 6-month in-office internship and I'm available from 1 September 2026. Also tell me exactly what webcmd reported about token usage.
```

**Verified response:**
```
Front End Development @ Synergy Labs   deadline: 5 Sep' 26
eligible: true | recommendation: apply | confidence: 1

[PASS] Work mode: The role is in-office and your preferences include onsite/hybrid work.
[PASS] Duration commitment: The internship runs 6 month(s); you can commit 6.
[PASS] Start-date window: You are available from 2026-09-01, inside the required start window.
[PASS] Skills match: You have 5/5 of the listed skills: CSS, HTML, JavaScript, Node.js, React.
```
```
Served by webcmd v0.7.4 (web/fetch; tier: plain) - 594 tokens used vs ~5,538
if the agent had explored the page itself. Saved ~4,944 tokens (89%) and 34
browser steps.
```

**Point at the summary line as you say:**

> That is webcmd reporting its own saving, inside the answer. Five hundred and
> ninety-four tokens instead of five and a half thousand. And the eligibility
> check shows its reasoning per criterion, so a student can disagree with it
> rather than trusting a yes or no.

---

## SHOT 5 - The handoff to local (10s)

**Prompt:**
```
Can you fill this application for me?
```

**Verified response - it refuses honestly:**
```json
{ "code": "WEBCMD_UNAVAILABLE",
  "message": "fill_application is not available on the remote server: a cloud host has no browser session and no access to your documents.",
  "recovery_hint": "Run the local ApplyOnce MCP server... Your profile and documents never leave your machine." }
```

> Claude web can discover and check eligibility. It cannot fill an application,
> because filling needs my own logged-in browser and my own documents. That is
> deliberate: uploading a student's Aadhaar to a server would break the one
> guarantee that makes this trustworthy. Here is the local server.

**Cut here.** Part B continues in Claude Code.

---

## Optional 12s insert - proving webcmd is real

Drop this in after Shot 2 if you have room. Needs a terminal on screen.

```bash
webcmd list --tag applyonce -f json
```
Verified output: 6 commands - `internshala/{search,detail,fill}` and
`scholarship/{search,detail,fill}`.

> These are webcmd commands. ApplyOnce did not wrap a browser library; it
> compiled six adapters into webcmd's own registry.

---

## If something breaks on camera

| Symptom | Fix |
|---|---|
| First prompt hangs 30-50s | Render cold start. Wake it before recording. |
| "Couldn't reach the connector" | `curl .../health`, wait, retry the prompt. |
| Empty internship list | Internshala changed its listing. Try `portal: "scholarship"` instead. |
| Claude does not mention webcmd | Add "tell me exactly what webcmd reported" to the prompt. |

---

## What NOT to claim in this half

- Do not say Claude web fills applications. It cannot, and the refusal is a
  feature you are showing on purpose.
- Do not claim the 72% figure comes from this half. That number is measured
  locally by `scripts/measure-token-cost.mjs` and belongs to Part B. The number
  shown here is the per-call figure webcmd reports (89-93%).
