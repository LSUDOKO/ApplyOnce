import { describe, it, expect } from 'vitest';
import { buildFillPlan, detectPortal, formatForField, type FormField } from './fill-application.js';
import { evaluateCriteria } from './check-eligibility.js';
import { parseDeadline, classifyUrgency } from './track-deadlines.js';
import { resolveWithValue } from '../mapping/field-map.js';
import sampleProfile from '../../data/profiles/sample_profile.json' with { type: 'json' };
import type { StudentProfile } from '../profile/loader.js';

const profile = sampleProfile as unknown as StudentProfile;

const field = (over: Partial<FormField>): FormField => ({
  label: 'Full Name', selector: '#name', tag: 'input', type: 'text', required: false, ...over,
});

describe('detectPortal', () => {
  it('routes Internshala URLs to the internshala adapter', () => {
    expect(detectPortal('https://internshala.com/internship/detail/x123')).toBe('internshala');
  });
  it('routes everything else to the scholarship adapter', () => {
    expect(detectPortal('https://www.buddy4study.com/page/some-scholarship')).toBe('scholarship');
  });
});

describe('buildFillPlan — HARD RULE 1 (never targets a submit control)', () => {
  it('excludes a field whose selector looks like a submit button', () => {
    const plan = buildFillPlan([
      field({ label: 'Full Name', selector: '#first_name' }),
      field({ label: 'Full Name', selector: 'button[type=submit]' }),
    ], profile);
    expect(Object.keys(plan.values)).toContain('#first_name');
    expect(Object.keys(plan.values)).not.toContain('button[type=submit]');
  });

  it('excludes a field whose LABEL is a submit action', () => {
    const plan = buildFillPlan([field({ label: 'Submit Application', selector: '#go' })], profile);
    expect(Object.keys(plan.values)).toHaveLength(0);
  });

  it('excludes payment controls', () => {
    const plan = buildFillPlan([field({ label: 'Proceed to Payment', selector: '#pay' })], profile);
    expect(Object.keys(plan.values)).toHaveLength(0);
  });
});

describe('buildFillPlan — mapping behaviour', () => {
  it('fills text fields it can map from the profile', () => {
    const plan = buildFillPlan([
      field({ label: 'First name', selector: '#first_name' }),
      field({ label: 'Contact number', selector: '#phone' }),
    ], profile);
    expect(plan.values['#first_name']).toBe('Arpit');
    expect(plan.values['#phone']).toBe('9876543210');
  });

  it('routes file inputs to the uploads map, not the text map', () => {
    const plan = buildFillPlan([
      field({ label: 'Upload resume', selector: '#custom_resume', type: 'file' }),
    ], profile);
    expect(plan.files['#custom_resume']).toContain('resume.pdf');
    expect(plan.values['#custom_resume']).toBeUndefined();
  });

  it('matches a dropdown option instead of typing into a select', () => {
    const plan = buildFillPlan([
      field({ label: 'Category', selector: '#cat', tag: 'select', options: ['General', 'OBC', 'SC', 'ST'] }),
    ], profile);
    expect(plan.selects['#cat']).toBe('OBC');
  });

  it('reports a dropdown with no matching option as unmapped rather than guessing', () => {
    const plan = buildFillPlan([
      field({ label: 'Category', selector: '#cat', tag: 'select', options: ['Alpha', 'Beta'] }),
    ], profile);
    expect(plan.selects['#cat']).toBeUndefined();
    expect(plan.unmapped.some((u) => u.selector === '#cat')).toBe(true);
  });

  it('reports labels it cannot map, so a human can fill them', () => {
    const plan = buildFillPlan([
      field({ label: 'Do you own a spaceship?', selector: '#ship', required: true }),
    ], profile);
    expect(plan.unmapped).toHaveLength(1);
    expect(plan.unmapped[0].required).toBe(true);
  });

  it('never silently drops a field', () => {
    const fields = [
      field({ label: 'First name', selector: '#a' }),
      field({ label: 'Nonsense XYZ', selector: '#b' }),
      field({ label: 'Upload resume', selector: '#c', type: 'file' }),
    ];
    const plan = buildFillPlan(fields, profile);
    const accounted = Object.keys(plan.values).length + Object.keys(plan.files).length
      + Object.keys(plan.selects).length + plan.unmapped.length;
    expect(accounted).toBe(fields.length);
  });
});

