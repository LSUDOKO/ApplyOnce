/**
 * check_eligibility — READ-ONLY (HARD RULE 3).
 *
 * The point of this tool is to decide "qualify vs skip" BEFORE any form is
 * touched, and to SHOW ITS REASONING. Every check returns a verdict plus the
 * evidence it used, so a student can disagree with it.
 *
 * We are deliberately conservative: a criterion we cannot parse becomes an
 * "unknown" (surfaced for the human), never a silent pass or fail.
 */

import { loadProfile, checkDocuments, type StudentProfile } from '../profile/loader.js';
import { execAdapter, hasCompiledCommand } from '../webcmd/bridge.js';
import { detectPortal } from './fill-application.js';
import { ApplyOnceError } from '../errors.js';
import { log, RunTracker } from '../logging/logger.js';

export interface CheckEligibilityInput {
  opportunity_url: string;
  portal?: 'internshala' | 'scholarship';
  profile_path?: string;
  session?: string;
}

export type Verdict = 'pass' | 'fail' | 'unknown';

export interface EligibilityCheck {
  criterion: string;
  verdict: Verdict;
  reason: string;
  evidence?: string;
}

/** Current degree/level the student is at, derived from the profile. */
function currentLevel(profile: StudentProfile): string | null {
  const enrolled = profile.academic.qualifications.find((q) => q.currently_enrolled);
  return enrolled?.level ?? null;
}

function highestScorePercent(profile: StudentProfile): number | null {
  const enrolled = profile.academic.qualifications.find((q) => q.currently_enrolled)
    ?? profile.academic.qualifications[profile.academic.qualifications.length - 1];
  if (!enrolled || enrolled.score === undefined) return null;
  if (enrolled.score_type === 'percentage') return enrolled.score;
  const max = enrolled.score_max || 10;
  return Number(((enrolled.score / max) * 95).toFixed(1));   // CGPA -> approx %
}

/**
 * Evaluate the free-text criteria of an opportunity against the profile.
 * Exported so it can be unit-tested without touching the network.
 */
