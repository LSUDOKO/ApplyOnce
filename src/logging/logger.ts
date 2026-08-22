/**
 * Structured logging.
 *
 * Two things must be VISIBLE in the logs because they are the product:
 *   1. THE LEARN-ONCE BOUNDARY — first run explores (many steps, slow),
 *      second run executes a compiled command (one step, fast). We print an
 *      explicit before/after comparison.
 *   2. EVERY HUMAN-APPROVAL GATE — each time we stop short of submitting.
 *
 * All logs go to STDERR. STDOUT is reserved for the MCP JSON-RPC stream;
 * writing logs there would corrupt the protocol.
 */

import { maskDeep } from '../safety.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEvent =
  | 'learn.start' | 'learn.step' | 'learn.complete'
  | 'reuse.hit' | 'reuse.miss'
  | 'selfheal.start' | 'selfheal.fallback' | 'selfheal.recovered' | 'selfheal.failed'
  | 'gate.approval_required' | 'gate.submit_blocked'
  | 'tool.start' | 'tool.end' | 'tool.error'
  | 'adapter.exec' | 'profile.loaded' | 'mapping.result';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.APPLYONCE_LOG_LEVEL as LogLevel) ?? 'info';
const PRETTY = process.env.APPLYONCE_LOG_FORMAT !== 'json';

const COLORS = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function color(text: string, c: keyof typeof COLORS): string {
  return process.stderr.isTTY ? `${COLORS[c]}${text}${COLORS.reset}` : text;
}

export interface LogRecord {
  ts: string;
  level: LogLevel;
  event: LogEvent;
  msg: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, event: LogEvent, msg: string, data: Record<string, unknown> = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MIN_LEVEL]) return;

  // RULE 5: no personal data ever reaches a log line unmasked.
  const safeData = maskDeep(data);
  const record: LogRecord = { ts: new Date().toISOString(), level, event, msg, ...safeData };

  if (!PRETTY) {
    process.stderr.write(`${JSON.stringify(record)}\n`);
    return;
  }

  const levelColor: Record<LogLevel, keyof typeof COLORS> = {
    debug: 'dim', info: 'blue', warn: 'yellow', error: 'red',
  };
  const time = color(record.ts.slice(11, 19), 'dim');
  const tag = color(`[${event}]`, levelColor[level]);
  const extra = Object.keys(safeData as object).length
    ? color(` ${JSON.stringify(safeData)}`, 'dim')
    : '';
  process.stderr.write(`${time} ${tag} ${msg}${extra}\n`);
}

export const log = {
  debug: (event: LogEvent, msg: string, data?: Record<string, unknown>) => emit('debug', event, msg, data),
  info: (event: LogEvent, msg: string, data?: Record<string, unknown>) => emit('info', event, msg, data),
  warn: (event: LogEvent, msg: string, data?: Record<string, unknown>) => emit('warn', event, msg, data),
  error: (event: LogEvent, msg: string, data?: Record<string, unknown>) => emit('error', event, msg, data),
};

/** Print a banner to stderr. Used for the two moments that must not be missed. */
export function banner(title: string, lines: string[], tone: 'gate' | 'learn' | 'reuse' | 'heal' = 'learn'): void {
  const toneColor: Record<typeof tone, keyof typeof COLORS> = {
    gate: 'yellow', learn: 'magenta', reuse: 'green', heal: 'cyan',
  } as const;
  const width = Math.max(title.length, ...lines.map((l) => l.length)) + 4;
  const bar = '═'.repeat(width);
  process.stderr.write(`\n${color(`╔${bar}╗`, toneColor[tone])}\n`);
  process.stderr.write(`${color('║', toneColor[tone])}  ${color(title.padEnd(width - 2), 'bold')}${color('║', toneColor[tone])}\n`);
  process.stderr.write(`${color(`╟${bar}╢`, toneColor[tone])}\n`);
  for (const line of lines) {
    process.stderr.write(`${color('║', toneColor[tone])}  ${line.padEnd(width - 2)}${color('║', toneColor[tone])}\n`);
  }
  process.stderr.write(`${color(`╚${bar}╝`, toneColor[tone])}\n\n`);
}