describe('formatForField', () => {
  it('formats a date as DD/MM/YYYY for a text input, ISO for a native date input', () => {
    const resolved = resolveWithValue('Date of Birth', profile);
    expect(formatForField(resolved, field({ type: 'text' }))).toBe('15/07/2004');
    expect(formatForField(resolved, field({ type: 'date' }))).toBe('2004-07-15');
  });

  it('joins a skills array into a comma string', () => {
    const resolved = resolveWithValue('Skills', profile);
    expect(formatForField(resolved, field({}))).toContain('Python');
    expect(formatForField(resolved, field({}))).toContain(', ');
  });
});

describe('evaluateCriteria — shows its reasoning', () => {
  it('passes an income ceiling the student is under', () => {
    const checks = evaluateCriteria('Family income should be less than INR 6 lakh per annum', profile);
    const income = checks.find((c) => c.criterion === 'Family income ceiling');
    expect(income?.verdict).toBe('pass');
    expect(income?.reason).toContain('within');
  });

  it('fails an income ceiling the student exceeds', () => {
    const checks = evaluateCriteria('Annual income must be below INR 1 lakh', profile);
    expect(checks.find((c) => c.criterion === 'Family income ceiling')?.verdict).toBe('fail');
  });

  it('fails a girls-only scheme for a male profile', () => {
    const checks = evaluateCriteria('Only girls studying in the first year of graduation can apply', profile);
    expect(checks.find((c) => c.criterion === 'Gender-restricted scheme')?.verdict).toBe('fail');
  });

  it('passes a minimum-marks bar the student clears', () => {
    const checks = evaluateCriteria('Candidates must have scored minimum 60% in the last exam', profile);
    expect(checks.find((c) => c.criterion === 'Minimum marks')?.verdict).toBe('pass');
  });

  it('fails a minimum-marks bar the student misses', () => {
    const checks = evaluateCriteria('Candidates must have scored minimum 95% in the last exam', profile);
    expect(checks.find((c) => c.criterion === 'Minimum marks')?.verdict).toBe('fail');
  });

  it('fails a closed application window', () => {
    const checks = evaluateCriteria('Open to all', profile, { deadlineIso: '2020-01-01' });
    expect(checks.find((c) => c.criterion === 'Application window is open')?.verdict).toBe('fail');
  });

  it('flags a school-only scheme as a fail for a UG student', () => {
    const checks = evaluateCriteria('For students in Class 1 to 12, school students only', profile);
    expect(checks.find((c) => c.criterion === 'Level of study')?.verdict).toBe('fail');
  });

  it('returns unknown rather than guessing when income is unparseable', () => {
    const thin = { ...profile, family: {} } as unknown as StudentProfile;
    const checks = evaluateCriteria('Family income should be less than INR 6 lakh', thin);
    expect(checks.find((c) => c.criterion === 'Family income ceiling')?.verdict).toBe('unknown');
  });

  it('produces no checks for criteria text it does not understand', () => {
    expect(evaluateCriteria('Applicants must enjoy long walks.', profile)).toHaveLength(0);
  });
});

describe('parseDeadline', () => {
  it("parses Internshala's abbreviated form", () => {
    expect(parseDeadline("5 Sep' 26", null)).toBe('2026-09-05');
  });
  it('parses a full date', () => {
    expect(parseDeadline('5 October 2026', null)).toBe('2026-10-05');
  });
  it('prefers an ISO value when the adapter already normalised it', () => {
    expect(parseDeadline('anything', '2026-12-31')).toBe('2026-12-31');
  });
  it('returns null for unparseable input', () => {
    expect(parseDeadline('rolling basis', null)).toBeNull();
    expect(parseDeadline(null, null)).toBeNull();
  });
});

describe('classifyUrgency', () => {
  it('classifies by days remaining', () => {
    expect(classifyUrgency(-1)).toBe('closed');
    expect(classifyUrgency(0)).toBe('critical');
    expect(classifyUrgency(3)).toBe('critical');
    expect(classifyUrgency(10)).toBe('soon');
    expect(classifyUrgency(40)).toBe('upcoming');
    expect(classifyUrgency(null)).toBe('unknown');
  });
});