export function evaluateCriteria(
  text: string,
  profile: StudentProfile,
  opts: { deadlineIso?: string | null; alreadyApplied?: boolean } = {},
): EligibilityCheck[] {
  const checks: EligibilityCheck[] = [];
  const haystack = String(text ?? '').toLowerCase();

  /* ---- deadline ---- */
  if (opts.deadlineIso) {
    const days = Math.round((Date.parse(opts.deadlineIso) - Date.now()) / 86_400_000);
    checks.push({
      criterion: 'Application window is open',
      verdict: days >= 0 ? 'pass' : 'fail',
      reason: days >= 0 ? `Closes in ${days} day(s) (${opts.deadlineIso}).`
        : `Closed ${Math.abs(days)} day(s) ago (${opts.deadlineIso}).`,
      evidence: opts.deadlineIso,
    });
  }

  if (opts.alreadyApplied) {
    checks.push({
      criterion: 'Not already applied',
      verdict: 'fail',
      reason: 'The portal reports you have already applied to this opportunity.',
    });
  }

  /* ---- income ceiling (very common on Indian scholarships) ---- */
  const incomeMatch = haystack.match(/(?:family |annual )?income[^.]{0,40}?(?:less than|below|under|up to|not exceed(?:ing)?|<=?)\s*(?:inr|rs\.?|₹)?\s*([\d.,]+)\s*(lakh|lakhs|lpa|crore)?/i);
  if (incomeMatch) {
    let ceiling = Number(String(incomeMatch[1]).replace(/,/g, ''));
    const unit = (incomeMatch[2] ?? '').toLowerCase();
    if (unit.startsWith('lakh') || unit === 'lpa') ceiling *= 100_000;
    else if (unit === 'crore') ceiling *= 10_000_000;

    const income = profile.family?.annual_income;
    if (income === undefined) {
      checks.push({ criterion: 'Family income ceiling', verdict: 'unknown',
        reason: `The scheme caps income at ₹${ceiling.toLocaleString('en-IN')}, but your profile has no family.annual_income.`,
        evidence: incomeMatch[0] });
    } else {
      checks.push({ criterion: 'Family income ceiling',
        verdict: income <= ceiling ? 'pass' : 'fail',
        reason: income <= ceiling
          ? `Your family income (₹${income.toLocaleString('en-IN')}) is within the ₹${ceiling.toLocaleString('en-IN')} ceiling.`
          : `Your family income (₹${income.toLocaleString('en-IN')}) exceeds the ₹${ceiling.toLocaleString('en-IN')} ceiling.`,
        evidence: incomeMatch[0] });
    }
  }

  /* ---- minimum marks ---- */
  const marksMatch = haystack.match(/(?:minimum|at least|above|scored?|secured?)\s*([\d.]+)\s*%/i);
  if (marksMatch) {
    const required = Number(marksMatch[1]);
    const actual = highestScorePercent(profile);
    if (actual === null) {
      checks.push({ criterion: 'Minimum marks', verdict: 'unknown',
        reason: `The scheme requires ${required}%, but your profile has no usable score.`,
        evidence: marksMatch[0] });
    } else {
      checks.push({ criterion: 'Minimum marks',
        verdict: actual >= required ? 'pass' : 'fail',
        reason: actual >= required
          ? `Your score (~${actual}%) meets the ${required}% requirement.`
          : `Your score (~${actual}%) is below the ${required}% requirement.`,
        evidence: marksMatch[0] });
    }
  }

  /* ---- gender restriction ---- */
  // Matches the phrasings scholarship pages actually use:
  //   "Only girls ... can apply" / "for women candidates" / "girl students only"
  const genderRestricted =
    /\b(only|exclusively)\b[^.]{0,60}\b(girls?|women|female)\b/i.test(haystack)
    || /\b(girls?|women|female)\b[^.]{0,40}\b(only|can apply|candidates|students)\b/i.test(haystack)
    || /\bfor\s+(girls?|women|female)\b/i.test(haystack);
  if (genderRestricted) {
    const gender = profile.personal.gender;
    checks.push({ criterion: 'Gender-restricted scheme',
      verdict: gender === 'female' ? 'pass' : 'fail',
      reason: gender === 'female'
        ? 'This scheme is for women/girls and your profile matches.'
        : `This scheme is restricted to women/girls; your profile says "${gender}".`,
      evidence: 'gender restriction detected in criteria text' });
  }

  /* ---- reservation category ---- */
  const catMatch = haystack.match(/\b(sc\/st\/obc|sc\/st|scheduled caste|scheduled tribe|obc|minority|ews)\b/i);
  if (catMatch && /only|exclusively|belonging to|reserved for/i.test(haystack)) {
    const category = profile.personal.category ?? 'general';
    const allowed = String(catMatch[1]).toLowerCase();
    const matches = allowed.includes(category)
      || (category === 'sc' && allowed.includes('scheduled caste'))
      || (category === 'st' && allowed.includes('scheduled tribe'));
    checks.push({ criterion: 'Reservation category',
      verdict: matches ? 'pass' : 'unknown',
      reason: matches
        ? `Your category (${category.toUpperCase()}) matches the scheme's "${allowed}" requirement.`
        : `The scheme mentions "${allowed}"; your category is ${category.toUpperCase()}. Confirm manually.`,
      evidence: catMatch[0] });
  }

  /* ---- study level ---- */
  const level = currentLevel(profile);
  if (/\bug\b|undergraduate|graduation/i.test(haystack) && level) {
    checks.push({ criterion: 'Level of study',
      verdict: level === 'undergraduate' ? 'pass' : 'unknown',
      reason: level === 'undergraduate'
        ? 'The scheme targets undergraduates and you are currently enrolled in a UG programme.'
        : `The scheme targets undergraduates; your current level is "${level}". Confirm manually.`,
      evidence: 'UG requirement detected' });
  }
  if (/class\s*(1|i)\s*to\s*(12|xii)|school students/i.test(haystack) && level) {
    checks.push({ criterion: 'Level of study',
      verdict: ['10th', '12th'].includes(level) ? 'pass' : 'fail',
      reason: ['10th', '12th'].includes(level)
        ? 'The scheme targets school students and your current level matches.'
        : `The scheme is for school students (Class 1-12); you are at "${level}".`,
      evidence: 'school-level requirement detected' });
  }

  /* ---- skills overlap (internships) ---- */
  return checks;
}

