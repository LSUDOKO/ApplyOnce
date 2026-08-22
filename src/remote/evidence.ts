/**
 * ============================================================================
 * webcmd EVIDENCE — proof in every tool response.
 * ============================================================================
 * A tool result is the only thing an MCP client ever sees. If the webcmd
 * dependency lives only in server logs, nobody watching a demo can verify it.
 *
 * So every tool attaches a `_webcmd` block reporting exactly what webcmd did on
 * that call: which command ran, which network tier it needed, how many bytes it
 * returned, and the token cost avoided by not re-exploring the page.
 *
 * The numbers are per-call and real, not a stored constant.
 * ============================================================================
 */

/** Standard approximation used throughout ApplyOnce: ~4 chars per token. */
const CHARS_PER_TOKEN = 4;

/**
 * Measured on a real 28-field application form (scripts/measure-token-cost.mjs):
 * an exploring agent needs ~35 browser round-trips returning ~22,150 chars of
 * page observations before it can act. That is the cost a compiled webcmd
 * command removes, and the baseline we compare each call against.
 */
export const EXPLORATION_BASELINE = {
  steps: 35,
  chars: 22_150,
  tokens: Math.round(22_150 / CHARS_PER_TOKEN),   // ≈ 5538
} as const;

export interface WebcmdCall {
  /** Which webcmd command served this request. */
  command: string;
  /** 'plain' = a normal request worked. 'impit' = webcmd escalated to a browser fingerprint. */
  tier?: string;
  /** Bytes webcmd actually returned. */
  chars: number;
  url?: string;
}

export interface WebcmdEvidence {
  engine: 'webcmd';
  version: string;
  calls: Array<{ command: string; tier: string; url?: string; chars: number; tokens: number }>;
  tokens_used: number;
  tokens_if_explored: number;
  tokens_saved: number;
  percent_saved: number;
  browser_steps_avoided: number;
  how: string;
}

/**
 * Build the evidence block for one tool call.
 * `calls` is whatever webcmd actually did while serving this request.
 */
export function webcmdEvidence(calls: WebcmdCall[], webcmdVersion = '0.7.4'): WebcmdEvidence {
  const detailed = calls.map((c) => ({
    command: c.command,
    tier: c.tier ?? 'plain',
    ...(c.url ? { url: c.url } : {}),
    chars: c.chars,
    tokens: Math.round(c.chars / CHARS_PER_TOKEN),
  }));

  const tokensUsed = detailed.reduce((sum, c) => sum + c.tokens, 0);
  // One page was read, so one exploration is what was avoided.
  const baseline = EXPLORATION_BASELINE.tokens * Math.max(1, calls.length);
  const saved = Math.max(0, baseline - tokensUsed);
  const percent = baseline > 0 ? Math.round((saved / baseline) * 100) : 0;

  return {
    engine: 'webcmd',
    version: webcmdVersion,
    calls: detailed,
    tokens_used: tokensUsed,
    tokens_if_explored: baseline,
    tokens_saved: saved,
    percent_saved: percent,
    browser_steps_avoided: EXPLORATION_BASELINE.steps * Math.max(1, calls.length) - calls.length,
    how: `webcmd returned this page in ${calls.length} call(s) instead of the ~${EXPLORATION_BASELINE.steps} browser round-trips an agent needs to explore an unfamiliar page. Tokens counted at ~${CHARS_PER_TOKEN} chars each.`,
  };
}

/** A one-line summary an assistant will naturally read aloud. */
export function webcmdSummary(evidence: WebcmdEvidence): string {
  const tiers = [...new Set(evidence.calls.map((c) => c.tier))].join(', ');
  return `Served by webcmd v${evidence.version} (${evidence.calls.map((c) => c.command).join(', ')}; tier: ${tiers}) — `
    + `${evidence.tokens_used.toLocaleString()} tokens used vs ~${evidence.tokens_if_explored.toLocaleString()} if the agent had explored the page itself. `
    + `Saved ~${evidence.tokens_saved.toLocaleString()} tokens (${evidence.percent_saved}%) and ${evidence.browser_steps_avoided} browser steps.`;
}
