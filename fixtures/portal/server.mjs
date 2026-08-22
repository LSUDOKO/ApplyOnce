#!/usr/bin/env node
/**
 * ============================================================================
 * ApplyOnce demo portal — a LOCAL FIXTURE, not a real website.
 * ============================================================================
 * WHY THIS EXISTS
 *   Internshala serves its 73-field application form to a human's Chrome but
 *   redirects an automated browser away from /student/resume. Honouring HARD
 *   RULE 4 (respect anti-bot signals, never evade), ApplyOnce does not fight
 *   that. This fixture reproduces the SAME form — the real field labels
 *   scraped from the live site on 2026-08-22 — so the fill path, the semantic
 *   mapping, the human-approval gate and the self-heal recovery can all be
 *   demonstrated and regression-tested deterministically.
 *
 * It is served on localhost, contains no real employer data, and accepts no
 * submissions: the submit button is inert by design.
 *
 * Routes:
 *   /                      scholarship + internship listings
 *   /apply/:id             the application form (v1 layout)
 *   /apply/:id?layout=v2   the SAME form after a "redesign" — ids and classes
 *                          change, labels stay. This is the self-heal demo.
 * ============================================================================
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.APPLYONCE_FIXTURE_PORT ?? 4173);

const OPPORTUNITIES = [
  { id: 'sch-medhavi-2026', kind: 'scholarship', title: 'Medhavi National Scholarship 2026-27',
    org: 'Medhavi Foundation', award: 'Up to INR 1,00,000',
    deadline: '2026-09-30', eligibility:
      'Open to Indian students currently enrolled in an undergraduate programme. Family income should be less than INR 6 lakh per annum. Candidates must have scored minimum 60% in the last qualifying examination.' },
  { id: 'sch-girls-stem-2026', kind: 'scholarship', title: 'Girls in STEM Scholarship 2026',
    org: 'STEM India Trust', award: 'INR 50,000 per year',
    deadline: '2026-10-15', eligibility:
      'Only girls studying in the first year of a graduation programme can apply. Family income must be below INR 8 lakh.' },
  { id: 'int-frontend-2026', kind: 'internship', title: 'Front End Development Internship',
    org: 'Nimbus Labs', award: 'INR 12,000 - 18,000 /month',
    deadline: '2026-09-20', eligibility:
      'Open to undergraduate students available for a 6 month full time internship. Skills required: JavaScript, React, HTML, CSS.' },
];

/** The exact labels scraped from the live Internshala form. */
function formHtml(opp, v2) {
  // v2 = the "redesign": ids and classes change, human labels do not.
  const id = (a, b) => (v2 ? b : a);
  const cls = v2 ? 'fld-input' : 'form-control';
  const group = v2 ? 'field-block' : 'form-group';

  const stateOptions = ['--Select State--', 'Rajasthan', 'Maharashtra', 'Karnataka', 'Kerala'];
  const districtsByState = {
    Rajasthan: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota'],
    Maharashtra: ['Mumbai', 'Pune', 'Nagpur'],
    Karnataka: ['Bengaluru', 'Mysuru'],
    Kerala: ['Kochi', 'Thiruvananthapuram'],
  };

  // Label text and field ids are the automation contract — unchanged.
  // `hint` is presentation only.
  const text = (labelText, fieldId, type = 'text', required = false, hint = '') => `
      <div class="${group}">
        <label for="${fieldId}">${labelText}${required ? ' *' : ''}</label>
        ${hint ? `<p class="hint">${hint}</p>` : ''}
        <input class="${cls}" type="${type}" id="${fieldId}" name="${fieldId}" ${required ? 'required' : ''} />
      </div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Apply: ${opp.title}</title>
<style>
 /* ------------------------------------------------------------------ *
  * Trust-first public-service styling. GOV.UK-influenced structure with
  * an India-appropriate palette. Deliberately institutional, not
  * "designed": a portal handling Aadhaar and bank details should look
  * like infrastructure. One accent (India green), one radius scale (4px),
  * one theme. Motion is limited to focus and hover feedback.
  * ------------------------------------------------------------------ */
 :root {
   --ink:        #0b0c0c;
   --ink-muted:  #505a5f;
   --line:       #b1b4b6;
   --line-soft:  #e5e7e8;
   --page:       #ffffff;
   --panel:      #f3f2f1;
   --accent:     #10643c;   /* India green, desaturated for long reading */
   --accent-dk:  #0a4527;
   --focus:      #ffdd00;   /* high-visibility focus, GOV.UK convention */
   --saffron:    #d4691a;
   --error:      #b81f27;
   --radius:     4px;
 }
 * { box-sizing: border-box; }
 body {
   margin: 0; background: var(--page); color: var(--ink);
   font-family: "Inter", system-ui, -apple-system, "Segoe UI", Arial, sans-serif;
   font-size: 17px; line-height: 1.55;
   -webkit-font-smoothing: antialiased;
 }

 /* Government identity bar */
 .gov-bar { background: var(--ink); color: #fff; font-size: 13px; padding: 7px 0; }
 .gov-bar .wrap { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
 .gov-bar .tricolour { display: inline-flex; height: 11px; width: 17px; border: 1px solid #4b4f52;
                       flex-direction: column; margin-right: 9px; vertical-align: -1px; }
 .gov-bar .tricolour i { flex: 1; display: block; }
 .gov-bar .tricolour i:nth-child(1) { background: #ff9933; }
 .gov-bar .tricolour i:nth-child(2) { background: #fff; }
 .gov-bar .tricolour i:nth-child(3) { background: #138808; }

 /* Masthead */
 header.masthead { background: var(--accent); color: #fff; padding: 20px 0 18px; }
 header.masthead .wrap { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
 .crest { width: 46px; height: 46px; border-radius: 50%; background: #fff; color: var(--accent);
          display: grid; place-items: center; font-weight: 800; font-size: 18px; letter-spacing: -.5px;
          flex-shrink: 0; }
 .masthead h1 { font-size: 22px; margin: 0; font-weight: 700; letter-spacing: -.01em; line-height: 1.25; }
 .masthead p { margin: 2px 0 0; font-size: 13.5px; opacity: .88; }

 /* Primary navigation: single line, max 80px */
 nav.primary { background: var(--accent-dk); }
 nav.primary .wrap { display: flex; gap: 26px; overflow-x: auto; }
 nav.primary a { color: #fff; text-decoration: none; font-size: 14.5px; padding: 12px 0;
                 border-bottom: 3px solid transparent; white-space: nowrap; }
 nav.primary a[aria-current] { border-bottom-color: #fff; font-weight: 600; }
 nav.primary a:hover { border-bottom-color: rgba(255,255,255,.5); }

 .wrap { max-width: 1060px; margin: 0 auto; padding: 0 22px; }
 main { padding: 30px 0 60px; }

 /* Demo notice: honest about what this is */
 .notice {
   border-left: 5px solid var(--saffron); background: #fff8f2;
   padding: 13px 18px; margin-bottom: 26px; font-size: 14.5px; border-radius: 0 var(--radius) var(--radius) 0;
 }
 .notice strong { color: #8a4210; }

 /* Scheme header */
 .scheme-head { border-bottom: 3px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
 .scheme-head .kicker { font-size: 13px; color: var(--ink-muted); font-weight: 600;
                        text-transform: uppercase; letter-spacing: .07em; }
 .scheme-head h2 { font-size: 31px; margin: 7px 0 12px; line-height: 1.22; letter-spacing: -.015em; }
 .facts { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid var(--line); border-radius: var(--radius); overflow: hidden; }
 .fact { flex: 1 1 190px; padding: 12px 16px; border-right: 1px solid var(--line-soft); }
 .fact:last-child { border-right: 0; }
 .fact dt { font-size: 12.5px; color: var(--ink-muted); text-transform: uppercase;
            letter-spacing: .06em; font-weight: 600; margin: 0; }
 .fact dd { margin: 4px 0 0; font-size: 16px; font-weight: 600; }
 .fact dd.due { color: var(--error); }

 /* Progress: communicates where the applicant is */
 .steps { display: flex; gap: 0; margin: 30px 0 26px; border: 1px solid var(--line);
          border-radius: var(--radius); overflow: hidden; list-style: none; padding: 0; }
 .steps li::marker { content: none; }
 .step { flex: 1; padding: 11px 14px; font-size: 13.5px; color: var(--ink-muted);
         border-right: 1px solid var(--line-soft); background: var(--panel); }
 .step:last-child { border-right: 0; }
 .step[aria-current] { background: #fff; color: var(--ink); font-weight: 600;
                       box-shadow: inset 0 -3px 0 var(--accent); }
 .step b { display: block; font-size: 11.5px; color: var(--ink-muted);
           text-transform: uppercase; letter-spacing: .06em; font-weight: 600; }

 /* Form sections */
 fieldset { border: 0; padding: 0; margin: 0 0 34px; }
 legend, h3.section-title {
   font-size: 19px; font-weight: 700; padding: 0 0 9px; margin: 0 0 18px;
   border-bottom: 2px solid var(--line-soft); width: 100%; letter-spacing: -.01em;
 }
 .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; }
 @media (max-width: 720px) { .grid-2 { grid-template-columns: 1fr; } }

 .form-group, .field-block { margin: 0 0 19px; display: flex; flex-direction: column; }
 label { font-size: 15px; font-weight: 600; margin-bottom: 6px; color: var(--ink); }
 .hint { font-size: 13.5px; color: var(--ink-muted); margin: -2px 0 6px; }

 .form-control, .fld-input, select, textarea, input[type=file] {
   font: inherit; font-size: 16px; padding: 9px 11px; color: var(--ink);
   border: 2px solid var(--ink); border-radius: var(--radius); background: #fff;
   width: 100%; transition: border-color .12s ease;
 }
 textarea { min-height: 104px; resize: vertical; line-height: 1.5; }
 input[type=file] { border: 2px dashed var(--line); padding: 13px 11px;
                    background: var(--panel); font-size: 15px; cursor: pointer; }
 input[type=file]:hover { border-color: var(--accent); background: #f0f6f2; }
 /* GOV.UK-style focus: unmistakable, WCAG-safe */
 .form-control:focus, .fld-input:focus, select:focus, textarea:focus, input:focus {
   outline: 3px solid var(--focus); outline-offset: 0;
   border-color: var(--ink); box-shadow: inset 0 0 0 2px var(--ink);
 }
 select { appearance: none;
   background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='7'%3E%3Cpath d='M1 1l4.5 4.5L10 1' stroke='%230b0c0c' stroke-width='2' fill='none'/%3E%3C/svg%3E");
   background-repeat: no-repeat; background-position: right 13px center; padding-right: 34px; }

 /* Submit: deliberately real-looking; the fixture disables it */
 .actions { border-top: 2px solid var(--line-soft); padding-top: 24px; margin-top: 8px;
            display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
 button[type=submit] {
   font: inherit; font-size: 17px; font-weight: 700; color: #fff;
   background: var(--accent); border: 0; border-bottom: 3px solid var(--accent-dk);
   padding: 12px 26px; border-radius: var(--radius); cursor: pointer;
 }
 button[type=submit]:hover { background: #0d5533; }
 button[type=submit]:active { transform: translateY(1px); border-bottom-width: 2px; }
 button[type=submit]:focus { outline: 3px solid var(--focus); outline-offset: 1px; }
 .save-note { font-size: 14px; color: var(--ink-muted); }
 #done { margin: 16px 0 0; font-size: 15px; color: var(--error); font-weight: 600; }

 /* Listings */
 .listing { border: 1px solid var(--line); border-radius: var(--radius);
            padding: 20px 22px; margin-bottom: 16px; }
 .listing:hover { border-color: var(--accent); }
 .listing .title { font-size: 19px; font-weight: 700; margin: 0 0 4px; letter-spacing: -.01em; }
 .listing .org { font-size: 14.5px; color: var(--ink-muted); margin: 0 0 12px; }
 .listing .meta { display: flex; gap: 26px; flex-wrap: wrap; font-size: 14.5px; margin-bottom: 13px; }
 .listing .meta b { display: block; font-size: 12px; color: var(--ink-muted);
                    text-transform: uppercase; letter-spacing: .06em; }
 .listing .elig { font-size: 14.5px; color: var(--ink-muted); border-top: 1px solid var(--line-soft);
                  padding-top: 12px; margin-bottom: 14px; }
 .apply-link { display: inline-block; font-weight: 700; font-size: 15.5px; color: #fff;
               background: var(--accent); padding: 9px 20px; border-radius: var(--radius);
               text-decoration: none; border-bottom: 3px solid var(--accent-dk); }
 .apply-link:hover { background: #0d5533; }
 .apply-link:focus { outline: 3px solid var(--focus); outline-offset: 1px; }

 footer.site { border-top: 1px solid var(--line); background: var(--panel);
               padding: 26px 0; font-size: 13.5px; color: var(--ink-muted); }

 @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style></head>
<body>
<div class="gov-bar"><div class="wrap">
  <span><span class="tricolour"><i></i><i></i><i></i></span>Government of India &middot; Ministry of Education</span>
  <span>Academic Year 2026-27</span>
</div></div>

<header class="masthead"><div class="wrap">
  <div class="crest">NSP</div>
  <div>
    <h1>National Scholarship Gateway</h1>
    <p>Single-window application for centrally sponsored scholarship schemes</p>
  </div>
</div></header>

<nav class="primary"><div class="wrap">
  <a href="/">Schemes</a>
  <a href="/apply/${opp.id}" aria-current="page">Apply</a>
  <a href="/">Track application</a>
  <a href="/">Documents</a>
  <a href="/">Help</a>
</div></nav>

<main><div class="wrap">
<div class="notice"><strong>Demo fixture.</strong> This is a local replica used to demonstrate ApplyOnce.
No data leaves this machine and the submit button is intentionally disabled.${v2 ? ' <em>Layout v2: element ids and classes differ from v1.</em>' : ''}</div>

<div class="scheme-head">
  <div class="kicker">Merit-cum-means scholarship</div>
  <h2>${opp.title}</h2>
  <dl class="facts">
    <div class="fact"><dt>Offered by</dt><dd>${opp.org}</dd></div>
    <div class="fact"><dt>Award</dt><dd>${opp.award}</dd></div>
    <div class="fact"><dt>Last date</dt><dd class="due">${opp.deadline}</dd></div>
    <div class="fact"><dt>Mode</dt><dd>Online only</dd></div>
  </dl>
</div>

<ol class="steps">
  <li class="step"><b>Step 1</b>Registration</li>
  <li class="step" aria-current="step"><b>Step 2</b>Application form</li>
  <li class="step"><b>Step 3</b>Document upload</li>
  <li class="step"><b>Step 4</b>Institute verification</li>
</ol>

<form id="${id('application_form', 'applyForm')}" onsubmit="event.preventDefault();document.getElementById('done').textContent='Fixture: submission intentionally disabled.';">

  <h3 class="section-title">1. Personal details</h3>
  <div class="grid-2">
  ${text('First name', id('first_name', 'fname_v2'), 'text', true)}
  ${text('Last name', id('last_name', 'lname_v2'))}
  ${text('Name as per Aadhaar', id('aadhaar_name', 'aadhaarName_v2'), 'text', false, 'Must match your Aadhaar exactly. A mismatch will fail verification.')}
  ${text("Father's Name", id('father_name', 'fatherName_v2'))}
  ${text('Date of Birth', id('dob', 'birthDate_v2'), 'date', true)}
  ${text('Email Address', id('email', 'emailId_v2'), 'email', true)}
  ${text('Contact number', id('phone', 'mobileNo_v2'), 'tel', true)}

  <div class="${group}">
    <label for="${id('gender', 'gender_v2')}">Gender *</label>
    <select class="${cls}" id="${id('gender', 'gender_v2')}" name="gender">
      <option>--Select--</option><option>Male</option><option>Female</option><option>Other</option>
    </select>
  </div>
  <div class="${group}">
    <label for="${id('category', 'category_v2')}">Category</label>
    <select class="${cls}" id="${id('category', 'category_v2')}" name="category">
      <option>--Select--</option><option>General</option><option>OBC</option><option>SC</option><option>ST</option><option>EWS</option>
    </select>
  </div>

  </div>
  <h3 class="section-title">2. Address of communication</h3>
  <div class="grid-2">
  ${text('Address Line 1', id('address1', 'addr1_v2'), 'text', true)}
  <div class="${group}">
    <label for="${id('state', 'state_v2')}">State *</label>
    <select class="${cls}" id="${id('state', 'state_v2')}" name="state" onchange="loadDistricts(this.value)">
      ${stateOptions.map((s) => `<option>${s}</option>`).join('')}
    </select>
  </div>
  <div class="${group}">
    <label for="${id('district', 'district_v2')}">District *</label>
    <select class="${cls}" id="${id('district', 'district_v2')}" name="district">
      <option>--Select District--</option>
    </select>
  </div>
  ${text('PIN Code', id('pincode', 'pin_v2'), 'text', true, '6 digits.')}

  </div>
  <h3 class="section-title">3. Academic details</h3>
  <div class="grid-2">
  ${text('College', id('college', 'collegeName_v2'), 'text', true)}
  ${text('Degree', id('degree', 'degreeName_v2'))}
  ${text('Stream', id('stream', 'streamName_v2'))}
  ${text('Start year', id('start_year', 'startYr_v2'), 'number')}
  ${text('End year', id('end_year', 'endYr_v2'), 'number')}
  ${text('Class 10 Percentage', id('tenth_pct', 'tenthPct_v2'), 'number')}
  ${text('Class 12 Percentage', id('twelfth_pct', 'twelfthPct_v2'), 'number')}
  ${text('Annual Family Income', id('family_income', 'famIncome_v2'), 'number', false, 'In rupees, as stated on your income certificate.')}

  </div>
  <h3 class="section-title">4. Supporting documents</h3>
  <div class="grid-2">
  <div class="${group}"><label for="${id('custom_resume', 'resumeFile_v2')}">Upload resume</label>
    <input class="${cls}" type="file" id="${id('custom_resume', 'resumeFile_v2')}" name="resume" /></div>
  <div class="${group}"><label for="${id('profile_pic', 'photoFile_v2')}">Profile picture</label>
    <input class="${cls}" type="file" id="${id('profile_pic', 'photoFile_v2')}" name="photo" /></div>
  <div class="${group}"><label for="${id('income_cert', 'incomeCert_v2')}">Income Certificate</label>
    <input class="${cls}" type="file" id="${id('income_cert', 'incomeCert_v2')}" name="income_certificate" /></div>

  </div>
  <h3 class="section-title">5. Declaration and statement of purpose</h3>
  <div class="${group}"><label for="${id('why_role', 'whyRole_v2')}">Why should you be hired for this role?</label>
    <textarea class="${cls}" id="${id('why_role', 'whyRole_v2')}" name="why_role"></textarea></div>
  <div class="${group}"><label for="${id('career_goal', 'careerGoal_v2')}">Career objective</label>
    <textarea class="${cls}" id="${id('career_goal', 'careerGoal_v2')}" name="career_goal"></textarea></div>
  <div class="${group}"><label for="${id('availability', 'avail_v2')}">Confirm your availability</label>
    <textarea class="${cls}" id="${id('availability', 'avail_v2')}" name="availability"></textarea></div>

  <div class="${group}"><label for="${id('pet_dinosaur', 'petDino_v2')}">Do you own a pet dinosaur?</label>
    <input class="${cls}" type="text" id="${id('pet_dinosaur', 'petDino_v2')}" name="pet" /></div>

  <div class="actions">
    <button type="submit" id="submit_application">Submit application</button>
    <span class="save-note">Once submitted, the application cannot be edited.</span>
  </div>
  <p id="done"></p>
</form>
</div></main>

<footer class="site"><div class="wrap">
  National Scholarship Gateway &middot; Demo fixture for ApplyOnce &middot; Not a government service
</div></footer>

<script>
 const DISTRICTS = ${JSON.stringify(districtsByState)};
 function loadDistricts(state){
   const sel = document.getElementById('${id('district', 'district_v2')}');
   sel.innerHTML = '<option>--Select District--</option>';
   (DISTRICTS[state]||[]).forEach(d=>{ const o=document.createElement('option'); o.textContent=d; sel.appendChild(o); });
 }
</script>
</body></html>`;
}

function listingHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>National Scholarship Gateway</title>
<style>
 :root { --ink:#0b0c0c; --ink-muted:#505a5f; --line:#b1b4b6; --line-soft:#e5e7e8;
         --panel:#f3f2f1; --accent:#10643c; --accent-dk:#0a4527; --focus:#ffdd00;
         --saffron:#d4691a; --error:#b81f27; --radius:4px; }
 * { box-sizing:border-box; }
 body { margin:0; background:#fff; color:var(--ink); font-size:17px; line-height:1.55;
        font-family:"Inter",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;
        -webkit-font-smoothing:antialiased; }
 .wrap { max-width:1060px; margin:0 auto; padding:0 22px; }
 .gov-bar { background:var(--ink); color:#fff; font-size:13px; padding:7px 0; }
 .gov-bar .wrap { display:flex; justify-content:space-between; gap:16px; }
 .tricolour { display:inline-flex; height:11px; width:17px; border:1px solid #4b4f52;
              flex-direction:column; margin-right:9px; vertical-align:-1px; }
 .tricolour i { flex:1; display:block; }
 .tricolour i:nth-child(1){background:#ff9933;} .tricolour i:nth-child(2){background:#fff;}
 .tricolour i:nth-child(3){background:#138808;}
 header.masthead { background:var(--accent); color:#fff; padding:20px 0 18px; }
 header.masthead .wrap { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
 .crest { width:46px; height:46px; border-radius:50%; background:#fff; color:var(--accent);
          display:grid; place-items:center; font-weight:800; font-size:18px; flex-shrink:0; }
 .masthead h1 { font-size:22px; margin:0; font-weight:700; line-height:1.25; letter-spacing:-.01em; }
 .masthead p { margin:2px 0 0; font-size:13.5px; opacity:.88; }
 nav.primary { background:var(--accent-dk); }
 nav.primary .wrap { display:flex; gap:26px; overflow-x:auto; }
 nav.primary a { color:#fff; text-decoration:none; font-size:14.5px; padding:12px 0;
                 border-bottom:3px solid transparent; white-space:nowrap; }
 nav.primary a[aria-current] { border-bottom-color:#fff; font-weight:600; }
 main { padding:30px 0 60px; }
 .notice { border-left:5px solid var(--saffron); background:#fff8f2; padding:13px 18px;
           margin-bottom:26px; font-size:14.5px; border-radius:0 var(--radius) var(--radius) 0; }
 .notice strong { color:#8a4210; }
 .page-title { border-bottom:3px solid var(--ink); padding-bottom:16px; margin-bottom:8px; }
 .page-title h2 { font-size:29px; margin:0 0 6px; letter-spacing:-.015em; }
 .page-title p { margin:0; color:var(--ink-muted); font-size:15px; }
 .result-count { font-size:14px; color:var(--ink-muted); margin:18px 0 16px; }
 .listing { border:1px solid var(--line); border-radius:var(--radius); padding:20px 22px; margin-bottom:16px; }
 .listing:hover { border-color:var(--accent); }
 .listing .title { font-size:19px; font-weight:700; margin:0 0 4px; letter-spacing:-.01em; }
 .listing .org { font-size:14.5px; color:var(--ink-muted); margin:0 0 12px; }
 .listing .meta { display:flex; gap:26px; flex-wrap:wrap; font-size:14.5px; margin-bottom:13px; }
 .listing .meta b { display:block; font-size:12px; color:var(--ink-muted);
                    text-transform:uppercase; letter-spacing:.06em; }
 .listing .meta .due { color:var(--error); font-weight:600; }
 .listing .elig { font-size:14.5px; color:var(--ink-muted); border-top:1px solid var(--line-soft);
                  padding-top:12px; margin-bottom:14px; }
 .apply-link { display:inline-block; font-weight:700; font-size:15.5px; color:#fff;
               background:var(--accent); padding:9px 20px; border-radius:var(--radius);
               text-decoration:none; border-bottom:3px solid var(--accent-dk); }
 .apply-link:hover { background:#0d5533; }
 .apply-link:focus { outline:3px solid var(--focus); outline-offset:1px; }
 footer.site { border-top:1px solid var(--line); background:var(--panel); padding:26px 0;
               font-size:13.5px; color:var(--ink-muted); }
 @media (prefers-reduced-motion: reduce) { * { transition:none !important; } }
</style></head>
<body>
<div class="gov-bar"><div class="wrap">
  <span><span class="tricolour"><i></i><i></i><i></i></span>Government of India &middot; Ministry of Education</span>
  <span>Academic Year 2026-27</span>
</div></div>
<header class="masthead"><div class="wrap">
  <div class="crest">NSP</div>
  <div><h1>National Scholarship Gateway</h1>
  <p>Single-window application for centrally sponsored scholarship schemes</p></div>
</div></header>
<nav class="primary"><div class="wrap">
  <a href="/" aria-current="page">Schemes</a>
  <a href="/">Track application</a>
  <a href="/">Documents</a>
  <a href="/">Help</a>
</div></nav>
<main><div class="wrap">
  <div class="notice"><strong>Demo fixture.</strong> A local replica used to demonstrate ApplyOnce.
  Not a government service. No data leaves this machine.</div>
  <div class="page-title">
    <h2>Open schemes</h2>
    <p>Schemes currently accepting applications for the 2026-27 academic year.</p>
  </div>
  <p class="result-count">${OPPORTUNITIES.length} schemes open</p>
${OPPORTUNITIES.map((o) => `
  <article class="listing" data-opportunity-id="${o.id}" data-kind="${o.kind}">
    <h3 class="title">${o.title}</h3>
    <p class="org">${o.org}</p>
    <div class="meta">
      <span><b>Award</b>${o.award}</span>
      <span><b>Last date</b><span class="due">${o.deadline}</span></span>
      <span><b>Type</b>${o.kind === 'scholarship' ? 'Scholarship' : 'Internship'}</span>
    </div>
    <p class="elig">${o.eligibility}</p>
    <a class="apply-link" href="/apply/${o.id}">Apply now</a>
  </article>`).join('')}
</div></main>
<footer class="site"><div class="wrap">
  National Scholarship Gateway &middot; Demo fixture for ApplyOnce &middot; Not a government service
</div></footer>
</body></html>`;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(listingHtml());
    return;
  }
  if (url.pathname === '/api/opportunities') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(OPPORTUNITIES));
    return;
  }
  const apply = url.pathname.match(/^\/apply\/([\w-]+)$/);
  if (apply) {
    const opp = OPPORTUNITIES.find((o) => o.id === apply[1]);
    if (!opp) { res.writeHead(404); res.end('Unknown opportunity'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(formHtml(opp, url.searchParams.get('layout') === 'v2'));
    return;
  }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  process.stdout.write(`ApplyOnce fixture portal on http://localhost:${PORT}\n`);
  process.stdout.write(`  listings : http://localhost:${PORT}/\n`);
  process.stdout.write(`  form v1  : http://localhost:${PORT}/apply/sch-medhavi-2026\n`);
  process.stdout.write(`  form v2  : http://localhost:${PORT}/apply/sch-medhavi-2026?layout=v2  (self-heal demo)\n`);
});
