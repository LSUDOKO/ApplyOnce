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

  const text = (labelText, fieldId, type = 'text', required = false) => `
      <div class="${group}">
        <label for="${fieldId}">${labelText}${required ? ' *' : ''}</label>
        <input class="${cls}" type="${type}" id="${fieldId}" name="${fieldId}" ${required ? 'required' : ''} />
      </div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Apply — ${opp.title}</title>
<style>
 body{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
 h1{font-size:1.4rem} h2{font-size:1.05rem;margin-top:1.8rem;border-bottom:1px solid #ddd;padding-bottom:.3rem}
 .${group}{margin:.7rem 0;display:flex;flex-direction:column}
 label{font-size:.85rem;color:#444;margin-bottom:.25rem}
 .${cls},select,textarea{padding:.5rem;border:1px solid #bbb;border-radius:4px;font-size:.95rem}
 textarea{min-height:90px}
 .banner{background:#fff6d5;border:1px solid #e0c766;padding:.6rem .8rem;border-radius:6px;font-size:.85rem}
 button{margin-top:1.5rem;padding:.7rem 1.4rem;font-size:1rem;background:#00a5ec;color:#fff;border:0;border-radius:5px}
</style></head>
<body>
<p class="banner"><strong>ApplyOnce local fixture</strong> — a demo replica of a real Indian application form.
No data leaves this machine and the submit button is inert.${v2 ? ' <em>(v2 layout: ids and classes changed)</em>' : ''}</p>

<h1>${opp.title}</h1>
<p>${opp.org} &middot; ${opp.award} &middot; Apply by ${opp.deadline}</p>

<form id="${id('application_form', 'applyForm')}" onsubmit="event.preventDefault();document.getElementById('done').textContent='Fixture: submission intentionally disabled.';">

  <h2>Personal details</h2>
  ${text('First name', id('first_name', 'fname_v2'), 'text', true)}
  ${text('Last name', id('last_name', 'lname_v2'))}
  ${text('Name as per Aadhaar', id('aadhaar_name', 'aadhaarName_v2'))}
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

  <h2>Address</h2>
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
  ${text('PIN Code', id('pincode', 'pin_v2'), 'text', true)}

  <h2>Education</h2>
  ${text('College', id('college', 'collegeName_v2'), 'text', true)}
  ${text('Degree', id('degree', 'degreeName_v2'))}
  ${text('Stream', id('stream', 'streamName_v2'))}
  ${text('Start year', id('start_year', 'startYr_v2'), 'number')}
  ${text('End year', id('end_year', 'endYr_v2'), 'number')}
  ${text('Class 10 Percentage', id('tenth_pct', 'tenthPct_v2'), 'number')}
  ${text('Class 12 Percentage', id('twelfth_pct', 'twelfthPct_v2'), 'number')}
  ${text('Annual Family Income', id('family_income', 'famIncome_v2'), 'number')}

  <h2>Documents</h2>
  <div class="${group}"><label for="${id('custom_resume', 'resumeFile_v2')}">Upload resume</label>
    <input class="${cls}" type="file" id="${id('custom_resume', 'resumeFile_v2')}" name="resume" /></div>
  <div class="${group}"><label for="${id('profile_pic', 'photoFile_v2')}">Profile picture</label>
    <input class="${cls}" type="file" id="${id('profile_pic', 'photoFile_v2')}" name="photo" /></div>
  <div class="${group}"><label for="${id('income_cert', 'incomeCert_v2')}">Income Certificate</label>
    <input class="${cls}" type="file" id="${id('income_cert', 'incomeCert_v2')}" name="income_certificate" /></div>

  <h2>Questions</h2>
  <div class="${group}"><label for="${id('why_role', 'whyRole_v2')}">Why should you be hired for this role?</label>
    <textarea class="${cls}" id="${id('why_role', 'whyRole_v2')}" name="why_role"></textarea></div>
  <div class="${group}"><label for="${id('career_goal', 'careerGoal_v2')}">Career objective</label>
    <textarea class="${cls}" id="${id('career_goal', 'careerGoal_v2')}" name="career_goal"></textarea></div>
  <div class="${group}"><label for="${id('availability', 'avail_v2')}">Confirm your availability</label>
    <textarea class="${cls}" id="${id('availability', 'avail_v2')}" name="availability"></textarea></div>

  <div class="${group}"><label for="${id('pet_dinosaur', 'petDino_v2')}">Do you own a pet dinosaur?</label>
    <input class="${cls}" type="text" id="${id('pet_dinosaur', 'petDino_v2')}" name="pet" /></div>

  <button type="submit" id="submit_application">Submit application</button>
  <p id="done"></p>
</form>

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
<title>ApplyOnce demo portal</title>
<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem}
.card{border:1px solid #ddd;border-radius:8px;padding:1rem;margin:1rem 0}
.title{font-weight:600}.meta{color:#555;font-size:.88rem;margin:.3rem 0}</style></head><body>
<h1>ApplyOnce demo portal <small>(local fixture)</small></h1>
${OPPORTUNITIES.map((o) => `
<div class="card" data-opportunity-id="${o.id}" data-kind="${o.kind}">
  <div class="title">${o.title}</div>
  <div class="meta">${o.org} &middot; ${o.award}</div>
  <div class="meta">Deadline: ${o.deadline}</div>
  <div class="meta eligibility">${o.eligibility}</div>
  <a href="/apply/${o.id}">Apply now</a>
</div>`).join('')}
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
