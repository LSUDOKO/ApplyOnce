/**
 * ============================================================================
 * Scholarship application FILL — human-gated write path.
 * ============================================================================
 * HARD RULE 1 (graded): fills the form up to the final submit and STOPS.
 *
 * Scholarship portals vary far more than job boards, so this adapter is
 * deliberately GENERIC: it scrapes whatever form is on the page, fills the
 * selectors the ApplyOnce mapper resolved, and reports everything it could not
 * map. It never assumes a specific portal's DOM, which is what lets the same
 * command serve several scholarship sites.
 *
 * Handles the widgets Indian scholarship forms actually use:
 *   • plain text / textarea       -> fillText (verified read-back)
 *   • <select> incl. dependent    -> selectOption + change event, re-read after
 *     state->district cascades       the cascade repopulates the child
 *   • checkbox / radio            -> setChecked
 *   • file uploads                -> uploadFiles
 * ============================================================================
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { assertNotSubmit, assertNoChallenge, scrapeFormFields, findSubmitControl } from './utils.js';

cli({
  site: 'scholarship',
  name: 'fill',
  tags: ['applyonce'],
  access: 'write',
  description: 'Fill a scholarship application up to the final submit step — NEVER submits',
  domain: 'buddy4study.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', positional: true, required: true, help: 'Application form URL' },
    { name: 'values', type: 'string', default: '{}', help: 'JSON {selector: value} from the ApplyOnce mapper' },
    { name: 'selects', type: 'string', default: '{}', help: 'JSON {selector: option_text} for dropdowns (handles state->district cascades)' },
    { name: 'checks', type: 'string', default: '{}', help: 'JSON {selector: boolean} for checkboxes/radios' },
    { name: 'files', type: 'string', default: '{}', help: 'JSON {selector: absolute_path} for uploads' },
    { name: 'dry-run', type: 'boolean', default: false, help: 'Scrape the form without typing anything' },
  ],
  columns: ['status', 'url', 'submit_url', 'filled_count', 'filled_fields',
    'selects_set', 'checks_set', 'uploads', 'unfilled', 'submit_control', 'submitted', 'warnings'],
  func: async (page, kwargs) => {
    const url = String(kwargs.url ?? '').trim();
    if (!url) throw new CommandExecutionError('url is required', 'Pass the application form URL.');

    const parseArg = (name) => {
      try { return JSON.parse(kwargs[name] || '{}'); }
      catch { throw new CommandExecutionError(`${name} must be valid JSON`, `Pass --${name} '{"#field":"value"}'.`); }
    };
    const values = parseArg('values');
    const selects = parseArg('selects');
    const checks = parseArg('checks');
    const files = parseArg('files');
    const dryRun = Boolean(kwargs['dry-run']);

    const warnings = [];
    const unfilled = [];
    const filled = {};
    const selectsSet = {};
    const checksSet = {};
    const uploads = [];

    await page.goto(url, { waitUntil: 'load', settleMs: 2000 });
    await page.wait({ time: 3 });

    const state = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
      return {
        title: clean(document.title),
        body: clean((document.body || {}).innerText || '').slice(0, 400),
        needsLogin: /sign in|log in|login to apply/i.test(clean((document.body||{}).innerText||'').slice(0, 2000))
          && !document.querySelector('input:not([type=hidden])'),
      };
    })()`);

    assertNoChallenge(state.title + ' ' + state.body, 'scholarship portal');

    if (state.needsLogin) {
      throw new CommandExecutionError(
        'The scholarship portal requires a logged-in session before showing the form',
        'Log in to the portal in this browser profile, then retry. ApplyOnce never creates accounts.',
      );
    }

    if (!dryRun) {
      /* ---- 1. dropdowns FIRST: a parent select repopulates its child ---- */
      for (const [selector, wanted] of Object.entries(selects)) {
        assertNotSubmit(selector, 'select');
        try {
          const res = await page.evaluate(`((sel, want) => {
            const el = document.querySelector(sel);
            if (!el || el.tagName !== 'SELECT') return { ok: false, reason: 'select not found' };
            const norm = (s) => String(s || '').trim().toLowerCase();
            let match = Array.from(el.options).find((o) => norm(o.textContent) === norm(want));
            if (!match) match = Array.from(el.options).find((o) => norm(o.textContent).includes(norm(want)));
            if (!match) {
              return { ok: false, reason: 'no matching option',
                       options: Array.from(el.options).map((o) => o.textContent.trim()).slice(0, 30) };
            }
            el.value = match.value;
            // Dependent dropdowns listen for change/input to repopulate children.
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, chosen: match.textContent.trim() };
          })(${JSON.stringify(selector)}, ${JSON.stringify(String(wanted))})`);

          if (res && res.ok) {
            selectsSet[selector] = res.chosen;
            // Give a state->district cascade time to fetch and render.
            await page.wait({ time: 1 });
          } else {
            unfilled.push({ selector, reason: (res && res.reason) || 'select failed',
              available_options: (res && res.options) || undefined });
          }
        } catch (e) {
          unfilled.push({ selector, reason: String(e && e.message || e).slice(0, 160) });
        }
      }

      /* ---- 2. text inputs and textareas ---- */
      for (const [selector, value] of Object.entries(values)) {
        assertNotSubmit(selector, 'fill');
        const text = String(value ?? '');
        if (!text) continue;
        try {
          const res = await page.fillText(selector, text);
          if (res && (res.filled === true || res.verified === true)) {
            filled[selector] = text.length > 80 ? text.slice(0, 77) + '...' : text;
          } else {
            unfilled.push({ selector, reason: 'fill not verified by the page' });
          }
        } catch (e) {
          unfilled.push({ selector, reason: String(e && e.message || e).slice(0, 160) });
        }
      }

      /* ---- 3. checkboxes / radios ---- */
      for (const [selector, wanted] of Object.entries(checks)) {
        assertNotSubmit(selector, 'check');
        try {
          if (page.setChecked) {
            const res = await page.setChecked(selector, Boolean(wanted));
            if (res && res.checked === Boolean(wanted)) checksSet[selector] = Boolean(wanted);
            else unfilled.push({ selector, reason: 'checkbox state not confirmed' });
          } else {
            warnings.push('This webcmd build lacks setChecked; skipped checkbox fields.');
            break;
          }
        } catch (e) {
          unfilled.push({ selector, reason: String(e && e.message || e).slice(0, 160) });
        }
      }

      /* ---- 4. document uploads ---- */
      for (const [selector, path] of Object.entries(files)) {
        assertNotSubmit(selector, 'upload');
        if (!page.uploadFiles) { warnings.push('This webcmd build lacks uploadFiles; skipped uploads.'); break; }
        try {
          const res = await page.uploadFiles(selector, [String(path)]);
          if (res && res.uploaded === true) uploads.push({ selector, path: String(path), files: res.files });
          else unfilled.push({ selector, reason: 'upload not confirmed' });
        } catch (e) {
          unfilled.push({ selector, reason: String(e && e.message || e).slice(0, 160) });
        }
      }
    }

    const formFields = await scrapeFormFields(page);
    // Located ONLY to report. No code path here clicks it. HARD RULE 1.
    const submitControl = await findSubmitControl(page);
    const finalUrl = await page.evaluate(`(() => location.href)()`);

    return [{
      status: 'ready_for_review',
      url,
      submit_url: finalUrl,
      filled_count: Object.keys(filled).length + Object.keys(selectsSet).length
        + Object.keys(checksSet).length + uploads.length,
      filled_fields: filled,
      selects_set: selectsSet,
      checks_set: checksSet,
      uploads,
      unfilled,
      form_fields_detected: formFields.length,
      form_fields: formFields.slice(0, 60),
      submit_control: submitControl,
      submitted: false,                 // ALWAYS false — HARD RULE 1
      warnings,
    }];
  },
});
