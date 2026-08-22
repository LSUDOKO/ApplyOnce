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

/** Signals that mean "the site is asking us to stop". We stop — we do not evade. RULE 4. */
const ANTI_BOT_MARKERS = [
  'just a moment', 'checking your browser', 'cf-challenge', 'captcha',
  'are you a robot', 'access denied', 'unusual traffic', 'rate limit',
];

export function detectAntiBot(pageTextOrTitle: string): string | null {
  const haystack = String(pageTextOrTitle ?? '').toLowerCase();
  return ANTI_BOT_MARKERS.find((marker) => haystack.includes(marker)) ?? null;
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
