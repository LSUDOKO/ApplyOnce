/**
 * ============================================================================
 * fill_application — the human-gated write tool.
 * ============================================================================
 * HARD RULE 1 (graded): this drives a portal to the final submit step and
 * STOPS. It returns status:"ready_for_review" and a submit_url. There is no
 * code path in ApplyOnce that clicks submit or pay.
 *
 * Flow:
 *   1. load + validate the local profile          (RULE 5: local only)
 *   2. LEARN-ONCE CHECK: compiled command?        (fast reuse vs slow explore)
 *   3. dry-run the adapter to scrape real labels  (RULE 3 until this point)
 *   4. map labels -> profile keys semantically    (no hardcoded selectors)
 *   5. fill values/selects/checks/uploads         (the only write step)
 *   6. STOP, log the approval gate, return JSON
 * ============================================================================
 */

import { loadProfile, checkDocuments, type StudentProfile } from '../profile/loader.js';
import { execAdapter, hasCompiledCommand } from '../webcmd/bridge.js';
import { resolveWithValue, type ResolvedValue } from '../mapping/field-map.js';
import { formatDate, formatPhone, formatSkills, fitToLimit, matchSelectOption } from '../mapping/formatters.js';
import { ApplyOnceError } from '../errors.js';
import { log, logApprovalGate, RunTracker } from '../logging/logger.js';
import { assertNotSubmit, maskDeep } from '../safety.js';

/** One control scraped off the live form by the adapter. */
export interface FormField {
  label: string;
  selector: string;
  tag: string;
  type: string | null;
  required: boolean;
  value?: string;
  options?: string[];
}

interface AdapterFillResult {
  status: string;
  url: string;
  submit_url: string;
  filled_count: number;
  filled_fields: Record<string, string>;
  selects_set?: Record<string, string>;
  checks_set?: Record<string, boolean>;
  uploads?: Array<{ selector: string; path: string }>;
  unfilled?: Array<{ selector: string; reason: string; available_options?: string[] }>;
  form_fields?: FormField[];
  form_fields_detected?: number;
  submit_control?: { text: string; id: string | null; disabled: boolean } | null;
  submitted: boolean;
  warnings?: string[];
}

export interface FillApplicationInput {
  opportunity_url: string;
  portal?: 'internshala' | 'scholarship';
  profile_path?: string;
  session?: string;
  dry_run?: boolean;
}

/** Infer the portal from the URL so callers do not have to. */
export function detectPortal(url: string): 'internshala' | 'scholarship' {
  if (/internshala\.com/i.test(url)) return 'internshala';
  return 'scholarship';
}

/**
 * Turn a raw profile value into the string this particular widget wants.
 * This is where the semantic layer becomes portal-specific WITHOUT the adapter
 * hardcoding anything.
 */
export function formatForField(resolved: ResolvedValue, field: FormField): string {
  const raw = resolved.value;

  if (resolved.type === 'date' || field.type === 'date') {
    const iso = String(raw ?? '');
    // A native date input wants ISO; a text input on an Indian portal wants DD/MM/YYYY.
    return field.type === 'date' ? iso : formatDate(iso, 'DD/MM/YYYY');
  }
  if (resolved.type === 'tel' || field.type === 'tel') {
    return formatPhone(String(raw ?? ''));
  }
  if (Array.isArray(raw)) {
    return formatSkills(raw);
  }
  if (resolved.type === 'textarea' || field.tag === 'textarea') {
    return fitToLimit(String(raw ?? ''), 0);
  }
  return String(raw ?? '');
}

/**
 * Build the fill plan by mapping every scraped label onto the profile.
 * Returns what to type, what to select, what to upload, and — crucially —
 * what we could NOT map, which the human must handle.
 */
export function buildFillPlan(formFields: FormField[], profile: StudentProfile) {
  const values: Record<string, string> = {};
  const selects: Record<string, string> = {};
  const files: Record<string, string> = {};
  const unmapped: Array<{ label: string; selector: string; required: boolean; reason: string }> = [];
  const mappedDetail: Array<{ label: string; profile_key: string; confidence: number; method: string }> = [];

  for (const field of formFields) {
    if (!field.selector) continue;
    // HARD RULE 1: a submit control must never enter the fill plan.
    try {
      assertNotSubmit(field.selector, 'plan');
      assertNotSubmit(field.label, 'plan');
    } catch {
      continue;
    }

    const resolved = resolveWithValue(field.label, profile);

    if (!resolved.key) {
      unmapped.push({ label: field.label, selector: field.selector, required: field.required,
        reason: 'no confident profile match' });
      continue;
    }
    if (!resolved.hasValue) {
      unmapped.push({ label: field.label, selector: field.selector, required: field.required,
        reason: `profile has no value for ${resolved.key}` });
      continue;
    }

    mappedDetail.push({ label: field.label, profile_key: resolved.key,
      confidence: resolved.confidence, method: resolved.method });

    if (field.type === 'file' || resolved.type === 'file') {
      files[field.selector] = String(resolved.value);
      continue;
    }
    if (field.tag === 'select') {
      const kind = resolved.key.endsWith('category') ? 'category'
        : resolved.key.endsWith('gender') ? 'gender' : undefined;
      const option = matchSelectOption(String(resolved.value), field.options ?? [], kind);
      if (option) selects[field.selector] = option;
      else unmapped.push({ label: field.label, selector: field.selector, required: field.required,
        reason: `no dropdown option matches "${String(resolved.value)}"` });
      continue;
    }
    values[field.selector] = formatForField(resolved, field);
  }

  return { values, selects, files, unmapped, mappedDetail };
}

