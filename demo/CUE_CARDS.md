# Cue cards — read these while recording

Every number below was captured from a real run. Nothing here is illustrative.

---

## SHOT 1 · Chart (0:00–0:12)
`http://localhost:4174/token-chart.html`

> An AI agent filling one scholarship form reads **five and a half thousand tokens**
> just to work out where the fields are. Every single time.
> With webcmd, it reads **fifteen hundred**. Here's how.

---

## SHOT 2 · Measure it (0:12–0:28)
```bash
node scripts/measure-token-cost.mjs $SID http://localhost:4173/apply/sch-medhavi-2026
```
**On screen:**
```
║  WITHOUT webcmd (agent explores the form)                    ║
║    steps:   35   observations:   22150 chars  ≈   5538 tokens║
║  WITH webcmd (compiled command)                              ║
║    steps:    1   observations:    6179 chars  ≈   1545 tokens║
║  SAVED:   3993 tokens (72%)   •   34 steps (97%)             ║
```
> Not an estimate — it counts the actual bytes the model reads on every
> round-trip. **Thirty-five steps** to understand one form.

---

## SHOT 3 · Discovery + eligibility (0:28–0:48)
**Type into Claude:**
> Use ApplyOnce to find web development internships for me and check whether I'm eligible for the first one.

> Two MCP tools, live against Internshala. And it shows its reasoning per
> criterion — deadline, work mode, duration, start date, skills — so a student
> can disagree with it.

---

## SHOT 4 · Fill, then STOP (0:48–1:18)
**Type into Claude:**
> Fill the Medhavi scholarship application at http://localhost:4173/apply/sch-medhavi-2026 from my profile.

**Watch the form fill. Call out state→district.** Then the terminal:
```
║  ⛔ HUMAN APPROVAL REQUIRED — NOT SUBMITTED                   ║
║  Fields filled     : 21                                      ║
║  ApplyOnce filled this application up to the final submit    ║
║  button and STOPPED. No submit or payment action was taken.  ║
```
**Verified facts to point at:**
- `submitted: false`
- `submit_control: {"text": "Submit application", "id": "submit_application"}` — **found, not clicked**
- `"#aadhaar_name": "**************ARMA"` — masked
- `unmapped_fields: ["Do you own a pet dinosaur?"]` — refused to guess
- 28 detected → 27 mapped → 21 filled · 4 dropdowns · 3 uploads

> It found the submit button, reported it, and did not click it. There is no code
> path in this project that can — that's a test that fails the build.

---

## SHOT 5 · Second run (1:18–1:35)
**Type into Claude:**
> Fill the same application again.

```
║  ⚡ LEARN-ONCE ADVANTAGE                                         ║
║  RUN 1  (LEARN)   steps :   36   time : 29.5s                   ║
║  RUN 2  (REUSE)   steps :    3   time : 13.4s                   ║
║  SAVED  : 33 steps (92%)  •  16.1s (55%)                        ║
```
> The first run learns. Every run after it reasons about nothing.

---

## SHOT 6 · Break the layout (1:35–1:50)
Open `?layout=v2`, show view-source for 2 seconds.
**Type into Claude:**
> Fill the application at http://localhost:4173/apply/sch-medhavi-2026?layout=v2

**Verified:** `filled_count: 21` — identical. Selectors are now
`#fname_v2, #lname_v2, #aadhaarName_v2, #emailId_v2 …`

> Every HTML id renamed. Same twenty-one fields. It targets the human label,
> not the selector.

---

## SHOT 7 · Close (1:50–2:00)
`http://localhost:4174/architecture.html`

> webcmd's browser and compiled commands locally. webcmd's browserless fetch in
> the cloud, connected to claude.ai over OAuth. One profile, learn once, reuse
> forever — and a human always presses submit.

---

## ⚠️ Say once, out loud
When the fill runs: **"this is a local replica."** Internshala blocks automated
browsers from its form, so ApplyOnce stops rather than evading — Hard Rule 4.
The replica uses labels scraped from the real form. Judges will ask; naming it
first turns a limitation into the safety story.
