# webcmd-plugin-applyonce

Fill Indian student scholarship, internship and job applications from one stored
local profile — and **never** submit without a human.

Six commands across two sites. Discovery and detail are read-only; `fill` drives a
portal to the final submit button and stops.

## Install

```bash
npm install -g @agentrhq/webcmd
webcmd plugin install /absolute/path/to/ApplyOnce/plugins/applyonce
webcmd list -f json | grep applyonce      # 6 commands
```

## Safety

**No command in this plugin submits an application or makes a payment.**

- `assertNotSubmit()` guards every click, fill and upload target.
- The submit control is located only so it can be *reported* — `fill` returns it
  as `submit_control` and never clicks it.
- Every fill result is hard-wired `submitted: false`.
- Anti-bot challenge pages stop the run; they are never evaded.
- The plugin holds no profile data: the caller passes an already-mapped
  `{selector: value}` plan.

## Commands

### `internshala search <query>`

Live internship listings. Read-only.

```bash
webcmd --session <sid> internshala search "web development" --limit 5 -f json
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--location <city>` | – | City filter, e.g. `bangalore` |
| `--work-from-home` | false | Remote roles only |
| `--limit <n>` | 15 | Max rows (1–40) |

```json
[{ "opportunity_id": "3232934", "title": "Front End Development",
   "company": "Synergy Labs", "location": "Panipat",
   "stipend": "₹ 10,000 - 15,000 /month", "duration": "6 Months",
   "posted": "2 weeks ago", "url": "https://internshala.com/internship/detail/..." }]
```

### `internshala detail <url>`

One internship's criteria and deadline. Read-only.

```json
[{ "title": "Front End Development", "company": "Synergy Labs",
   "apply_by": "5 Sep' 26", "duration": "6 Months",
   "skills": ["CSS","HTML","JavaScript","Node.js","React"],
   "who_can_apply": "Only those candidates can apply who: 1. are available for...",
   "already_applied": false }]
```

### `internshala fill <url>` — never submits

```bash
webcmd --session <sid> internshala fill "<url>" \
  --values '{"#first_name":"Arpit","#phone":"9876543210"}' \
  --files  '{"#custom_resume":"/abs/path/resume.pdf"}' -f json
```

`--dry-run` scrapes and returns `form_fields` without typing anything.

### `scholarship search [category]`

Live Indian scholarships. Read-only. Categories: `girls`, `sc-st-obc`,
`engineering`, `minority`, `college-students`; omit for all.

```json
[{ "opportunity_id": "reliance-foundation-scholarships",
   "title": "Reliance Foundation Undergraduate Scholarships 2026-27",
   "award": "Up to 2,00,000", "eligibility": "For UG students",
   "deadline": "5 October 2026", "deadline_iso": "2026-10-04",
   "days_to_go": 43, "url": "https://www.buddy4study.com/page/..." }]
```

### `scholarship detail <url>`

Eligibility prose, documents required, award, deadline. Read-only.

### `scholarship fill <url>` — never submits

Adds `--selects` for dropdowns and `--checks` for checkboxes. Dependent
dropdowns (state → district) resolve after the parent cascade fires.

```bash
webcmd --session <sid> scholarship fill "<url>" \
  --values  '{"#first_name":"Arpit"}' \
  --selects '{"#state":"Rajasthan","#district":"Jaipur"}' \
  --checks  '{"#declaration":true}' \
  --files   '{"#income_cert":"/abs/path/income.pdf"}' -f json
```

## Self-healing

Every container and field resolves through an **ordered fallback chain**, and the
adapters target the *visible human label* rather than a selector wherever possible.

Buddy4Study is a Next.js app whose CSS-module class names carry a per-deploy hash
(`Listing_scholarshipName__b3ok_`). The adapters match the stable prefix:

```js
'[class*="Listing_scholarshipName"]'   // survives the hash change
'.Listing_scholarshipName__b3ok_'      // would break on the next deploy
```

When a fallback beyond index 0 wins, the adapter writes a `self-heal` line to
stderr so the recovery is visible rather than silent.

## Prompts

- *"Use webcmd to find work-from-home web development internships on Internshala and return title, company, stipend and duration."*
- *"Use webcmd to list scholarships for girls closing in the next 30 days with their award amounts."*
- *"Use webcmd to read the eligibility criteria for this scholarship and tell me whether a UG student with ₹2.4L family income qualifies."*
- *"Use webcmd to fill this application from my profile, then stop before submitting and show me what it could not map."*

## Requirements

- webcmd `>=0.7.0`, Node.js `>=20.6`
- A logged-in session for Internshala (`Strategy.COOKIE`) — sign in yourself in
  the webcmd browser; the plugin never handles credentials.

## Tests

```bash
npx vitest run plugins/applyonce/test
```