export async function fillApplication(input: FillApplicationInput) {
  const url = String(input.opportunity_url ?? '').trim();
  if (!url) {
    throw new ApplyOnceError('INVALID_INPUT', 'opportunity_url is required',
      'Pass the URL of the internship or scholarship you want to apply to.');
  }

  const portal = input.portal ?? detectPortal(url);
  const { profile } = loadProfile(input.profile_path);

  /* ---------------- LEARN-ONCE BOUNDARY ---------------- */
  const compiled = await hasCompiledCommand(portal, 'fill');
  const tracker = new RunTracker(compiled ? 'reuse' : 'learn', portal);
  if (!compiled) {
    throw new ApplyOnceError('ADAPTER_NOT_FOUND',
      `No compiled webcmd command for "${portal}". ApplyOnce would have to explore this portal from scratch.`,
      'Install the adapters with `npm run adapters:install`, then confirm with `webcmd list -f json`.',
      { portal });
  }

  const documents = checkDocuments(profile);

  /* ---- STEP 1: dry-run — read the real form (still read-only) ---- */
  tracker.step('scrape live form fields (dry run)');
  const dryRows = await execAdapter<AdapterFillResult[]>(portal, 'fill',
    [url, '--dry-run', '--values', '{}'],
    { session: input.session, timeoutMs: 240_000 });

  const dry = Array.isArray(dryRows) ? dryRows[0] : (dryRows as unknown as AdapterFillResult);
  if (!dry) {
    throw new ApplyOnceError('ADAPTER_FAILED', 'The fill adapter returned no result rows.',
      'Re-run once; if it persists, check `webcmd doctor`.');
  }
  if (dry.status === 'already_applied') {
    return {
      ok: true,
      status: 'already_applied' as const,
      portal,
      opportunity_url: url,
      submitted: false,
      message: 'You have already applied to this opportunity.',
      warnings: dry.warnings ?? [],
    };
  }

  const formFields = dry.form_fields ?? [];
  tracker.step(`map ${formFields.length} labels onto the profile`);

  /* ---- STEP 2: semantic mapping ---- */
  const plan = buildFillPlan(formFields, profile);

  log.info('mapping.result',
    `Mapped ${plan.mappedDetail.length}/${formFields.length} form fields from the profile`,
    { portal, mapped: plan.mappedDetail.length, unmapped: plan.unmapped.length });

  /* ---- STEP 3: the write step (human-gated, stops before submit) ---- */
  let result: AdapterFillResult = dry;
  if (!input.dry_run) {
    tracker.step('fill the form up to the final submit button');
    const args = [
      url,
      '--values', JSON.stringify(plan.values),
      '--files', JSON.stringify(plan.files),
    ];
    if (portal === 'scholarship') {
      args.push('--selects', JSON.stringify(plan.selects));
    }
    const rows = await execAdapter<AdapterFillResult[]>(portal, 'fill', args,
      { session: input.session, timeoutMs: 300_000 });
    result = Array.isArray(rows) ? rows[0] : (rows as unknown as AdapterFillResult);
  }

  const metrics = tracker.finish();

  /* ---- STEP 4: THE APPROVAL GATE — always, unconditionally ---- */
  const missingDocuments = documents.missing.map((m) => ({ document: m.key, path: m.path, reason: m.reason }));

  logApprovalGate({
    portal,
    opportunityId: url,
    filledCount: result.filled_count ?? 0,
    unmappedCount: plan.unmapped.length,
    missingDocsCount: missingDocuments.length,
    submitUrl: result.submit_url ?? url,
  });

  // Defence in depth: if an adapter ever claimed to submit, fail loudly.
  if (result.submitted === true) {
    throw new ApplyOnceError('SUBMIT_BLOCKED',
      'An adapter reported submitted:true. ApplyOnce must never submit.',
      'This is a bug — report it. No further action was taken.');
  }

  return {
    ok: true,
    status: 'ready_for_review' as const,
    submitted: false,                       // ALWAYS false — HARD RULE 1
    portal,
    opportunity_url: url,
    submit_url: result.submit_url ?? url,
    filled_fields: maskDeep(result.filled_fields ?? {}),
    selects_set: result.selects_set ?? {},
    uploads: result.uploads ?? [],
    filled_count: result.filled_count ?? 0,
    form_fields_detected: result.form_fields_detected ?? formFields.length,
    mapping: plan.mappedDetail,
    unmapped_fields: plan.unmapped,
    missing_documents: missingDocuments,
    unfilled: result.unfilled ?? [],
    submit_control: result.submit_control ?? null,
    warnings: result.warnings ?? [],
    learn_once: {
      mode: metrics.mode,
      steps: metrics.steps,
      duration_ms: metrics.durationMs,
      used_compiled_command: compiled,
    },
    human_approval_required: true,
    next_step: `ApplyOnce filled this application and STOPPED before submitting. Open ${result.submit_url ?? url}, review every field, then submit yourself.`,
  };
}
