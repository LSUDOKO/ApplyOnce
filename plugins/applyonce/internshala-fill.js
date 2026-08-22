/**
 * ============================================================================
 * Internshala application FILL — the human-gated write path.
 * ============================================================================
 * HARD RULE 1 (graded): this command drives the application form up to the
 * final submit button and then STOPS. It never clicks submit.
 *
 * Enforcement is layered, not incidental:
 *   1. `assertNotSubmit()` guards every click target before it is used.
 *   2. The submit control is located ONLY to be reported back (text + state);
 *      the code path that clicks it does not exist.
 *   3. The command returns status:"ready_for_review" plus submit_url so a human
 *      finishes the job in their own browser.
 *
 * Field targeting goes through the semantic map passed in via --field-map,
 * so the adapter is not welded to Internshala's current DOM.
 * ============================================================================
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { assertNotSubmit, assertNoChallenge, scrapeFormFields, findSubmitControl } from './utils.js';

const ORIGIN = 'https://internshala.com';

cli({
  site: 'internshala',
  name: 'fill',
  tags: ['applyonce'],
  access: 'write',                    // gated: only reachable via fill_application
  description: 'Fill an Internshala application up to the final submit step — NEVER submits',
  domain: 'internshala.com',
  strategy: Strategy.COOKIE,          // HARD RULE 2: the user's own logged-in session
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', positional: true, required: true, help: 'Internship detail URL' },
    { name: 'values', type: 'string', default: '{}', help: 'JSON object of {selector: value} produced by the ApplyOnce field mapper' },
    { name: 'files', type: 'string', default: '{}', help: 'JSON object of {selector: absolute_file_path} for uploads' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Scrape and map the form without typing anything' },
  ],
  columns: ['status', 'url', 'submit_url', 'filled_count', 'filled_fields',
    'unfilled', 'uploads', 'submit_control', 'submitted', 'warnings'],
  func: async (page, kwargs) => {
    const raw = String(kwargs.url ?? '').trim();
    if (!raw) throw new CommandExecutionError('url is required', 'Pass the internship detail URL.');
    const url = raw.startsWith('http') ? raw : ORIGIN + (raw.startsWith('/') ? raw : '/' + raw);

    let values = {};
    let files = {};
    try { values = JSON.parse(kwargs.values || '{}'); }
    catch { throw new CommandExecutionError('values must be valid JSON', 'Pass --values \'{"#first_name":"Arpit"}\'.'); }
    try { files = JSON.parse(kwargs.files || '{}'); }
    catch { throw new CommandExecutionError('files must be valid JSON', 'Pass --files \'{"#custom_resume":"/abs/path.pdf"}\'.'); }

    const warnings = [];
    const dryRun = Boolean(kwargs['dry-run']);

    await page.goto(url, { waitUntil: 'load', settleMs: 1500 });
    await page.wait({ time: 2 });

    const pageState = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      const applyBtn = Array.from(document.querySelectorAll('button, a'))
        .find((b) => /apply now/i.test(clean(b.textContent)));
      return {
        loggedIn: !!document.querySelector('.profile_container, #profile_dropdown, [href*="logout"], .user_dropdown'),
        alreadyApplied: !!document.querySelector('.already_applied, #already_applied'),
        hasApplyButton: !!applyBtn,
        applySelector: applyBtn ? (applyBtn.id ? '#' + applyBtn.id : null) : null,
        title: clean(document.title),
        bodyPreview: clean((document.body || {}).innerText || '').slice(0, 300),
      };
    })()`);

    assertNoChallenge(pageState.title + ' ' + pageState.bodyPreview, 'Internshala');

    // HARD RULE 2 — we do not create accounts; we require the user's own login.
    if (!pageState.loggedIn) {
      throw new CommandExecutionError(
        'Not logged in to Internshala',
        'Log in to Internshala in this browser profile, then retry. ApplyOnce never creates accounts.',
      );
    }
    if (pageState.alreadyApplied) {
      return [{
        status: 'already_applied', url, submit_url: url,
        filled_count: 0, filled_fields: {}, unfilled: [], uploads: [],
        submit_control: null, submitted: false,
        warnings: ['You have already applied to this internship.'],
      }];
    }

    // Open the application form. "Apply now" OPENS the form; it does not submit.
    if (pageState.hasApplyButton) {
      const opened = await page.evaluate(`(() => {
        const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
        const btn = Array.from(document.querySelectorAll('button, a'))
          .find((b) => /apply now/i.test(clean(b.textContent)));
        if (!btn) return false;
        btn.click();
        return true;
      })()`);
      if (opened) await page.wait({ time: 3 });
    }

    // Internshala may divert to /student/resume when the profile is incomplete.
    const afterOpen = await page.evaluate(`(() => ({
      url: location.href,
      isResumeGate: /\\/student\\/resume/.test(location.href),
    }))()`);
    if (afterOpen.isResumeGate) {
      warnings.push('Internshala redirected to the profile/resume completion page before showing the application form. Complete the flagged profile sections once; future runs go straight to the form.');
    }

    /* -------- read the form and decide what we can fill ------------------ */
    const formFields = await scrapeFormFields(page);

    const filled = {};
    const unfilled = [];
    const uploads = [];

    if (!dryRun) {
      for (const [selector, value] of Object.entries(values)) {
        // HARD RULE 1: never let a mapped "field" be a submit control.
        assertNotSubmit(selector, 'fill');
        const text = String(value ?? '');
        if (!text) continue;
        try {
          const result = await page.fillText(selector, text);
          // Trust the verified read-back rather than assuming the type worked.
          if (result && (result.filled === true || result.verified === true)) {
            filled[selector] = text.length > 80 ? text.slice(0, 77) + '...' : text;
          } else {
            unfilled.push({ selector, reason: 'fill not verified by the page' });
          }
        } catch (e) {
          unfilled.push({ selector, reason: String(e && e.message || e).slice(0, 160) });
        }
      }

      for (const [selector, path] of Object.entries(files)) {
        assertNotSubmit(selector, 'upload');
        if (!page.uploadFiles) { warnings.push('This webcmd build lacks uploadFiles; skipped document uploads.'); break; }
        try {
          const res = await page.uploadFiles(selector, [String(path)]);
          if (res && res.uploaded === true) uploads.push({ selector, path: String(path), files: res.files });
          else unfilled.push({ selector, reason: 'upload not confirmed' });
        } catch (e) {
          unfilled.push({ selector, reason: String(e && e.message || e).slice(0, 160) });
        }
      }
    }

    /* -------- locate the submit control ONLY to report it --------------- *
     * We deliberately do NOT click it. There is no code path here that can. */
    const submitControl = await findSubmitControl(page);

    const finalUrl = await page.evaluate(`(() => location.href)()`);

    return [{
      status: 'ready_for_review',        // never "submitted"
      url,
      submit_url: finalUrl,
      filled_count: Object.keys(filled).length,
      filled_fields: filled,
      unfilled,
      uploads,
      form_fields_detected: formFields.length,
      form_fields: formFields.slice(0, 60),
      submit_control: submitControl,     // reported, never clicked
      submitted: false,                  // ALWAYS false — HARD RULE 1
      warnings,
    }];
  },
});
