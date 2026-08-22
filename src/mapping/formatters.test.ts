import { describe, it, expect } from 'vitest';
import {
  formatDate, matchSelectOption, cgpaToPercentage, normaliseScore,
  fitToLimit, formatSkills, formatPhone,
} from './formatters.js';

describe('formatDate', () => {
  it('reformats ISO dates into common Indian portal formats', () => {
    expect(formatDate('2004-07-15', 'DD/MM/YYYY')).toBe('15/07/2004');
    expect(formatDate('2004-07-15', 'DD-MM-YYYY')).toBe('15-07-2004');
    expect(formatDate('2004-07-15', 'YYYY-MM-DD')).toBe('2004-07-15');
    expect(formatDate('2004-07-15', 'MM/DD/YYYY')).toBe('07/15/2004');
  });

  it('supports month-name formats', () => {
    expect(formatDate('2004-07-15', 'DD MMMM YYYY')).toBe('15 July 2004');
    expect(formatDate('2004-07-15', 'DD MMM YYYY')).toBe('15 Jul 2004');
  });

  it('returns the input unchanged when it is not an ISO date', () => {
    expect(formatDate('not-a-date', 'DD/MM/YYYY')).toBe('not-a-date');
    expect(formatDate('', 'DD/MM/YYYY')).toBe('');
  });
});

describe('matchSelectOption', () => {
  it('matches an exact option', () => {
    expect(matchSelectOption('Rajasthan', ['Punjab', 'Rajasthan', 'Kerala'])).toBe('Rajasthan');
  });

  it('maps category enums onto portal wording', () => {
    expect(matchSelectOption('obc', ['General', 'OBC', 'SC', 'ST'], 'category')).toBe('OBC');
    expect(matchSelectOption('obc', ['GEN', 'OBC-NCL', 'SC'], 'category')).toBe('OBC-NCL');
    expect(matchSelectOption('general', ['Unreserved', 'SC', 'ST'], 'category')).toBe('Unreserved');
    expect(matchSelectOption('ews', ['General', 'EWS', 'OBC'], 'category')).toBe('EWS');
  });

  it('maps gender enums onto portal wording', () => {
    expect(matchSelectOption('male', ['Male', 'Female', 'Other'], 'gender')).toBe('Male');
    expect(matchSelectOption('transgender', ['Male', 'Female', 'Other'], 'gender')).toBe('Other');
  });

  it('returns null rather than guessing when nothing fits', () => {
    expect(matchSelectOption('Rajasthan', ['Punjab', 'Kerala'])).toBeNull();
    expect(matchSelectOption('', ['A', 'B'])).toBeNull();
    expect(matchSelectOption('Anything', [])).toBeNull();
  });

  it('prefers the longest containment match', () => {
    expect(matchSelectOption('OBC', ['O', 'OBC (Non-Creamy Layer)', 'B'])).toBe('OBC (Non-Creamy Layer)');
  });
});

describe('score conversion', () => {
  it('converts CGPA to percentage on the standard 9.5 multiplier', () => {
    expect(cgpaToPercentage(8.7)).toBe(82.65);
    expect(cgpaToPercentage(10)).toBe(95);
  });

  it('handles non-10 scales proportionally', () => {
    expect(cgpaToPercentage(3.6, 4)).toBe(90);
  });

  it('passes through when the wanted type already matches', () => {
    expect(normaliseScore(88.6, 'percentage', 100, 'percentage')).toBe(88.6);
    expect(normaliseScore(8.7, 'cgpa', 10, 'cgpa')).toBe(8.7);
  });

  it('converts cgpa to percentage when the portal wants percentage', () => {
    expect(normaliseScore(8.7, 'cgpa', 10, 'percentage')).toBe(82.65);
  });
});

describe('fitToLimit', () => {
  const essay = 'I am a final-year student. I build web applications. I want to learn more every day.';

  it('leaves text under the limit untouched', () => {
    expect(fitToLimit(essay, 500)).toBe(essay);
  });

  it('trims on a sentence boundary when one sits late enough in the window', () => {
    // Boundary at index 51 is > 0.6 * 60, so it is preferred over a word cut.
    const out = fitToLimit(essay, 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith('.')).toBe(true);
    expect(out).toBe('I am a final-year student. I build web applications.');
  });

  it('falls back to a word boundary when the sentence break is too early', () => {
    // Boundary at index 25 is < 0.6 * 50, so cutting there would waste the window.
    const out = fitToLimit(essay, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out).toBe('I am a final-year student. I build web');
    expect(out.endsWith(' ')).toBe(false);
  });

  it('never cuts mid-word', () => {
    const out = fitToLimit(essay, 30);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(essay.startsWith(out)).toBe(true);
  });

  it('treats a zero/absent limit as no limit', () => {
    expect(fitToLimit(essay, 0)).toBe(essay);
  });
});

describe('formatSkills', () => {
  it('joins an array with the default separator', () => {
    expect(formatSkills(['Python', 'React'])).toBe('Python, React');
  });

  it('respects a custom separator and a max count', () => {
    expect(formatSkills(['A', 'B', 'C'], '; ')).toBe('A; B; C');
    expect(formatSkills(['A', 'B', 'C'], ', ', 2)).toBe('A, B');
  });

  it('passes a non-array through as a string', () => {
    expect(formatSkills('Python')).toBe('Python');
  });
});

describe('formatPhone', () => {
  it('strips non-digits down to a 10-digit Indian mobile', () => {
    expect(formatPhone('+91 98765-43210')).toBe('9876543210');
    expect(formatPhone('098765 43210')).toBe('9876543210');
  });

  it('adds the country code on request', () => {
    expect(formatPhone('9876543210', true)).toBe('+919876543210');
  });
});
