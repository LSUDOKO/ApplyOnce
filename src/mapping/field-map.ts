/**
 * ============================================================================
 * SEMANTIC FIELD MAPPING LAYER
 * ============================================================================
 * Portals label the same fact a dozen different ways:
 *   "Full Name" / "Candidate Name" / "Name as per Aadhaar" / "Applicant Name"
 *
 * Rather than hardcode a selector per portal, adapters read the *visible label*
 * off the page and ask this module which profile key it means. That is what
 * makes an adapter survive a layout change: the DOM can move, but the human
 * label rarely does.
 *
 * Resolution is a scored cascade:
 *   1. exact normalised match      (confidence 1.00)
 *   2. known alias match           (confidence 0.95)
 *   3. regex pattern match         (confidence 0.85)
 *   4. token overlap (fuzzy)       (confidence 0.50–0.80)
 *   5. no match  -> reported as an unmapped field for the human to fill
 *
 * We deliberately DO NOT guess below `MIN_CONFIDENCE`. A wrong autofill on a
 * scholarship form is worse than an honest "unmapped_fields" entry.
 */

export type ProfileKey = string;

export interface FieldDefinition {
  /** Dot-path into the profile JSON. */
  key: ProfileKey;
  /** Canonical human label. */
  canonical: string;
  /** Known label variants seen on Indian portals. */
  aliases: string[];
  /** Regexes for labels that vary too much to enumerate. */
  patterns?: RegExp[];
  /** Value semantics, so adapters know how to type it into a widget. */
  type: 'text' | 'email' | 'tel' | 'date' | 'number' | 'select' | 'textarea' | 'file' | 'checkbox';
  /** True if leaving this blank blocks submission on most portals. */
  important?: boolean;
  /** Marks values that must be masked in logs and responses. */
  sensitive?: boolean;
}

