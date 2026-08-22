/**
 * Shared helpers for every ApplyOnce adapter.
 *
 * The important idea here is `resolveWithFallbacks()`: a SELF-HEALING selector
 * resolver. Each logical element is described by an ORDERED list of strategies
 * — a stable attribute first, then an id, then a class, then a text/label
 * lookup. When a portal reskins, the early strategies break but a later one
 * still finds the element, and we report WHICH strategy won so the adapter can
 * surface that it healed rather than silently drifting.
 *
 * That is webcmd's "remembered pitfalls + fallback paths" idea, expressed as
 * data an adapter can carry.
 */

import { CommandExecutionError } from '@agentrhq/webcmd/errors';

/* ------------------------------------------------------------------ *
 * SAFETY — mirrored from src/safety.ts so the adapter is safe even when
 * executed directly by webcmd, outside the ApplyOnce MCP server.
 * HARD RULE 1: nothing here may click a final submit or a payment control.
 * ------------------------------------------------------------------ */
export const FORBIDDEN_ACTION_RE = new RegExp([
  'final\\s*submit', 'submit\\s*application', 'submit\\s*form',
  'confirm\\s*(and\\s*)?submit', 'proceed\\s*to\\s*pay(ment)?',
  'make\\s*payment', 'pay\\s*now', 'checkout', 'place\\s*order',
  'lock\\s*application', 'final\\s*(lock|freeze)',
].join('|'), 'i');

