# ApplyOnce — 2-minute demo video

Production plan. Every number below was measured, and every command was run.

## Shot list

| # | Time | Screen | What happens |
|---|---|---|---|
| 1 | 0:00–0:12 | `demo/token-chart.html` | Cold open on the number |
| 2 | 0:12–0:28 | Terminal | Measure the cost live |
| 3 | 0:28–0:48 | Claude + browser | Discovery + eligibility |
| 4 | 0:48–1:18 | Browser (form fills) | Fill → **STOP** |
| 5 | 1:18–1:35 | Terminal logs | Learn-once banner |
| 6 | 1:35–1:50 | Browser `?layout=v2` | Self-heal |
| 7 | 1:50–2:00 | `demo/architecture.html` | Where webcmd runs |

## Setup (before recording)

```bash
# terminal 1 — demo portal
node fixtures/portal/server.mjs

# terminal 2 — slides
python3 -m http.server 4174 --directory demo

# terminal 3 — the one you record
webcmd session create -f json          # copy the id
export SID=session_...
webcmd doctor                          # all [OK]
```

Window layout: terminal LEFT (55%), Chrome RIGHT (45%). Font ≥ 16pt.
Record 1280×720 or 1920×1080.

---

## Shot 1 — Cold open (0:00–0:12)

**Screen:** `http://localhost:4174/token-chart.html`

> "An AI agent filling one scholarship form reads five and a half thousand tokens
> just to work out where the fields are. Every single time.
> With webcmd, it reads fifteen hundred. Here's how."

## Shot 2 — Measure it live (0:12–0:28)

```bash
node scripts/measure-token-cost.mjs $SID http://localhost:4173/apply/sch-medhavi-2026
```

Let the 35 step lines scroll, land on the banner.

> "That's not an estimate. It counts the actual bytes the model has to read on
> every browser round-trip. Thirty-five steps to understand one form."

## Shot 3 — Discovery + eligibility (0:28–0:48)

**Prompt into Claude:**
> Use ApplyOnce to find web development internships for me and check whether I'm
> eligible for the first one.

> "Two MCP tools, live against Internshala. And it shows its reasoning per
> criterion — deadline, work mode, duration, start date, skills — so a student
> can disagree with it."

## Shot 4 — Fill, then stop (0:48–1:18)

**Prompt into Claude:**
> Fill the Medhavi scholarship application at
> http://localhost:4173/apply/sch-medhavi-2026 from my profile.

**Show the browser filling.** Call out the state→district cascade.

Then cut to the terminal:

> "Twenty-eight fields found, twenty-seven mapped, twenty-one filled — including
> a dependent dropdown and three file uploads. Then look at this."

**Point at three things:**
1. The ⛔ banner — `NOT SUBMITTED`
2. `"#aadhaar_name": "**********ARMA"` — masked
3. `unmapped_fields: ["Do you own a pet dinosaur?"]`

> "It found the submit button, reported it, and did not click it. There is no
> code path in this project that can. Aadhaar comes back masked. And it refused
> to guess a question it didn't understand."

## Shot 5 — The second run (1:18–1:35)

**Prompt:**
> Fill the same application again.

> "One step. Fifteen hundred tokens. Seventy-two percent less — because webcmd
> compiled that workflow into a command. The first run learns. Every run after
> it reasons about nothing."

## Shot 6 — Break it (1:35–1:50)

Open `http://localhost:4173/apply/sch-medhavi-2026?layout=v2`, show view-source briefly.

**Prompt:**
> Fill the application at http://localhost:4173/apply/sch-medhavi-2026?layout=v2

> "Every HTML id renamed. Same twenty-one fields. It targets the human label,
> not the selector — so a portal redesign doesn't break it."

## Shot 7 — Close (1:50–2:00)

**Screen:** `http://localhost:4174/architecture.html`

> "webcmd's browser and compiled commands locally. webcmd's browserless fetch in
> the cloud, connected to claude.ai over OAuth. One profile, learn once, reuse
> forever — and a human always presses submit."

---

## Backup

If a live site is slow, use these instead — all local, all instant:

- `Use ApplyOnce to track my deadlines for the next 60 days.`
- `Which portals have you learned?`
- `Run fill_application in dry-run mode on <fixture url>.`

## Say this once, out loud

When the fill demo runs, say **"local replica"**. Internshala blocks automated
browsers from its form, so ApplyOnce stops rather than evading — that's Hard
Rule 4. The replica uses labels scraped from the real form. Naming it turns a
limitation into the safety story, and judges will ask.