/**
 * ==========================================================================
 * HUMAN-APPROVAL GATE (RULE 1) — printed every single time we stop.
 * ==========================================================================
 */
export function logApprovalGate(params: {
  portal: string;
  opportunityId: string;
  filledCount: number;
  unmappedCount: number;
  missingDocsCount: number;
  submitUrl: string;
}): void {
  banner('⛔ HUMAN APPROVAL REQUIRED — NOT SUBMITTED', [
    `Portal            : ${params.portal}`,
    `Opportunity       : ${params.opportunityId}`,
    `Fields filled     : ${params.filledCount}`,
    `Unmapped fields   : ${params.unmappedCount}`,
    `Missing documents : ${params.missingDocsCount}`,
    '',
    'ApplyOnce filled this application up to the final submit',
    'button and STOPPED. No submit or payment action was taken.',
    '',
    `Review and submit yourself: ${params.submitUrl}`,
  ], 'gate');

  log.warn('gate.approval_required', 'Stopped before submit — awaiting human approval', {
    portal: params.portal,
    opportunity_id: params.opportunityId,
    submitted: false,
  });
}

/**
 * ==========================================================================
 * THE LEARN-ONCE BOUNDARY — the whole point of the project, made visible.
 * ==========================================================================
 * Prints an explicit before/after so a judge can see the saving in one glance.
 */
export interface RunMetrics {
  mode: 'learn' | 'reuse';
  portal: string;
  steps: number;
  durationMs: number;
  tokensEstimate?: number;
}

export function logLearnOnceComparison(first: RunMetrics, second: RunMetrics): void {
  const stepsSaved = first.steps - second.steps;
  const timeSaved = first.durationMs - second.durationMs;
  const pct = first.durationMs > 0 ? Math.round((timeSaved / first.durationMs) * 100) : 0;
  const stepPct = first.steps > 0 ? Math.round((stepsSaved / first.steps) * 100) : 0;

  banner('⚡ LEARN-ONCE ADVANTAGE', [
    `Portal: ${first.portal}`,
    '',
    'RUN 1  (LEARN)   explored the portal, authored a command',
    `   steps : ${String(first.steps).padStart(4)}   time : ${fmtMs(first.durationMs)}`,
    '',
    'RUN 2  (REUSE)   executed the compiled command directly',
    `   steps : ${String(second.steps).padStart(4)}   time : ${fmtMs(second.durationMs)}`,
    '',
    `SAVED  : ${stepsSaved} steps (${stepPct}%)  •  ${fmtMs(timeSaved)} (${pct}%)`,
    'Run 2 performed NO exploration and NO reasoning about layout.',
  ], 'reuse');

  log.info('reuse.hit', 'Learn-once comparison', {
    portal: first.portal,
    first_run: { steps: first.steps, ms: first.durationMs },
    second_run: { steps: second.steps, ms: second.durationMs },
    saved_steps: stepsSaved,
    saved_ms: timeSaved,
    saved_pct: pct,
  });
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Simple step counter used to produce the before/after numbers honestly. */
export class RunTracker {
  private steps = 0;
  private readonly startedAt = Date.now();

  constructor(readonly mode: 'learn' | 'reuse', readonly portal: string) {
    log.info(mode === 'learn' ? 'learn.start' : 'reuse.hit',
      mode === 'learn'
        ? `First run on ${portal}: no compiled command found — EXPLORING (this is the slow path, once)`
        : `Compiled command found for ${portal}: EXECUTING INSTANTLY (no exploration)`,
      { portal, mode });
  }

  step(description: string): void {
    this.steps += 1;
    log.debug(this.mode === 'learn' ? 'learn.step' : 'adapter.exec',
      `step ${this.steps}: ${description}`, { portal: this.portal });
  }

  finish(): RunMetrics {
    const metrics: RunMetrics = {
      mode: this.mode,
      portal: this.portal,
      steps: this.steps,
      durationMs: Date.now() - this.startedAt,
    };
    log.info(this.mode === 'learn' ? 'learn.complete' : 'tool.end',
      `${this.mode} run finished in ${fmtMs(metrics.durationMs)} across ${metrics.steps} steps`,
      { portal: this.portal, steps: metrics.steps, ms: metrics.durationMs });
    return metrics;
  }
}