/** Throws rather than clicking anything that would submit or pay. */
export function assertNotSubmit(target, context = 'action') {
  const value = String(target ?? '');
  if (FORBIDDEN_ACTION_RE.test(value) || /type\s*=\s*["']?submit/i.test(value)) {
    throw new CommandExecutionError(
      `BLOCKED: refusing a submit/pay action during ${context}: "${value}"`,
      'ApplyOnce fills applications up to the final step only. Review and submit manually.',
    );
  }
}

/** Anti-bot markers — HARD RULE 4: we stop, we never try to evade. */
export function assertNoChallenge(pageText, site) {
  const haystack = String(pageText ?? '').toLowerCase();
  const marker = ['just a moment', 'checking your browser', 'captcha',
    'are you a robot', 'unusual traffic', 'access denied']
    .find((m) => haystack.includes(m));
  if (marker) {
    throw new CommandExecutionError(
      `${site} served an anti-bot challenge (matched "${marker}")`,
      `Open ${site} in your connected browser, clear it manually, then retry once.`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * SELF-HEALING ELEMENT RESOLUTION
 * ------------------------------------------------------------------ */

/**
 * Resolve one logical element by trying strategies in order.
 * Returns { selector, strategy, index, healed } or null.
 *
 * `healed` is true when strategy[0] failed but a later one succeeded — that is
 * precisely the "the portal changed and we recovered" signal.
 */
export async function resolveWithFallbacks(page, strategies, opts = {}) {
  const { label = 'element', required = false } = opts;

  const found = await page.evaluate(`((strategies) => {
    for (let i = 0; i < strategies.length; i++) {
      const s = strategies[i];
      try {
        if (s.css) {
          const el = document.querySelector(s.css);
          if (el) return { index: i, selector: s.css, kind: 'css' };
        }
        if (s.labelText) {
          const wanted = s.labelText.toLowerCase();
          const labels = Array.from(document.querySelectorAll('label'));
          for (const lb of labels) {
            const text = (lb.textContent || '').trim().toLowerCase();
            if (!text.includes(wanted)) continue;
            const forId = lb.getAttribute('for');
            if (forId && document.getElementById(forId)) {
              return { index: i, selector: '#' + CSS.escape(forId), kind: 'label' };
            }
            const nested = lb.querySelector('input, textarea, select');
            if (nested && nested.id) {
              return { index: i, selector: '#' + CSS.escape(nested.id), kind: 'label' };
            }
          }
        }
        if (s.buttonText) {
          const wanted = s.buttonText.toLowerCase();
          const buttons = Array.from(document.querySelectorAll('button, a, input[type=button]'));
          for (const b of buttons) {
            const text = ((b.textContent || b.value || '')).trim().toLowerCase();
            if (text && text.includes(wanted)) {
              if (b.id) return { index: i, selector: '#' + CSS.escape(b.id), kind: 'text' };
              if (b.className) {
                const cls = '.' + String(b.className).trim().split(/\\s+/).filter(Boolean).map((c) => CSS.escape(c)).join('.');
                if (document.querySelectorAll(cls).length >= 1) {
                  return { index: i, selector: cls, kind: 'text' };
                }
              }
            }
          }
        }
      } catch (e) { /* try the next strategy */ }
    }
    return null;
  })(${JSON.stringify(strategies)})`);

  if (!found) {
    if (required) {
      throw new CommandExecutionError(
        `Could not locate "${label}" using any of ${strategies.length} fallback strategies`,
        'The portal layout may have changed structurally. Re-author this adapter step.',
      );
    }
    return null;
  }

  return {
    selector: found.selector,
    strategy: found.kind,
    index: found.index,
    healed: found.index > 0,
    label,
  };
}

/** Read every visible form control with its human label. Feeds the field mapper. */
export async function scrapeFormFields(page) {
  return page.evaluate(`(() => {
    const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const out = [];
    const seen = new Set();
    const controls = document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select');

    /**
     * VISIBILITY (verified 2026-08-22): Internshala renders its application
     * form inside collapsed accordion sections, so every control reports
     * offsetParent === null and a zero-size rect even though the form is real
     * and fillable. Requiring on-screen geometry therefore found ZERO fields.
     *
     * We instead skip only controls explicitly removed via display:none on the
     * element itself, and always keep file inputs (they are styled away by
     * design on nearly every portal).
     */
    for (const el of controls) {
      if (el.type !== 'file') {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
      }
      let label = '';
      if (el.id) {
        const forLabel = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
        if (forLabel) label = clean(forLabel.textContent);
      }
      if (!label) {
        const wrapper = el.closest('.form-group, .field, .individual_question, .assessment_question, li, .row');
        if (wrapper) {
          const lb = wrapper.querySelector('label, .question, .field-label, .control-label');
          if (lb) label = clean(lb.textContent);
        }
      }
      if (!label) label = clean(el.getAttribute('placeholder') || el.getAttribute('aria-label') || el.name || el.id);
      if (!label) continue;

      const key = label + '|' + (el.id || el.name || '');
      if (seen.has(key)) continue;
      seen.add(key);

      const entry = {
        label,
        selector: el.id ? '#' + CSS.escape(el.id)
          : el.name ? el.tagName.toLowerCase() + '[name="' + el.name + '"]' : null,
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        required: !!el.required || /\\*/.test(label),
        value: el.type === 'file' ? '' : clean(el.value),
      };
      if (el.tagName === 'SELECT') {
        entry.options = Array.from(el.options).map((o) => clean(o.textContent)).filter(Boolean).slice(0, 200);
      }
      if (entry.selector) out.push(entry);
    }
    return out;
  })()`);
}

/** Does the page contain a final-submit control? We locate it only to REPORT it. */
export async function findSubmitControl(page) {
  return page.evaluate(`(() => {
    const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
    const candidates = Array.from(document.querySelectorAll('button, input[type=submit], a.btn'));
    for (const b of candidates) {
      const text = clean(b.textContent || b.value);
      if (/submit|apply|save and continue|final/i.test(text)) {
        return { text, id: b.id || null, disabled: !!b.disabled };
      }
    }
    return null;
  })()`);
}

export function requireNonEmpty(value, name) {
  const v = String(value ?? '').trim();
  if (!v) throw new CommandExecutionError(`Missing required argument: ${name}`, `Pass --${name} <value>.`);
  return v;
}

export function requireBoundedInt(value, fallback, max, name) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    throw new CommandExecutionError(`${name} must be a positive integer`, `Pass --${name} between 1 and ${max}.`);
  }
  return Math.min(Math.floor(n), max);
}

/** Absolute URL from an Internshala-style relative href. */
export function absoluteUrl(href, origin) {
  const value = String(href ?? '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return origin.replace(/\/$/, '') + (value.startsWith('/') ? value : '/' + value);
}
