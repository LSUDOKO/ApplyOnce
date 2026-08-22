/**
 * Machine-readable errors. Every failure an MCP client sees carries a stable
 * `code`, a human `message`, and a `recovery_hint` telling the agent what to
 * do next — never a bare stack trace.
 */

export type ErrorCode =
  | 'SUBMIT_BLOCKED'
  | 'READ_ONLY_VIOLATION'
  | 'ANTI_BOT_DETECTED'
  | 'PROFILE_INVALID'
  | 'PROFILE_NOT_FOUND'
  | 'ADAPTER_NOT_FOUND'
  | 'ADAPTER_FAILED'
  | 'WEBCMD_UNAVAILABLE'
  | 'LOGIN_REQUIRED'
  | 'OPPORTUNITY_NOT_FOUND'
  | 'MISSING_DOCUMENTS'
  | 'UNMAPPED_REQUIRED_FIELDS'
  | 'SELF_HEAL_FAILED'
  | 'TIMEOUT'
  | 'INVALID_INPUT';

/** Default remediation per code, used when a call site does not supply one. */
const DEFAULT_HINTS: Record<ErrorCode, string> = {
  SUBMIT_BLOCKED: 'ApplyOnce never submits. Review the filled form and submit manually.',
  READ_ONLY_VIOLATION: 'Use fill_application for write actions; discovery tools are read-only.',
  ANTI_BOT_DETECTED: 'Clear the challenge manually in your browser, then retry once.',
  PROFILE_INVALID: 'Fix the reported fields against schemas/profile.schema.json and retry.',
  PROFILE_NOT_FOUND: 'Pass profile_path, or place a profile at data/profiles/<id>.json.',
  ADAPTER_NOT_FOUND: 'Run `npm run adapters:install`, then `webcmd list -f json` to confirm.',
  ADAPTER_FAILED: 'Re-run once. If it repeats, the portal layout may have changed — self-heal will attempt fallbacks.',
  WEBCMD_UNAVAILABLE: 'Install webcmd (`npm i -g @agentrhq/webcmd`) and run `webcmd doctor`.',
  LOGIN_REQUIRED: 'Log in to the portal in your webcmd browser profile, then retry.',
  OPPORTUNITY_NOT_FOUND: 'Run find_opportunities first to get a valid opportunity_id.',
  MISSING_DOCUMENTS: 'Add the missing document paths to your profile and retry.',
  UNMAPPED_REQUIRED_FIELDS: 'Fill the listed fields manually in the browser before submitting.',
  SELF_HEAL_FAILED: 'All fallback strategies failed. The portal likely changed structurally; re-author the adapter.',
  TIMEOUT: 'The portal was slow. Retry once; if it persists the site may be down.',
  INVALID_INPUT: 'Check the tool arguments against the documented schema.',
};

export class ApplyOnceError extends Error {
  readonly code: ErrorCode;
  readonly recoveryHint: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    recoveryHint?: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApplyOnceError';
    this.code = code;
    this.recoveryHint = recoveryHint ?? DEFAULT_HINTS[code];
    this.details = details;
  }

  /** The exact shape every MCP tool returns on failure. */
  toJSON(): {
    ok: false;
    error: { code: ErrorCode; message: string; recovery_hint: string; details: Record<string, unknown> };
  } {
    return {
      ok: false,
      error: {
        code: this.code,
        message: this.message,
        recovery_hint: this.recoveryHint,
        details: this.details,
      },
    };
  }
}

/** Normalise any thrown value into an ApplyOnceError. */
export function toApplyOnceError(err: unknown, fallbackCode: ErrorCode = 'ADAPTER_FAILED'): ApplyOnceError {
  if (err instanceof ApplyOnceError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ApplyOnceError(fallbackCode, message);
}
