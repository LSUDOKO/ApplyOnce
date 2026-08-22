/**
 * Profile loading + validation.
 *
 * RULE 5: profiles live on this machine only. Nothing here performs a network
 * call. The loader validates against schemas/profile.schema.json and refuses
 * to hand a malformed profile to an adapter — a half-valid profile produces a
 * half-filled application, which is worse than an explicit error.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
// The profile schema declares JSON Schema draft 2020-12, so we must use Ajv's
// 2020 build — the default export only understands draft-07.
import { Ajv2020 as Ajv } from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormatsModule from 'ajv-formats';
import { ApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';
import { maskDeep } from '../safety.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
/** Works from both src/ (tsx) and dist/ (compiled). */
export const PROJECT_ROOT = resolve(HERE, '..', '..');
const SCHEMA_PATH = join(PROJECT_ROOT, 'schemas', 'profile.schema.json');
const PROFILE_DIR = join(PROJECT_ROOT, 'data', 'profiles');

export interface StudentProfile {
  schema_version: string;
  profile_id?: string;
  personal: {
    name: {
      full: string; first?: string; middle?: string; last?: string;
      as_per_aadhaar?: string; as_per_marksheet?: string;
      father_name?: string; mother_name?: string;
    };
    dob: string;
    gender: string;
    category?: string;
    differently_abled?: boolean;
    nationality?: string;
    religion?: string;
    marital_status?: string;
    email: string;
    phone: string;
    alternate_phone?: string;
    address: {
      line1: string; line2?: string; city?: string;
      district: string; state: string; pincode: string; country?: string;
    };
  };
  academic: {
    qualifications: Array<{
      level: string; board_or_university?: string; institution: string;
      stream?: string; degree?: string; year_of_passing: number;
      score_type?: 'percentage' | 'cgpa' | 'gpa'; score?: number; score_max?: number;
      roll_number?: string; currently_enrolled?: boolean;
    }>;
    current_year_of_study?: number;
    expected_graduation_year?: number;
    backlogs?: number;
    gap_years?: number;
  };
  family?: { annual_income?: number; income_certificate_number?: string;
    occupation_father?: string; occupation_mother?: string };
  skills?: string[];
  experience?: Array<Record<string, unknown>>;
  links?: { portfolio?: string; github?: string; linkedin?: string };
  bank?: Record<string, unknown>;
  identifiers?: Record<string, unknown>;
  documents: Record<string, { path: string; label?: string; mime?: string } | Array<unknown> | undefined>;
  long_answers?: Record<string, string>;
  preferences?: {
    job_titles?: string[]; locations?: string[]; work_mode?: string[];
    min_stipend?: number; available_from?: string; duration_months?: number;
  };
}

let cachedValidator: ValidateFunction | null = null;

function getValidator() {
  if (cachedValidator) return cachedValidator;
  if (!existsSync(SCHEMA_PATH)) {
    throw new ApplyOnceError('PROFILE_INVALID', `Profile schema missing at ${SCHEMA_PATH}`,
      'Reinstall ApplyOnce or restore schemas/profile.schema.json.');
  }
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  // ajv-formats ships CJS typings that NodeNext reads as a namespace, but the
  // runtime value IS callable (verified: `typeof addFormatsModule === 'function'`).
  // Some bundlers re-wrap it under `.default`, so accept either shape.
  type AddFormats = (instance: Ajv) => Ajv;
  const mod: unknown = addFormatsModule;
  const addFormats: AddFormats = typeof mod === 'function'
    ? (mod as AddFormats)
    : (mod as { default: AddFormats }).default;
  addFormats(ajv);
  cachedValidator = ajv.compile(schema);
  return cachedValidator;
}

function formatErrors(errors: ErrorObject[] | null | undefined): Array<{ field: string; problem: string }> {
  return (errors ?? []).map((e) => ({
    field: e.instancePath || e.params?.missingProperty as string || '(root)',
    problem: e.message ?? 'invalid',
  }));
}

export interface ValidationResult {
  valid: boolean;
  errors: Array<{ field: string; problem: string }>;
}

export function validateProfile(profile: unknown): ValidationResult {
  const validate = getValidator();
  const valid = validate(profile) as boolean;
  return { valid, errors: valid ? [] : formatErrors(validate.errors) };
}

/**
 * Resolve a profile argument into a path.
 * Accepts an absolute path, a relative path, or a bare profile id.
 */
export function resolveProfilePath(ref?: string): string {
  const candidate = ref?.trim();
  if (!candidate) return join(PROFILE_DIR, 'sample_profile.json');
  if (isAbsolute(candidate)) return candidate;
  if (candidate.endsWith('.json')) {
    const rel = resolve(PROJECT_ROOT, candidate);
    if (existsSync(rel)) return rel;
    return resolve(process.cwd(), candidate);
  }
  return join(PROFILE_DIR, `${candidate}.json`);
}

/** Load + validate. Throws ApplyOnceError with per-field problems on failure. */
export function loadProfile(ref?: string): { profile: StudentProfile; path: string } {
  const path = resolveProfilePath(ref);

  if (!existsSync(path)) {
    throw new ApplyOnceError('PROFILE_NOT_FOUND', `No profile at ${path}`,
      `Create one from schemas/profile.schema.json, or pass profile_path. Available: ${listProfiles().join(', ') || 'none'}`,
      { path, available: listProfiles() });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ApplyOnceError('PROFILE_INVALID', `Profile at ${path} is not valid JSON: ${(e as Error).message}`,
      'Fix the JSON syntax (a trailing comma is the usual culprit) and retry.', { path });
  }

  const { valid, errors } = validateProfile(parsed);
  if (!valid) {
    throw new ApplyOnceError('PROFILE_INVALID',
      `Profile failed schema validation with ${errors.length} problem(s).`,
      'Fix the listed fields against schemas/profile.schema.json and retry.',
      { path, problems: errors.slice(0, 25) });
  }

  const profile = parsed as StudentProfile;
  // RULE 5: masked — never log a raw profile.
  log.info('profile.loaded', `Loaded profile ${profile.profile_id ?? '(unnamed)'} from disk (local only)`, {
    profile_id: profile.profile_id,
    name: profile.personal?.name?.full,
    qualifications: profile.academic?.qualifications?.length ?? 0,
    documents: Object.keys(profile.documents ?? {}).length,
  });

  return { profile, path };
}

export function listProfiles(): string[] {
  if (!existsSync(PROFILE_DIR)) return [];
  return readdirSync(PROFILE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
}

/** Which of the profile's declared documents actually exist on disk. */
export function checkDocuments(profile: StudentProfile): {
  present: Array<{ key: string; path: string; size_kb: number }>;
  missing: Array<{ key: string; path: string; reason: string }>;
} {
  const present: Array<{ key: string; path: string; size_kb: number }> = [];
  const missing: Array<{ key: string; path: string; reason: string }> = [];

  for (const [key, doc] of Object.entries(profile.documents ?? {})) {
    if (!doc || Array.isArray(doc)) continue;
    const path = (doc as { path?: string }).path;
    if (!path) { missing.push({ key, path: '', reason: 'no path in profile' }); continue; }
    if (!existsSync(path)) { missing.push({ key, path, reason: 'file not found on disk' }); continue; }
    present.push({ key, path, size_kb: Number((statSync(path).size / 1024).toFixed(1)) });
  }
  return { present, missing };
}

/** Safe view of a profile for inclusion in a tool response. */
export function redactProfile(profile: StudentProfile): Record<string, unknown> {
  return maskDeep(profile) as unknown as Record<string, unknown>;
}
