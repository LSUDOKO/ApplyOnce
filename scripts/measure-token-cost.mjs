#!/usr/bin/env node
/**
 * ============================================================================
 * Measure the TOKEN cost of learning a portal vs reusing a compiled command.
 * ============================================================================
 * The headline webcmd claim is "stop paying agents to rediscover the web". This
 * script measures that claim on a real form instead of asserting it.
 *
 * WHAT IS COUNTED, AND WHY IT IS FAIR
 *   Every browser round-trip returns an OBSERVATION the model must read before
 *   it can decide the next action. Those observation payloads are the tokens an
 *   exploring agent spends on navigation. We capture the ACTUAL bytes returned
 *   by each call in both modes and convert with the standard ~4 chars/token
 *   approximation.
 *
 *   LEARN mode replays first contact with an unknown form: open it, count the
 *   controls, then inspect each control one at a time (a snapshot per step,
 *   because the agent cannot batch what it has not yet seen), read each
 *   dropdown's options, and locate the submit control.
 *
 *   REUSE mode is what a compiled webcmd command costs: run it, read one
 *   structured JSON result.
 *
 *   We deliberately count only page observations — not the system prompt or the
 *   task text, which are identical in both modes. That makes this a measurement
 *   of navigation cost specifically, which is what webcmd removes.
 *
 * USAGE
 *   node scripts/measure-token-cost.mjs <session-id> <form-url> [portal]
 * ============================================================================
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [sessionId, url, portal = 'scholarship'] = process.argv.slice(2);
if (!sessionId || !url) {
  console.error('usage: node scripts/measure-token-cost.mjs <session-id> <form-url> [portal]');
  process.exit(1);
}

/** Standard approximation: ~4 characters per token for English + markup. */
const CHARS_PER_TOKEN = 4;
const tokens = (chars) => Math.round(chars / CHARS_PER_TOKEN);

