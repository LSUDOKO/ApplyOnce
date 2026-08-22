import { describe, it, expect } from 'vitest';
import {
  resolveField, resolveFields, normaliseLabel, getProfileValue,
  resolveWithValue, mapForm, MIN_CONFIDENCE, FIELD_DEFINITIONS,
} from './field-map.js';
import sampleProfile from '../../data/profiles/sample_profile.json' with { type: 'json' };

describe('normaliseLabel', () => {
  it('strips required markers, punctuation and case', () => {
    expect(normaliseLabel('Full Name *')).toBe('full name');
    expect(normaliseLabel('Date of Birth:')).toBe('date of birth');
    expect(normaliseLabel('  E-MAIL   ADDRESS  ')).toBe('e mail address');
    expect(normaliseLabel('Mobile No. (required)')).toBe('mobile no.');
  });

  it('handles empty and nullish input without throwing', () => {
    expect(normaliseLabel('')).toBe('');
    expect(normaliseLabel(undefined as unknown as string)).toBe('');
  });
});

describe('resolveField — exact and alias matches', () => {
  it('resolves the canonical label at full confidence', () => {
    const m = resolveField('Full Name');
    expect(m.key).toBe('personal.name.full');
    expect(m.confidence).toBe(1);
    expect(m.method).toBe('exact');
  });

  it('resolves known Indian-portal aliases', () => {
    expect(resolveField('Candidate Name').key).toBe('personal.name.full');
    expect(resolveField('Applicant Name').key).toBe('personal.name.full');
    expect(resolveField('Mobile Number').key).toBe('personal.phone');
    expect(resolveField('Email ID').key).toBe('personal.email');
    expect(resolveField('DOB').key).toBe('personal.dob');
    expect(resolveField('PIN Code').key).toBe('personal.address.pincode');
  });

  it('distinguishes the Aadhaar name variant from the plain full name', () => {
    expect(resolveField('Name as per Aadhaar').key).toBe('personal.name.as_per_aadhaar');
    expect(resolveField('Name as per Aadhar').key).toBe('personal.name.as_per_aadhaar');
    expect(resolveField('Full Name').key).toBe('personal.name.full');
  });

  it('separates 10th from 12th academic fields', () => {
    expect(resolveField('Class 10 Percentage').key)
      .toBe('academic.qualifications[level=10th].score');
    expect(resolveField('Class 12 Percentage').key)
      .toBe('academic.qualifications[level=12th].score');
    expect(resolveField('12th Board').key)
      .toBe('academic.qualifications[level=12th].board_or_university');
  });
});

