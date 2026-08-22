/**
 * Run ledger — makes the learn-once before/after HONEST.
 *
 * The first run on a portal is recorded. The next run on the same portal
 * reads that record and prints a real comparison (steps + time), rather than
 * a fabricated "before" number. Stored locally under data/runs/, gitignored.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../profile/loader.js';
import { logLearnOnceComparison, type RunMetrics } from './logger.js';

const RUNS_DIR = join(PROJECT_ROOT, 'data', 'runs');
const LEDGER = join(RUNS_DIR, 'ledger.json');

interface LedgerEntry extends RunMetrics {
  at: string;
  tool: string;
}

function load(): Record<string, LedgerEntry[]> {
  try {
    if (!existsSync(LEDGER)) return {};
    return JSON.parse(readFileSync(LEDGER, 'utf8')) as Record<string, LedgerEntry[]>;
  } catch {
    return {};
  }
}

function save(data: Record<string, LedgerEntry[]>): void {
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(LEDGER, JSON.stringify(data, null, 2));
  } catch {
    /* a ledger write failure must never break a tool call */
  }
}

/**
 * Record this run and, if a prior run exists for the portal, print the
 * learn-once comparison banner. Returns the prior run when there was one.
 */
export function recordRun(tool: string, metrics: RunMetrics): RunMetrics | null {
  const data = load();
  const key = `${tool}:${metrics.portal}`;
  const history = data[key] ?? [];
  const previous = history[0] ?? null;

  history.unshift({ ...metrics, at: new Date().toISOString(), tool });
  data[key] = history.slice(0, 20);
  save(data);

  // Only print a comparison when an actual LEARN run exists for this portal.
  // We never relabel a reuse run as "learn" to manufacture a saving — the
  // banner is the product's central claim, so it must be true.
  const learnRun = history.find((h) => h.mode === 'learn');
  if (learnRun && metrics.mode === 'reuse') {
    logLearnOnceComparison(learnRun, metrics);
  }
  return previous;
}

/**
 * Record the cost of LEARNING a portal — the browser exploration an agent
 * performs on first contact, before a compiled command exists. ApplyOnce's
 * adapters were authored this way; `scripts/record-learn-cost.mjs` replays
 * that exploration and stores its real step count and duration here, so the
 * before/after banner compares against a measured number.
 */
export function recordLearnRun(portal: string, steps: number, durationMs: number): void {
  const data = load();
  const key = `fill_application:${portal}`;
  const history = (data[key] ?? []).filter((h) => h.mode !== 'learn');
  history.push({ mode: 'learn', portal, steps, durationMs, at: new Date().toISOString(), tool: 'explore' });
  data[key] = history;
  save(data);
}

/** Used by list_learned_portals to show per-portal history. */
export function runHistory(): Record<string, LedgerEntry[]> {
  return load();
}
