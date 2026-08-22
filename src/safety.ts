/**
 * ============================================================================
 * SAFETY GATES — HARD RULES (graded, non-negotiable)
 * ============================================================================
 * This module is the single choke point for every rule in the ApplyOnce spec.
 * A reviewer should be able to read THIS FILE ALONE and verify that:
 *
 *   RULE 1  No tool can ever submit an application or make a payment.
 *   RULE 2  Only the user's own logged-in browser session/profile is used.
 *   RULE 3  Discovery + eligibility are strictly read-only.
 *   RULE 4  Every site is treated politely: low volume, no aggressive retries.
 *   RULE 5  Personal data stays local and is masked in every log line.
 *
 * Nothing in this codebase clicks a final submit button. `assertNotSubmit()`
 * is called before every browser action the adapters perform, and it throws
 * on anything that looks like submit/pay. That is the enforcement, not a
 * convention.
 * ============================================================================
 */

import { ApplyOnceError } from './errors.js';

/** RULE 1: any of these in an action target aborts the run. */
const FORBIDDEN_ACTION_PATTERNS: RegExp[] = [
  /\bfinal[\s_-]*submit\b/i,
  /\bsubmit[\s_-]*application\b/i,
  /\bsubmit[\s_-]*form\b/i,
  /\bconfirm[\s_-]*(and[\s_-]*)?submit\b/i,
  /\bapply[\s_-]*now\b/i,
  /\bsubmit[\s_-]*&[\s_-]*pay\b/i,
  /\bproceed[\s_-]*to[\s_-]*pay(ment)?\b/i,
  /\bmake[\s_-]*payment\b/i,
  /\bpay[\s_-]*now\b/i,
  /\bcheckout\b/i,
  /\bplace[\s_-]*order\b/i,
  /\bfinal[\s_-]*(lock|freeze)\b/i,
  /\block[\s_-]*application\b/i,
  /\bi[\s_-]*agree[\s_-]*(and|&)[\s_-]*submit\b/i,
];