describe('resolveField — pattern and fuzzy tiers', () => {
  it('matches unseen phrasings via regex patterns', () => {
    const m = resolveField('Please enter your Annual Family Income');
    expect(m.key).toBe('family.annual_income');
    expect(m.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it('falls back to fuzzy overlap with reduced confidence', () => {
    const m = resolveField('Upload your Resume document');
    expect(m.key).toBe('documents.resume.path');
    expect(m.confidence).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
  });

  it('refuses to guess below the confidence floor', () => {
    const m = resolveField('Do you own a bicycle');
    expect(m.key).toBeNull();
    expect(m.method).toBe('none');
    expect(m.confidence).toBeLessThan(MIN_CONFIDENCE);
  });

  it('returns a miss for empty labels rather than throwing', () => {
    expect(resolveField('').key).toBeNull();
    expect(resolveField('   ').key).toBeNull();
  });
});

describe('resolveField — safety metadata', () => {
  it('flags bank and identity fields as sensitive', () => {
    expect(resolveField('Aadhaar Number').sensitive).toBe(true);
    expect(resolveField('Bank Account Number').sensitive).toBe(true);
    expect(resolveField('IFSC Code').sensitive).toBe(true);
  });

  it('does not flag ordinary fields as sensitive', () => {
    expect(resolveField('Full Name').sensitive).toBe(false);
    expect(resolveField('City').sensitive).toBe(false);
  });

  it('marks submission-blocking fields as important', () => {
    expect(resolveField('Full Name').important).toBe(true);
    expect(resolveField('Email').important).toBe(true);
  });

  it('reports a widget type for every definition', () => {
    for (const def of FIELD_DEFINITIONS) {
      expect(def.type).toBeTruthy();
      expect(def.key.length).toBeGreaterThan(0);
    }
  });
});

describe('getProfileValue', () => {
  it('reads plain dot paths', () => {
    expect(getProfileValue(sampleProfile, 'personal.name.full')).toBe('Arpit Kumar Sharma');
    expect(getProfileValue(sampleProfile, 'personal.address.state')).toBe('Rajasthan');
  });

  it('reads the repeater selector syntax', () => {
    expect(getProfileValue(sampleProfile, 'academic.qualifications[level=12th].score')).toBe(88.6);
    expect(getProfileValue(sampleProfile, 'academic.qualifications[level=10th].score')).toBe(91.4);
    expect(getProfileValue(sampleProfile, 'academic.qualifications[level=undergraduate].degree')).toBe('B.Tech');
  });

  it('reads numeric array indexes', () => {
    expect(getProfileValue(sampleProfile, 'academic.qualifications[0].level')).toBe('10th');
  });

  it('returns undefined for missing paths instead of throwing', () => {
    expect(getProfileValue(sampleProfile, 'personal.nonexistent.deep')).toBeUndefined();
    expect(getProfileValue(sampleProfile, 'academic.qualifications[level=phd].score')).toBeUndefined();
    expect(getProfileValue(null, 'personal.name.full')).toBeUndefined();
  });
});

describe('mapForm — end-to-end over a realistic Indian form', () => {
  const labels = [
    'Full Name *', 'Date of Birth', 'Gender', 'Category',
    'Email Address', 'Mobile Number', 'State', 'District', 'PIN Code',
    'Class 10 Percentage', 'Class 12 Percentage', 'College Name',
    'Annual Family Income', 'Upload Resume',
    'Do you have a pet dinosaur?',       // deliberately unmappable
    'PAN Card Number',                   // mappable, but absent-ish/sensitive
  ];

  it('maps the fields it understands and isolates the ones it does not', () => {
    const { mapped, unmapped } = mapForm(labels, sampleProfile);
    const mappedLabels = mapped.map((m) => m.label);

    expect(mappedLabels).toContain('Full Name *');
    expect(mappedLabels).toContain('Mobile Number');
    expect(mappedLabels).toContain('Class 12 Percentage');

    expect(unmapped.map((u) => u.label)).toContain('Do you have a pet dinosaur?');
    expect(unmapped.every((u) => u.key === null)).toBe(true);
  });

  it('never silently drops a label — every input is accounted for', () => {
    const { mapped, unmapped, missingValues } = mapForm(labels, sampleProfile);
    expect(mapped.length + unmapped.length + missingValues.length).toBe(labels.length);
  });

  it('attaches real profile values to mapped fields', () => {
    const { mapped } = mapForm(['Full Name', 'Mobile Number'], sampleProfile);
    const name = mapped.find((m) => m.key === 'personal.name.full');
    const phone = mapped.find((m) => m.key === 'personal.phone');
    expect(name?.value).toBe('Arpit Kumar Sharma');
    expect(phone?.value).toBe('9876543210');
  });

  it('routes present-but-empty profile keys to missingValues, not mapped', () => {
    const thin = { personal: { name: { full: '' } } };
    const { mapped, missingValues } = mapForm(['Full Name'], thin);
    expect(mapped).toHaveLength(0);
    expect(missingValues).toHaveLength(1);
  });
});

describe('resolveFields', () => {
  it('resolves a batch preserving order and length', () => {
    const out = resolveFields(['Full Name', 'Email', 'Nonsense Field XYZ']);
    expect(out).toHaveLength(3);
    expect(out[0].key).toBe('personal.name.full');
    expect(out[1].key).toBe('personal.email');
    expect(out[2].key).toBeNull();
  });
});

describe('resolveWithValue', () => {
  it('reports hasValue=false when the profile lacks the key', () => {
    const r = resolveWithValue('Domicile Certificate', sampleProfile);
    expect(r.key).toBe('documents.domicile_certificate.path');
    expect(r.hasValue).toBe(false);
  });
});

/**
 * Regression suite built from labels scraped from the LIVE Internshala
 * application form on 2026-08-22, including their real whitespace noise.
 * These guard the mapper against the two bugs found during that scrape:
 * Start/End year collapsing onto one key, and "Profile picture" not matching.
 */
describe('live Internshala form labels', () => {
  const LIVE: Array<[string, string | null]> = [
    ['First name', 'personal.name.first'],
    ['Last name\n                        (Optional)', 'personal.name.last'],
    ['Contact number', 'personal.phone'],
    ['LinkedIn profile link\n                    (Optional)', 'links.linkedin'],
    ['College', 'academic.qualifications[level=undergraduate].institution'],
    ['Degree', 'academic.qualifications[level=undergraduate].degree'],
    ['Stream\n                    (Optional)', 'academic.qualifications[level=undergraduate].stream'],
    ['Start year', 'academic.qualifications[level=undergraduate].start_year'],
    ['End year', 'academic.expected_graduation_year'],
    ['Upload resume', 'documents.resume.path'],
    ['Profile picture\n                    (Recommended)', 'documents.photo.path'],
  ];

  it.each(LIVE)('maps %j to the right profile key', (label, expected) => {
    expect(resolveField(label).key).toBe(expected);
  });

  it('keeps Start year and End year on DISTINCT keys', () => {
    const start = resolveField('Start year').key;
    const end = resolveField('End year').key;
    expect(start).not.toBe(end);
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
  });

  it('refuses portal-specific questions that have no profile equivalent', () => {
    expect(resolveField("I'm a woman returning to work").key).toBeNull();
    expect(resolveField('When did you clear the last test?').key).toBeNull();
    expect(resolveField('Performance Score').key).toBeNull();
  });
});