export async function checkEligibility(input: CheckEligibilityInput) {
  const url = String(input.opportunity_url ?? '').trim();
  if (!url) {
    throw new ApplyOnceError('INVALID_INPUT', 'opportunity_url is required',
      'Pass the URL of the opportunity to evaluate.');
  }

  const portal = input.portal ?? detectPortal(url);
  const { profile } = loadProfile(input.profile_path);

  const compiled = await hasCompiledCommand(portal, 'detail');
  if (!compiled) {
    throw new ApplyOnceError('ADAPTER_NOT_FOUND',
      `No compiled detail command for "${portal}".`,
      'Run `npm run adapters:install`, then `webcmd list -f json`.');
  }

  const tracker = new RunTracker('reuse', portal);
  tracker.step(`execute compiled command: webcmd ${portal} detail`);

  const rows = await execAdapter<Array<Record<string, unknown>>>(portal, 'detail', [url],
    { session: input.session, timeoutMs: 240_000 });
  const detail = (rows ?? [])[0];
  if (!detail) {
    throw new ApplyOnceError('OPPORTUNITY_NOT_FOUND',
      `Could not read details for ${url}`,
      'Confirm the URL points at an opportunity detail page.');
  }

  /* ---- assemble the criteria text from whatever the portal gave us ---- */
  const criteriaText = [
    detail.who_can_apply, detail.eligibility, detail.documents_required,
    detail.benefits, detail.title,
  ].filter(Boolean).join('\n');

  const checks = evaluateCriteria(criteriaText, profile, {
    deadlineIso: (detail.deadline_iso as string) ?? null,
    alreadyApplied: Boolean(detail.already_applied),
  });

  /* ---- skills overlap for internships ---- */
  const portalSkills = Array.isArray(detail.skills) ? (detail.skills as string[]) : [];
  if (portalSkills.length > 0) {
    const mine = new Set((profile.skills ?? []).map((s) => s.toLowerCase()));
    const overlap = portalSkills.filter((s) => mine.has(String(s).toLowerCase()));
    checks.push({
      criterion: 'Skills match',
      verdict: overlap.length > 0 ? 'pass' : 'unknown',
      reason: overlap.length > 0
        ? `You have ${overlap.length}/${portalSkills.length} of the listed skills: ${overlap.join(', ')}.`
        : `None of your profile skills match the listed skills (${portalSkills.join(', ')}). You may still be eligible.`,
      evidence: portalSkills.join(', '),
    });
  }

  /* ---- documents the student would need ---- */
  const docs = checkDocuments(profile);
  if (docs.missing.length > 0) {
    checks.push({
      criterion: 'Supporting documents available',
      verdict: 'unknown',
      reason: `${docs.missing.length} document(s) referenced by your profile are missing on disk: ${docs.missing.map((d) => d.key).join(', ')}.`,
    });
  }

  const metrics = tracker.finish();

  const failed = checks.filter((c) => c.verdict === 'fail');
  const unknown = checks.filter((c) => c.verdict === 'unknown');
  const passed = checks.filter((c) => c.verdict === 'pass');
  const eligible = failed.length === 0;

  // Confidence drops when we had to guess.
  const confidence = checks.length === 0 ? 0.3
    : Number((passed.length / (passed.length + unknown.length + failed.length)).toFixed(2));

  log.info('tool.end',
    `check_eligibility: ${eligible ? 'ELIGIBLE' : 'NOT ELIGIBLE'} (${passed.length} pass / ${failed.length} fail / ${unknown.length} unknown)`,
    { portal, eligible, url });

  return {
    ok: true as const,
    eligible,
    confidence,
    recommendation: eligible
      ? (unknown.length > 0 ? 'apply_with_review' : 'apply')
      : 'skip',
    opportunity: {
      title: detail.title ?? null,
      organisation: detail.company ?? null,
      deadline: detail.apply_by ?? detail.deadline ?? null,
      value: detail.stipend ?? detail.award ?? null,
      url,
    },
    checks,
    reasons: checks.map((c) => `[${c.verdict.toUpperCase()}] ${c.criterion}: ${c.reason}`),
    blockers: failed.map((c) => c.reason),
    needs_human_confirmation: unknown.map((c) => c.reason),
    learn_once: { mode: metrics.mode, steps: metrics.steps, duration_ms: metrics.durationMs },
    note: 'Read-only. Nothing was filled or submitted.',
  };
}