export const FIELD_DEFINITIONS: FieldDefinition[] = [
  // ---------------------------------------------------------------- personal
  {
    key: 'personal.name.full', canonical: 'Full Name', type: 'text', important: true,
    aliases: ['name', 'full name', 'candidate name', 'applicant name', 'student name',
      'your name', 'name of applicant', 'name of the student', 'name of candidate'],
    patterns: [/^(full|candidate|applicant|student)?\s*name$/i],
  },
  {
    key: 'personal.name.as_per_aadhaar', canonical: 'Name as per Aadhaar', type: 'text',
    aliases: ['name as per aadhaar', 'name as per aadhar', 'aadhaar name', 'aadhar name',
      'name as on aadhaar', 'name as per uidai'],
    patterns: [/name.*(as\s*(per|on)).*aadh?a?ar/i],
  },
  {
    key: 'personal.name.as_per_marksheet', canonical: 'Name as per Marksheet', type: 'text',
    aliases: ['name as per marksheet', 'name as per certificate', 'name as on marksheet',
      'name as per 10th certificate'],
    patterns: [/name.*(as\s*(per|on)).*(marksheet|certificate)/i],
  },
  {
    key: 'personal.name.first', canonical: 'First Name', type: 'text',
    aliases: ['first name', 'given name', 'fname'],
    patterns: [/^first\s*name$/i, /^given\s*name$/i],
  },
  {
    key: 'personal.name.middle', canonical: 'Middle Name', type: 'text',
    aliases: ['middle name', 'mname'],
  },
  {
    key: 'personal.name.last', canonical: 'Last Name', type: 'text',
    aliases: ['last name', 'surname', 'family name', 'lname'],
    patterns: [/^(last|sur|family)\s*name$/i],
  },
  {
    key: 'personal.name.father_name', canonical: "Father's Name", type: 'text',
    aliases: ["father's name", 'father name', 'fathers name', 'name of father', 'guardian name'],
    patterns: [/father'?s?\s*name/i],
  },
  {
    key: 'personal.name.mother_name', canonical: "Mother's Name", type: 'text',
    aliases: ["mother's name", 'mother name', 'mothers name', 'name of mother'],
    patterns: [/mother'?s?\s*name/i],
  },
  {
    key: 'personal.dob', canonical: 'Date of Birth', type: 'date', important: true,
    aliases: ['date of birth', 'dob', 'birth date', 'birthdate', 'd.o.b.', 'd.o.b'],
    patterns: [/date\s*of\s*birth/i, /^d\.?o\.?b\.?$/i],
  },
  {
    key: 'personal.gender', canonical: 'Gender', type: 'select', important: true,
    aliases: ['gender', 'sex'],
  },
  {
    key: 'personal.category', canonical: 'Category', type: 'select',
    aliases: ['category', 'caste category', 'social category', 'reservation category',
      'community', 'caste'],
    patterns: [/(caste|social|reservation)\s*category/i],
  },
  {
    key: 'personal.differently_abled', canonical: 'Differently Abled', type: 'checkbox',
    aliases: ['differently abled', 'physically handicapped', 'pwd', 'disability',
      'person with disability', 'divyang'],
  },
  {
    key: 'personal.nationality', canonical: 'Nationality', type: 'text',
    aliases: ['nationality', 'citizenship'],
  },
  {
    key: 'personal.religion', canonical: 'Religion', type: 'select',
    aliases: ['religion'],
  },
  {
    key: 'personal.marital_status', canonical: 'Marital Status', type: 'select',
    aliases: ['marital status'],
  },
  {
    key: 'personal.email', canonical: 'Email', type: 'email', important: true,
    aliases: ['email', 'email address', 'e-mail', 'email id', 'e-mail address', 'mail id'],
    patterns: [/e-?mail/i],
  },
  {
    key: 'personal.phone', canonical: 'Mobile Number', type: 'tel', important: true,
    aliases: ['mobile', 'mobile number', 'phone', 'phone number', 'contact number',
      'mobile no', 'mobile no.', 'contact no', 'cell number'],
    patterns: [/(mobile|phone|contact|cell)\s*(number|no\.?)?$/i],
  },
  {
    key: 'personal.alternate_phone', canonical: 'Alternate Mobile', type: 'tel',
    aliases: ['alternate mobile', 'alternate number', 'secondary phone', 'alternate contact'],
  },

  // ----------------------------------------------------------------- address
  {
    key: 'personal.address.line1', canonical: 'Address Line 1', type: 'text', important: true,
    aliases: ['address', 'address line 1', 'address line1', 'street address',
      'permanent address', 'correspondence address', 'residential address', 'house no'],
    patterns: [/address(\s*line\s*1)?$/i],
  },
  {
    key: 'personal.address.line2', canonical: 'Address Line 2', type: 'text',
    aliases: ['address line 2', 'address line2', 'landmark', 'locality', 'area'],
  },
  {
    key: 'personal.address.city', canonical: 'City', type: 'text',
    aliases: ['city', 'town', 'city/town', 'village'],
  },
  {
    key: 'personal.address.district', canonical: 'District', type: 'select', important: true,
    aliases: ['district', 'dist', 'dist.'],
  },
  {
    key: 'personal.address.state', canonical: 'State', type: 'select', important: true,
    aliases: ['state', 'state/ut', 'state name', 'province'],
  },
  {
    key: 'personal.address.pincode', canonical: 'PIN Code', type: 'text', important: true,
    aliases: ['pincode', 'pin code', 'postal code', 'zip', 'zip code', 'pin'],
    patterns: [/(pin|postal|zip)\s*code/i],
  },
  {
    key: 'personal.address.country', canonical: 'Country', type: 'select',
    aliases: ['country'],
  },

  // ---------------------------------------------------------------- academic
  {
    key: 'academic.qualifications[level=10th].board_or_university', canonical: '10th Board', type: 'select',
    aliases: ['10th board', 'class 10 board', 'secondary board', 'board (10th)',
      'matriculation board', 'x board'],
    patterns: [/(10th|class\s*10|secondary|matric).*board/i],
  },
  {
    key: 'academic.qualifications[level=10th].score', canonical: '10th Percentage', type: 'number',
    aliases: ['10th percentage', 'class 10 percentage', 'secondary percentage',
      '10th marks', 'matriculation percentage', 'x percentage', '10th %'],
    patterns: [/(10th|class\s*10|secondary|matric).*(percentage|marks|%|score)/i],
  },
  {
    key: 'academic.qualifications[level=10th].year_of_passing', canonical: '10th Passing Year', type: 'number',
    aliases: ['10th passing year', 'year of passing 10th', 'class 10 year'],
    patterns: [/(10th|class\s*10|secondary).*(year|passing)/i],
  },
  {
    key: 'academic.qualifications[level=12th].board_or_university', canonical: '12th Board', type: 'select',
    aliases: ['12th board', 'class 12 board', 'senior secondary board', 'board (12th)',
      'intermediate board', 'xii board', 'hsc board'],
    patterns: [/(12th|class\s*12|senior\s*secondary|intermediate|hsc).*board/i],
  },
  {
    key: 'academic.qualifications[level=12th].score', canonical: '12th Percentage', type: 'number',
    aliases: ['12th percentage', 'class 12 percentage', '12th marks', 'intermediate percentage',
      'xii percentage', '12th %', 'hsc percentage'],
    patterns: [/(12th|class\s*12|senior\s*secondary|intermediate|hsc).*(percentage|marks|%|score)/i],
  },
  {
    key: 'academic.qualifications[level=12th].year_of_passing', canonical: '12th Passing Year', type: 'number',
    aliases: ['12th passing year', 'year of passing 12th', 'class 12 year'],
    patterns: [/(12th|class\s*12|intermediate).*(year|passing)/i],
  },
  {
    key: 'academic.qualifications[level=undergraduate].institution', canonical: 'College / Institution', type: 'text', important: true,
    aliases: ['college', 'institution', 'institute', 'college name', 'institute name',
      'name of institution', 'current institution', 'school/college'],
    patterns: [/(college|institut(e|ion))\s*(name)?$/i],
  },
  {
    key: 'academic.qualifications[level=undergraduate].board_or_university', canonical: 'University', type: 'select',
    aliases: ['university', 'university name', 'affiliated university'],
  },
  {
    key: 'academic.qualifications[level=undergraduate].degree', canonical: 'Degree', type: 'select',
    aliases: ['degree', 'course', 'programme', 'program', 'qualification', 'course name'],
  },
  {
    key: 'academic.qualifications[level=undergraduate].stream', canonical: 'Branch / Stream', type: 'select',
    aliases: ['branch', 'stream', 'specialisation', 'specialization', 'discipline',
      'subject', 'major'],
  },
  {
    key: 'academic.qualifications[level=undergraduate].score', canonical: 'CGPA', type: 'number', important: true,
    aliases: ['cgpa', 'gpa', 'degree cgpa', 'aggregate cgpa', 'current cgpa',
      'graduation percentage', 'aggregate percentage', 'degree percentage'],
    patterns: [/^(c?gpa|aggregate|graduation).*(score|percentage)?$/i],
  },
  {
    key: 'academic.current_year_of_study', canonical: 'Year of Study', type: 'select',
    aliases: ['year of study', 'current year of study', 'academic year', 'semester'],
    patterns: [/^(current\s*)?year\s*of\s*study$/i, /^semester$/i],
  },
  {
    // Internshala's education repeater asks for a course start/end year pair.
    key: 'academic.qualifications[level=undergraduate].start_year', canonical: 'Start Year', type: 'select',
    aliases: ['start year', 'course start year', 'year of joining', 'admission year', 'from year'],
    patterns: [/^start\s*year$/i, /year\s*of\s*joining/i],
  },
  {
    key: 'academic.expected_graduation_year', canonical: 'Graduation Year', type: 'number',
    aliases: ['graduation year', 'expected graduation', 'year of graduation',
      'passing year', 'expected passing year', 'completion year',
      'end year', 'course end year', 'to year'],
    patterns: [/(graduation|passing|completion)\s*year/i, /^end\s*year$/i],
  },

  // ------------------------------------------------------------------ family
  {
    key: 'family.annual_income', canonical: 'Annual Family Income', type: 'number', important: true,
    aliases: ['annual income', 'family income', 'annual family income', 'parental income',
      'household income', 'total family income', 'income'],
    patterns: [/(annual|family|household|parental).*income/i],
  },
  {
    key: 'family.occupation_father', canonical: "Father's Occupation", type: 'text',
    aliases: ["father's occupation", 'father occupation', 'occupation of father'],
  },

  // ------------------------------------------------------------------- links
  { key: 'links.portfolio', canonical: 'Portfolio', type: 'text', aliases: ['portfolio', 'website', 'personal website', 'portfolio url'] },
  { key: 'links.github', canonical: 'GitHub', type: 'text', aliases: ['github', 'github url', 'github profile'] },
  { key: 'links.linkedin', canonical: 'LinkedIn', type: 'text', aliases: ['linkedin', 'linkedin url', 'linkedin profile'] },

  // -------------------------------------------------------- bank (sensitive)
  {
    key: 'bank.account_number', canonical: 'Bank Account Number', type: 'text', sensitive: true,
    aliases: ['account number', 'bank account number', 'a/c number', 'account no',
      'bank a/c no'],
    patterns: [/(bank\s*)?a\/?c\.?\s*(no\.?|number)/i, /account\s*(no\.?|number)/i],
  },
  {
    key: 'bank.ifsc', canonical: 'IFSC Code', type: 'text', sensitive: true,
    aliases: ['ifsc', 'ifsc code', 'bank ifsc'],
  },
  {
    key: 'bank.bank_name', canonical: 'Bank Name', type: 'text',
    aliases: ['bank name', 'name of bank', 'bank'],
  },
  {
    key: 'bank.branch', canonical: 'Bank Branch', type: 'text',
    aliases: ['branch', 'branch name', 'bank branch'],
  },
  {
    key: 'bank.account_holder_name', canonical: 'Account Holder Name', type: 'text',
    aliases: ['account holder name', 'name of account holder', 'beneficiary name'],
  },

  // ------------------------------------------------- identifiers (sensitive)
  {
    key: 'identifiers.aadhaar_number', canonical: 'Aadhaar Number', type: 'text', sensitive: true,
    aliases: ['aadhaar', 'aadhar', 'aadhaar number', 'aadhar number', 'uid', 'uidai number',
      'aadhaar no'],
    patterns: [/aadh?a?ar\s*(no\.?|number)?/i],
  },
  {
    key: 'identifiers.pan', canonical: 'PAN', type: 'text', sensitive: true,
    aliases: ['pan', 'pan number', 'pan card number'],
  },

  // --------------------------------------------------------------- documents
  { key: 'documents.resume.path', canonical: 'Resume', type: 'file', important: true,
    aliases: ['resume', 'cv', 'upload resume', 'attach resume', 'resume/cv', 'upload cv'],
    patterns: [/(upload|attach)?\s*(resume|cv)/i] },
  { key: 'documents.photo.path', canonical: 'Photograph', type: 'file',
    aliases: ['photo', 'photograph', 'passport photo', 'upload photo', 'profile photo',
      'profile picture', 'upload photograph', 'passport size photograph'],
    patterns: [/(passport\s*)?(size\s*)?photo(graph)?/i, /profile\s*(picture|pic)/i] },
  { key: 'documents.signature.path', canonical: 'Signature', type: 'file',
    aliases: ['signature', 'upload signature', 'scanned signature'] },
  { key: 'documents.marksheet_10th.path', canonical: '10th Marksheet', type: 'file',
    aliases: ['10th marksheet', 'class 10 marksheet', 'secondary marksheet', '10th certificate'],
    patterns: [/(10th|class\s*10|secondary|matric).*(marksheet|certificate)/i] },
  { key: 'documents.marksheet_12th.path', canonical: '12th Marksheet', type: 'file',
    aliases: ['12th marksheet', 'class 12 marksheet', '12th certificate', 'intermediate marksheet'],
    patterns: [/(12th|class\s*12|intermediate|hsc).*(marksheet|certificate)/i] },
  { key: 'documents.income_certificate.path', canonical: 'Income Certificate', type: 'file',
    aliases: ['income certificate', 'income proof', 'upload income certificate'],
    patterns: [/income\s*(certificate|proof)/i] },
  { key: 'documents.caste_certificate.path', canonical: 'Caste Certificate', type: 'file',
    aliases: ['caste certificate', 'category certificate', 'community certificate'],
    patterns: [/(caste|category|community)\s*certificate/i] },
  { key: 'documents.domicile_certificate.path', canonical: 'Domicile Certificate', type: 'file',
    aliases: ['domicile certificate', 'residence certificate', 'domicile'] },
  { key: 'documents.bank_passbook.path', canonical: 'Bank Passbook', type: 'file',
    aliases: ['bank passbook', 'passbook', 'cancelled cheque', 'bank proof'] },

  // ------------------------------------------------------------ long answers
  {
    key: 'long_answers.why_this_role', canonical: 'Why this role', type: 'textarea',
    aliases: ['why should we hire you', 'why this role', 'why do you want this internship',
      'why are you interested', 'motivation', 'why should you be hired for this role',
      'why do you want to work here'],
    patterns: [/why\s*(should|do|are).*(hire|role|internship|interested|join)/i],
  },
  {
    key: 'long_answers.career_goal', canonical: 'Career Goal', type: 'textarea',
    aliases: ['career goal', 'career objective', 'objective', 'future plans',
      'career aspirations', 'where do you see yourself'],
    patterns: [/career\s*(goal|objective|aspiration)/i],
  },
  {
    key: 'long_answers.why_deserve_scholarship', canonical: 'Why you deserve this scholarship', type: 'textarea',
    aliases: ['why do you deserve this scholarship', 'statement of purpose', 'sop',
      'reason for applying', 'why do you need this scholarship', 'financial need'],
    patterns: [/why.*(deserve|need).*scholarship/i, /statement\s*of\s*purpose/i],
  },
  {
    key: 'long_answers.cover_letter', canonical: 'Cover Letter', type: 'textarea',
    aliases: ['cover letter', 'covering letter', 'message to hiring manager', 'about you',
      'tell us about yourself'],
    patterns: [/cover(ing)?\s*letter/i],
  },
  {
    key: 'long_answers.availability', canonical: 'Availability', type: 'textarea',
    aliases: ['availability', 'when can you join', 'notice period', 'available from',
      'joining date', 'confirm your availability'],
    patterns: [/(availab|when.*join|notice\s*period)/i],
  },

  // ------------------------------------------------------------------ skills
  {
    key: 'skills', canonical: 'Skills', type: 'text',
    aliases: ['skills', 'key skills', 'technical skills', 'your skills', 'skill set'],
    patterns: [/(key|technical)?\s*skills?$/i],
  },
];

/** Below this we refuse to guess and report the field as unmapped instead. */
export const MIN_CONFIDENCE = 0.5;

export type MatchMethod = 'exact' | 'alias' | 'pattern' | 'fuzzy' | 'none';

export interface FieldMatch {
  label: string;
  key: ProfileKey | null;
  canonical: string | null;
  confidence: number;
  method: MatchMethod;
  type: FieldDefinition['type'] | null;
  sensitive: boolean;
  important: boolean;
}

/**
 * Normalise a portal label: strip required markers, punctuation, collapse space.
 * "Name as per Aadhaar *" -> "name as per aadhaar"
 */
export function normaliseLabel(label: string): string {
  return String(label ?? '')
    .replace(/[*✱†]/g, ' ')
    .replace(/\(required\)|\(optional\)|\(mandatory\)/gi, ' ')
    .replace(/[:?]/g, ' ')
    .replace(/[_\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Stopwords carry no signal when comparing Indian form labels. */
const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'your', 'please', 'enter', 'select',
  'in', 'to', 'for', 'is', 'as', 'per', 'and', 'or', 'you', 'us', 'me', 'my']);

function tokens(text: string): string[] {
  return normaliseLabel(text).split(' ').filter((t) => t && !STOPWORDS.has(t));
}

/** Jaccard-style overlap weighted toward covering the definition's tokens. */
function fuzzyScore(label: string, def: FieldDefinition): number {
  const labelTokens = new Set(tokens(label));
  if (labelTokens.size === 0) return 0;

  let best = 0;
  for (const candidate of [def.canonical, ...def.aliases]) {
    const candTokens = new Set(tokens(candidate));
    if (candTokens.size === 0) continue;

    let shared = 0;
    for (const t of candTokens) if (labelTokens.has(t)) shared += 1;
    if (shared === 0) continue;

    const coverage = shared / candTokens.size;        // how much of the alias is present
    const precision = shared / labelTokens.size;      // how much of the label is explained
    const score = 0.65 * coverage + 0.35 * precision;
    if (score > best) best = score;
  }
  // Cap fuzzy below the pattern tier so stronger evidence always wins.
  return Math.min(best * 0.8, 0.8);
}

/**
 * Resolve one portal label to a profile key.
 * Always returns a FieldMatch — `key: null` means "ask the human".
 */
export function resolveField(label: string): FieldMatch {
  const normalised = normaliseLabel(label);

  const miss: FieldMatch = {
    label, key: null, canonical: null, confidence: 0,
    method: 'none', type: null, sensitive: false, important: false,
  };
  if (!normalised) return miss;

  let best: FieldMatch = miss;

  for (const def of FIELD_DEFINITIONS) {
    const base = {
      label,
      key: def.key,
      canonical: def.canonical,
      type: def.type,
      sensitive: Boolean(def.sensitive),
      important: Boolean(def.important),
    };

    // 1. exact canonical
    if (normaliseLabel(def.canonical) === normalised) {
      return { ...base, confidence: 1, method: 'exact' };
    }
    // 2. alias
    if (def.aliases.some((a) => normaliseLabel(a) === normalised)) {
      if (best.confidence < 0.95) best = { ...base, confidence: 0.95, method: 'alias' };
      continue;
    }
    // 3. pattern
    if (def.patterns?.some((p) => p.test(normalised) || p.test(label))) {
      if (best.confidence < 0.85) best = { ...base, confidence: 0.85, method: 'pattern' };
      continue;
    }
    // 4. fuzzy
    const score = fuzzyScore(label, def);
    if (score > best.confidence) best = { ...base, confidence: Number(score.toFixed(2)), method: 'fuzzy' };
  }

  if (best.confidence < MIN_CONFIDENCE) {
    return { ...miss, confidence: best.confidence, method: 'none' };
  }
  return best;
}

/** Resolve a whole form's worth of labels in one call. */
export function resolveFields(labels: string[]): FieldMatch[] {
  return labels.map((l) => resolveField(l));
}

/**
 * Read a dot-path out of the profile, including the repeater selector syntax
 * `academic.qualifications[level=12th].score`.
 */
export function getProfileValue(profile: unknown, key: ProfileKey): unknown {
  if (profile === null || profile === undefined) return undefined;

  const segments = key.split('.');
  let current: unknown = profile;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    const filtered = segment.match(/^(\w+)\[(\w+)=([^\]]+)\]$/);
    if (filtered) {
      const [, arrayName, matchKey, matchValue] = filtered;
      const arr = (current as Record<string, unknown>)[arrayName];
      if (!Array.isArray(arr)) return undefined;
      current = arr.find((item) =>
        item && typeof item === 'object'
        && String((item as Record<string, unknown>)[matchKey]) === matchValue);
      continue;
    }

    const indexed = segment.match(/^(\w+)\[(\d+)\]$/);
    if (indexed) {
      const [, arrayName, idx] = indexed;
      const arr = (current as Record<string, unknown>)[arrayName];
      if (!Array.isArray(arr)) return undefined;
      current = arr[Number(idx)];
      continue;
    }

    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** A resolved label plus the actual value to type into it. */
export interface ResolvedValue extends FieldMatch {
  value: unknown;
  hasValue: boolean;
}

export function resolveWithValue(label: string, profile: unknown): ResolvedValue {
  const match = resolveField(label);
  const value = match.key ? getProfileValue(profile, match.key) : undefined;
  const hasValue = value !== undefined && value !== null && String(value).trim() !== '';
  return { ...match, value, hasValue };
}

/** Map an entire form. Returns what we can fill, and what a human must handle. */
export function mapForm(labels: string[], profile: unknown): {
  mapped: ResolvedValue[];
  unmapped: FieldMatch[];
  missingValues: ResolvedValue[];
} {
  const mapped: ResolvedValue[] = [];
  const unmapped: FieldMatch[] = [];
  const missingValues: ResolvedValue[] = [];

  for (const label of labels) {
    const resolved = resolveWithValue(label, profile);
    if (!resolved.key) { unmapped.push(resolved); continue; }
    if (!resolved.hasValue) { missingValues.push(resolved); continue; }
    mapped.push(resolved);
  }
  return { mapped, unmapped, missingValues };
}
