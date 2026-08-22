---
name: applyonce
description: Fill Indian student scholarship, internship and job applications from one
  stored local profile. Discovers opportunities, checks eligibility before filling, and
  drives a portal to the final submit button WITHOUT ever submitting. Use for
  "find internships for me", "am I eligible for this scholarship", "fill this
  application", "what deadlines are coming up". Returns JSON via webcmd.
---

# ApplyOnce skill

Indian students retype the same forty facts into every portal. ApplyOnce stores
them once locally, learns each portal once, and fills future applications from a
compiled command.

## The one rule that is never negotiable

**No command here submits an application or makes a payment.** `fill` drives the
form to the final submit button and stops, returning `status: "ready_for_review"`
and `submitted: false`. The submit control is located only so it can be reported
back. If a user asks you to submit, tell them ApplyOnce stops before submission by
design and hand them `submit_url` to finish themselves.

## Invocation

Always call as `webcmd <site> <command> -f json`. The two sites are `internshala`
and `scholarship` — never omit the site prefix.

Browser commands need a Session. Create one and reuse it across a task:

```bash
webcmd session create -f json          # -> sessionId
webcmd --session <sessionId> internshala search "web development" -f json
```

## Commands

| Command | Access | Purpose |
| --- | --- | --- |
| `internshala search <query>` | read | Live internship listings: title, company, stipend, duration, location |
| `internshala detail <url>` | read | One internship: `apply_by`, `skills`, `who_can_apply`, `already_applied` |
| `internshala fill <url>` | write | Fill to the submit button, then STOP |
| `scholarship search [category]` | read | Live Indian scholarships: award, eligibility, `deadline_iso`, `days_to_go` |
| `scholarship detail <url>` | read | One scholarship: eligibility prose, documents required, deadline |
| `scholarship fill <url>` | write | Fill to the submit button, then STOP |

Scholarship categories: `girls`, `sc-st-obc`, `engineering`, `minority`,
`college-students`. Omit for all.

## Choosing a command by intent

- *"find internships / scholarships for me"* → `search`, then report the rows.
- *"should I apply / am I eligible?"* → `detail` first, then compare the returned
  `eligibility` / `who_can_apply` text against the student's profile. Say
  **qualify or skip and show the reasoning per criterion** before filling anything.
- *"fill this application"* → `fill`. Read `unmapped_fields` and
  `missing_documents` back to the user; those are theirs to complete.
- *"what is closing soon?"* → `search` on both sites and sort by `deadline_iso`.

## Filling: pass a mapped plan, never raw profile data

`fill` takes JSON maps of `{selector: value}`. Resolve the portal's visible field
labels to profile keys first, then pass only what you resolved:

```bash
webcmd --session <sid> scholarship fill "<url>" \
  --values  '{"#first_name":"Arpit","#email":"a@b.com"}' \
  --selects '{"#state":"Rajasthan","#district":"Jaipur"}' \
  --files   '{"#custom_resume":"/abs/path/resume.pdf"}' \
  -f json
```

Use `--dry-run` first on an unfamiliar form: it returns `form_fields` (every
label, selector, type and dropdown option) without typing anything. Map against
those labels, then run for real.

Dependent dropdowns (state → district) are handled: set the parent in `--selects`
and the child resolves after the cascade repopulates it.

## Reading the fill result

```json
{ "status": "ready_for_review", "submitted": false,
  "filled_count": 21, "filled_fields": {}, "selects_set": {},
  "unmapped_fields": [], "submit_control": {}, "warnings": [] }
```

- `submitted` is always `false`. If you ever see `true`, stop and report a bug.
- `unmapped_fields` are questions with no confident profile match. Do **not**
  invent answers — surface them to the user.
- `submit_url` is where the human goes to review and submit.

## Rules

1. Never submit, pay, or click a final action control.
2. Use the user's own logged-in session. If a command returns "Not logged in",
   ask the user to sign in themselves in the webcmd browser — never handle
   credentials.
3. `search` and `detail` are read-only. Only `fill` writes, and only after the
   user has asked for that specific opportunity.
4. Be polite: one search per portal per request, no retry loops. If a portal
   serves a challenge page, stop and tell the user — do not attempt to evade it.
5. Personal data is local. Never echo Aadhaar, PAN or bank numbers back in full;
   the commands already mask them.
