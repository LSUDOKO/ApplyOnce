/**
 * Tests for the graded HARD RULES. If any of these fail, the project has
 * violated a safety requirement — treat it as a build-breaking defect.
 */
import { describe, it, expect } from 'vitest';
import {
  assertNotSubmit, isSubmitLike, assertWriteAllowed, maskValue, maskDeep,
  isSensitiveKey, detectAntiBot, assertNoAntiBot, POLITENESS,
} from './safety.js';
import { ApplyOnceError } from './errors.js';

describe('HARD RULE 1 — never submit or pay', () => {
  const forbidden = [
    'Submit Application', 'final submit', 'Confirm and Submit', 'Apply Now',
    'Proceed to Payment', 'Make Payment', 'Pay Now', 'Checkout', 'Place Order',
    'Lock Application', 'I agree and submit', 'button[type=submit]', '#final-submit',
  ];

  it.each(forbidden)('blocks "%s"', (target) => {
    expect(() => assertNotSubmit(target)).toThrow(ApplyOnceError);
  });

  it('throws SUBMIT_BLOCKED with a recovery hint', () => {
    try {
      assertNotSubmit('Submit Application');
      throw new Error('should have thrown');
    } catch (e) {
      const err = e as ApplyOnceError;
      expect(err.code).toBe('SUBMIT_BLOCKED');
      expect(err.recoveryHint).toMatch(/never submits|manually/i);
    }
  });

  it('allows ordinary form fields through', () => {
    for (const ok of ['#first_name', 'Full Name', '#phone', 'Upload resume', '#college']) {
      expect(() => assertNotSubmit(ok)).not.toThrow();
    }
  });

  it('isSubmitLike classifies without throwing', () => {
    expect(isSubmitLike('Pay Now')).toBe(true);
    expect(isSubmitLike('#first_name')).toBe(false);
  });
});

describe('HARD RULE 3 — discovery is read-only', () => {
  it('rejects a write attempted in read mode', () => {
    expect(() => assertWriteAllowed('read', 'fillText')).toThrow(ApplyOnceError);
  });
  it('permits writes in fill mode', () => {
    expect(() => assertWriteAllowed('fill', 'fillText')).not.toThrow();
  });
});

describe('HARD RULE 4 — politeness, no evasion', () => {
  it('keeps a conservative request budget', () => {
    expect(POLITENESS.minDelayMs).toBeGreaterThanOrEqual(1000);
    expect(POLITENESS.maxAttempts).toBeLessThanOrEqual(2);
  });

  it('detects genuine anti-bot challenge pages', () => {
    expect(detectAntiBot('Just a moment...')).toBe('just a moment');
    expect(detectAntiBot('Please complete the CAPTCHA to continue')).toBe('captcha challenge');
    expect(detectAntiBot('Checking your browser before accessing')).toBe('checking your browser');
    expect(detectAntiBot('Access Denied')).toBe('access denied');
    expect(detectAntiBot('We have detected unusual traffic from your network')).toBe('unusual traffic');
  });

  it('does NOT false-positive on a page that merely loads a captcha library', () => {
    // Internshala embeds this on its listing page while serving 200 real cards.
    // Blocking here would refuse a perfectly good page (verified 2026-08-22).
    expect(detectAntiBot('var is_g_recaptcha = "6Lcqj0EsAAAAAL4K2T7";')).toBeNull();
    expect(detectAntiBot('<script src="https://www.google.com/recaptcha/api.js">')).toBeNull();
    expect(detectAntiBot('Front End Development internship')).toBeNull();
  });

  it('stops instead of retrying when challenged', () => {
    expect(() => assertNoAntiBot('Just a moment...', 'Internshala')).toThrow(ApplyOnceError);
    try {
      assertNoAntiBot('checking your browser', 'Internshala');
    } catch (e) {
      const err = e as ApplyOnceError;
      expect(err.code).toBe('ANTI_BOT_DETECTED');
      expect(err.recoveryHint).toMatch(/will not attempt to evade|manually/i);
    }
  });
});

describe('HARD RULE 5 — personal data never leaks into logs', () => {
  it('identifies sensitive keys', () => {
    expect(isSensitiveKey('aadhaar_number')).toBe(true);
    expect(isSensitiveKey('account_number')).toBe(true);
    expect(isSensitiveKey('IFSC')).toBe(true);
    expect(isSensitiveKey('full_name')).toBe(false);
  });

  it('masks all but the last four characters', () => {
    expect(maskValue('123456789012')).toBe('********9012');
    expect(maskValue('ab')).toBe('****');
  });

  it('masks sensitive leaves anywhere in a nested structure', () => {
    const masked = maskDeep({
      personal: { name: 'Arpit', email: 'a@b.com' },
      bank: { account_number: '34567890123', ifsc: 'SBIN0031234', bank_name: 'SBI' },
      identifiers: { aadhaar_number: '123456789012', pan: 'ABCDE1234F' },
    }) as Record<string, Record<string, string>>;

    expect(masked.personal.name).toBe('Arpit');           // not sensitive
    expect(masked.bank.bank_name).toBe('SBI');            // not sensitive
    expect(masked.bank.account_number).not.toContain('34567890');
    expect(masked.bank.account_number.endsWith('0123')).toBe(true);
    expect(masked.identifiers.aadhaar_number).not.toContain('12345678');
    expect(masked.identifiers.pan).not.toBe('ABCDE1234F');
  });

  it('leaves arrays and primitives intact', () => {
    expect(maskDeep(['a', 'b'])).toEqual(['a', 'b']);
    expect(maskDeep(null)).toBeNull();
    expect(maskDeep(42)).toBe(42);
  });
});