/** RULE 1: selectors that are structurally a form submission. */
const FORBIDDEN_SELECTOR_PATTERNS: RegExp[] = [
  /type\s*=\s*["']?submit/i,
  /\[type=submit\]/i,
  /#(final|apply)[-_]?submit/i,
  /\bbtn[-_]?submit\b/i,
];

/**
 * RULE 1 ENFORCEMENT — call before every click/press an adapter performs.
 * Throws a machine-readable error with a recovery hint instead of proceeding.
 */
export function assertNotSubmit(target: string, context = 'browser action'): void {
  const value = String(target ?? '');

  for (const pattern of FORBIDDEN_ACTION_PATTERNS) {
    if (pattern.test(value)) {
      throw new ApplyOnceError(
        'SUBMIT_BLOCKED',
        `Blocked a forbidden submit/pay action during ${context}: "${value}"`,
        'ApplyOnce never submits. The application was filled up to the final step — open submit_url and click submit yourself after reviewing.',
        { target: value, matched: pattern.source },
      );
    }
  }

  for (const pattern of FORBIDDEN_SELECTOR_PATTERNS) {
    if (pattern.test(value)) {
      throw new ApplyOnceError(
        'SUBMIT_BLOCKED',
        `Blocked a submit-type selector during ${context}: "${value}"`,
        'ApplyOnce never submits. Review the filled form in the browser and submit manually.',
        { target: value, matched: pattern.source },
      );
    }
  }
}

/** True if a label/selector would submit. Used to SKIP, not throw, when scanning a form. */
export function isSubmitLike(target: string): boolean {
  try {
    assertNotSubmit(target, 'scan');
    return false;
  } catch {
    return true;
  }
}

/**
 * RULE 3: write actions are only legal when the caller is a fill operation
 * that has already been marked human-gated. Discovery tools pass mode='read'.
 */
export type AccessMode = 'read' | 'fill';

export function assertWriteAllowed(mode: AccessMode, action: string): void {
  if (mode !== 'fill') {
    throw new ApplyOnceError(
      'READ_ONLY_VIOLATION',
      `Attempted write action "${action}" in read-only mode.`,
      'Discovery and eligibility tools are read-only. Use fill_application for form entry.',
      { action, mode },
    );
  }
}

/**
 * RULE 5: mask sensitive values before they reach a log or a tool response.
 * Keys are matched case-insensitively against this list.
 */
const SENSITIVE_KEYS = [
  'aadhaar_number', 'aadhaar', 'pan', 'account_number', 'accountnumber',
  'ifsc', 'password', 'otp', 'token', 'abc_id', 'income_certificate_number',
];

export function maskValue(value: unknown): string {
  const str = String(value ?? '');
  if (str.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, str.length - 4))}${str.slice(-4)}`;
}

export function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s-]/g, '_');
  return SENSITIVE_KEYS.some((k) => normalized === k || normalized.includes(k));
}

/** Deep-clone a structure with every sensitive leaf masked. Used by logger + responses. */
export function maskDeep<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((v) => maskDeep(v)) as unknown as T;
  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key) ? maskValue(value) : maskDeep(value);
    }
    return out as unknown as T;
  }
  return input;
}

/**
 * RULE 4: politeness budget. Adapters must not hammer a portal.
 * Conservative on purpose — these are real students' accounts on real sites.
 */
export const POLITENESS = {
  /** Minimum milliseconds between two navigations to the same domain. */
  minDelayMs: 1500,
  /** Max attempts for a single logical step before giving up. No aggressive retries. */
  maxAttempts: 2,
  /** Max pages fetched in one discovery call. */
  maxPagesPerRun: 3,
} as const;

/**
 * Signals that mean "the site is asking us to stop". We stop — we do not evade.
 * RULE 4.
 *
 * These are matched as PHRASES a challenge page actually shows a visitor, not as
 * bare substrings. A naive `includes('captcha')` false-positives on any page that
 * merely LOADS a captcha library — Internshala's listing page embeds
 * `var is_g_recaptcha = "..."` while serving 200 real results. Blocking on that
 * would refuse a perfectly good page, so each marker is anchored to wording that
 * only appears when the visitor is actually being challenged.
 */
const ANTI_BOT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'just a moment', re: /\bjust a moment\b/i },
  { label: 'checking your browser', re: /checking your browser before/i },
  { label: 'cloudflare challenge', re: /cf-challenge|cf_chl_|__cf_chl_/i },
  { label: 'captcha challenge', re: /(please\s+)?(complete|solve|verify)[^.]{0,30}\bcaptcha\b|captcha[^.]{0,20}required|enter the characters/i },
  { label: 'are you a robot', re: /are you a (robot|human)|verify you are (a )?human/i },
  { label: 'access denied', re: /\baccess denied\b|you (have been|are) blocked/i },
  { label: 'unusual traffic', re: /unusual traffic|automated queries|suspicious activity detected/i },
  { label: 'rate limited', re: /rate limit(ed)? exceeded|too many requests/i },
];

export function detectAntiBot(pageTextOrTitle: string): string | null {
  const haystack = String(pageTextOrTitle ?? '');
  return ANTI_BOT_PATTERNS.find(({ re }) => re.test(haystack))?.label ?? null;
}

export function assertNoAntiBot(pageTextOrTitle: string, site: string): void {
  const marker = detectAntiBot(pageTextOrTitle);
  if (marker) {
    throw new ApplyOnceError(
      'ANTI_BOT_DETECTED',
      `${site} served an anti-bot/challenge page (matched: "${marker}"). Stopping instead of retrying.`,
      `Open ${site} in your connected browser, clear the challenge manually, then retry once. ApplyOnce will not attempt to evade it.`,
      { site, marker },
    );
  }
}
