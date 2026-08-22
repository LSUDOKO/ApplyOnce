/**
 * Value formatters — the profile stores one canonical form; portals want many.
 * Adapters call these instead of reformatting inline, so a portal quirk is
 * fixed in exactly one place.
 */

/** ISO date -> whatever the portal's date input wants. */
export function formatDate(iso: string, format: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return String(iso ?? '');
  const [, yyyy, mm, dd] = match;
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const monthIdx = Number(mm) - 1;

  return format
    .replace(/YYYY/g, yyyy)
    .replace(/MMMM/g, monthNames[monthIdx] ?? mm)
    .replace(/MMM/g, (monthNames[monthIdx] ?? mm).slice(0, 3))
    .replace(/MM/g, mm)
    .replace(/DD/g, dd);
}

/** Portals disagree on category wording. */
const CATEGORY_LABELS: Record<string, string[]> = {
  general: ['General', 'GEN', 'UR', 'Unreserved', 'General (UR)'],
  obc: ['OBC', 'Other Backward Class', 'OBC-NCL', 'BC', 'OBC (Non-Creamy Layer)'],
  sc: ['SC', 'Scheduled Caste'],
  st: ['ST', 'Scheduled Tribe'],
  ews: ['EWS', 'Economically Weaker Section', 'General-EWS'],
  prefer_not_to_say: [],
};

const GENDER_LABELS: Record<string, string[]> = {
  male: ['Male', 'M', 'MALE'],
  female: ['Female', 'F', 'FEMALE'],
  transgender: ['Transgender', 'Other', 'Others', 'Third Gender'],
  prefer_not_to_say: ['Prefer not to say', 'Not Specified'],
};

/**
 * Pick the option from a real dropdown that best represents a profile value.
 * Returns null rather than guessing wrong — the caller reports it unmapped.
 */
export function matchSelectOption(
  profileValue: string,
  options: string[],
  kind?: 'category' | 'gender',
): string | null {
  const value = String(profileValue ?? '').trim();
  if (!value || options.length === 0) return null;

  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(value);

  // 1. exact
  const exact = options.find((o) => norm(o) === target);
  if (exact) return exact;

  // 2. known synonyms for enum-ish fields
  const table = kind === 'category' ? CATEGORY_LABELS : kind === 'gender' ? GENDER_LABELS : null;
  if (table) {
    for (const synonym of table[value.toLowerCase()] ?? []) {
      const hit = options.find((o) => norm(o) === norm(synonym));
      if (hit) return hit;
    }
  }

  // 3. containment, longest-first so "OBC-NCL" beats a stray "O"
  const contains = options
    .filter((o) => norm(o).includes(target) || target.includes(norm(o)))
    .sort((a, b) => b.length - a.length);
  if (contains.length > 0 && target.length >= 2) return contains[0];

  return null;
}

/** CGPA <-> percentage, using the common Indian conversion when a portal insists. */
export function cgpaToPercentage(cgpa: number, scale = 10): number {
  if (scale === 10) return Number((cgpa * 9.5).toFixed(2));
  return Number(((cgpa / scale) * 100).toFixed(2));
}

export function normaliseScore(
  score: number,
  scoreType: 'percentage' | 'cgpa' | 'gpa',
  scoreMax: number,
  wanted: 'percentage' | 'cgpa',
): number {
  if (scoreType === 'percentage' && wanted === 'percentage') return score;
  if (scoreType !== 'percentage' && wanted === 'cgpa') return score;
  if (scoreType !== 'percentage' && wanted === 'percentage') return cgpaToPercentage(score, scoreMax || 10);
  return Number(((score / 100) * 10).toFixed(2));
}

/** Trim an essay to a portal's character cap without cutting mid-word. */
export function fitToLimit(text: string, limit: number): string {
  const value = String(text ?? '');
  if (!limit || value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (lastStop > limit * 0.6) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/** Skills array -> the comma string most portals expect. */
export function formatSkills(skills: unknown, separator = ', ', max = 0): string {
  if (!Array.isArray(skills)) return String(skills ?? '');
  const list = max > 0 ? skills.slice(0, max) : skills;
  return list.map((s) => String(s)).join(separator);
}

/** Phone digits only, optionally with country code. */
export function formatPhone(phone: string, withCountryCode = false): string {
  const digits = String(phone ?? '').replace(/\D/g, '').slice(-10);
  return withCountryCode ? `+91${digits}` : digits;
}