function runProgram(program) {
  const res = spawnSync('webcmd',
    ['--session', sessionId, 'browser', 'run', '--stdin', '--timeout', '60000', '--max-output', '200000'],
    { input: program, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const stdout = res.stdout ?? '';
  let result = null;
  const m = stdout.match(/\{[\s\S]*\}/);
  if (m) { try { result = JSON.parse(m[0]).result ?? null; } catch { /* ignore */ } }
  // The observation is what the agent would actually have to read back.
  return { result, bytes: stdout.length };
}

/* ------------------------------------------------------------------ *
 * MODE 1 — LEARN: first contact with an unknown form.
 * ------------------------------------------------------------------ */
console.error('\n=== LEARN MODE (no compiled command — the agent must explore) ===');
const learn = { steps: 0, chars: 0, startedAt: Date.now() };

const observe = (program, label) => {
  const { result, bytes } = runProgram(program);
  learn.steps += 1;
  learn.chars += bytes;
  console.error(`  step ${String(learn.steps).padStart(2)}: ${label.padEnd(38)} +${String(bytes).padStart(6)} chars`);
  return result;
};

observe(
  `await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); return await page.evaluate(() => document.title);`,
  'open the unknown page');

const count = observe(
  `return await page.evaluate(() => document.querySelectorAll('input:not([type=hidden]), textarea, select').length);`,
  'count the form controls') ?? 0;

for (let i = 0; i < count; i++) {
  const info = observe(
    `return await page.evaluate((i) => {
      const el = document.querySelectorAll('input:not([type=hidden]), textarea, select')[i];
      if (!el) return null;
      const lb = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
      return { tag: el.tagName, type: el.type, id: el.id, name: el.name,
               label: lb ? lb.textContent.trim() : null, required: el.required };
    }, ${i});`,
    `inspect control ${i + 1}/${count}`);

  if (info && info.tag === 'SELECT' && info.id) {
    observe(
      `return await page.evaluate((id) => Array.from(document.getElementById(id).options).map(o => o.textContent.trim()), ${JSON.stringify(info.id)});`,
      `read options of <select #${info.id}>`);
  }
}

observe(
  `return await page.evaluate(() => Array.from(document.querySelectorAll('button, input[type=submit]')).map(b => (b.textContent || b.value || '').trim()).filter(Boolean));`,
  'locate the submit control');

learn.durationMs = Date.now() - learn.startedAt;

/* ------------------------------------------------------------------ *
 * MODE 2 — REUSE: the compiled webcmd command.
 * ------------------------------------------------------------------ */
console.error('\n=== REUSE MODE (compiled webcmd command) ===');
const reuse = { steps: 0, chars: 0, startedAt: Date.now() };

const cmd = spawnSync('webcmd',
  ['--session', sessionId, portal, 'fill', url, '--dry-run', '-f', 'json'],
  { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const cmdOut = cmd.stdout ?? '';
reuse.steps = 1;
reuse.chars = cmdOut.length;
reuse.durationMs = Date.now() - reuse.startedAt;
console.error(`  step  1: webcmd ${portal} fill --dry-run`.padEnd(52) + `+${String(cmdOut.length).padStart(6)} chars`);

/* ------------------------------------------------------------------ *
 * REPORT
 * ------------------------------------------------------------------ */
const learnTokens = tokens(learn.chars);
const reuseTokens = tokens(reuse.chars);
const savedTokens = learnTokens - reuseTokens;
const savedPct = learnTokens > 0 ? Math.round((savedTokens / learnTokens) * 100) : 0;
const stepPct = learn.steps > 0 ? Math.round(((learn.steps - reuse.steps) / learn.steps) * 100) : 0;

const bar = '═'.repeat(62);
console.error(`\n╔${bar}╗`);
console.error(`║  TOKEN COST: exploring vs a compiled webcmd command`.padEnd(63) + '║');
console.error(`╟${bar}╢`);
console.error(`║  Portal: ${portal}`.padEnd(63) + '║');
console.error(`║`.padEnd(63) + '║');
console.error(`║  WITHOUT webcmd (agent explores the form)`.padEnd(63) + '║');
console.error(`║    steps: ${String(learn.steps).padStart(4)}   observations: ${String(learn.chars).padStart(7)} chars  ≈ ${String(learnTokens).padStart(6)} tokens`.padEnd(63) + '║');
console.error(`║`.padEnd(63) + '║');
console.error(`║  WITH webcmd (compiled command)`.padEnd(63) + '║');
console.error(`║    steps: ${String(reuse.steps).padStart(4)}   observations: ${String(reuse.chars).padStart(7)} chars  ≈ ${String(reuseTokens).padStart(6)} tokens`.padEnd(63) + '║');
console.error(`║`.padEnd(63) + '║');
console.error(`║  SAVED: ${String(savedTokens).padStart(6)} tokens (${savedPct}%)   •   ${learn.steps - reuse.steps} steps (${stepPct}%)`.padEnd(63) + '║');
console.error(`╚${bar}╝\n`);

const report = {
  measuredAt: new Date().toISOString(),
  portal, url,
  charsPerToken: CHARS_PER_TOKEN,
  without_webcmd: { steps: learn.steps, chars: learn.chars, tokens: learnTokens, durationMs: learn.durationMs },
  with_webcmd: { steps: reuse.steps, chars: reuse.chars, tokens: reuseTokens, durationMs: reuse.durationMs },
  saved: { tokens: savedTokens, percent: savedPct, steps: learn.steps - reuse.steps, stepPercent: stepPct },
  note: 'Counts page-observation payloads only — the bytes an agent must read to decide its next action. System prompt and task text are identical in both modes and excluded.',
};

const dir = join(process.cwd(), 'data', 'runs');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'token-cost.json');
const history = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
history.unshift(report);
writeFileSync(path, JSON.stringify(history.slice(0, 20), null, 2));
console.error(`Report written to ${path}`);
console.log(JSON.stringify(report, null, 2));
