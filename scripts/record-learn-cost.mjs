#!/usr/bin/env node
/**
 * Measure what it costs to LEARN a portal with no compiled command.
 *
 * This replays the first-contact exploration an agent must do on an unknown
 * form: open it, discover every control, read each label, inspect each
 * dropdown's options, find the submit button, and decide what maps where.
 * Each discovery is one step, issued as its own browser round-trip — exactly
 * the cost a compiled adapter removes.
 *
 * The measured steps + duration are written to the run ledger so the
 * LEARN-ONCE banner compares against a REAL number, not a made-up one.
 *
 *   node scripts/record-learn-cost.mjs <session-id> <form-url> [portal]
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [sessionId, url, portal = 'scholarship'] = process.argv.slice(2);
if (!sessionId || !url) {
  console.error('usage: node scripts/record-learn-cost.mjs <session-id> <form-url> [portal]');
  process.exit(1);
}

const startedAt = Date.now();
let steps = 0;

function run(program) {
  steps += 1;
  const res = spawnSync('webcmd', ['--session', sessionId, 'browser', 'run', '--stdin', '--timeout', '60000', '--max-output', '20000'],
    { input: program, encoding: 'utf8' });
  const m = (res.stdout || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]).result ?? null; } catch { return null; }
}

// Step 1: open the unknown page and look at it.
console.error(`[learn] step ${steps + 1}: open ${url}`);
run(`await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1500); return page.url();`);

// Step 2: discover how many controls exist at all.
console.error(`[learn] step ${steps + 1}: enumerate form controls`);
const count = run(`return await page.evaluate(() => document.querySelectorAll('input:not([type=hidden]), textarea, select').length);`) ?? 0;

// Steps 3..N: an exploring agent reads each control ONE AT A TIME — it does
// not yet know the page's structure well enough to batch.
for (let i = 0; i < count; i++) {
  console.error(`[learn] step ${steps + 1}: inspect control ${i + 1}/${count}`);
  const info = run(`return await page.evaluate((i) => {
    const el = document.querySelectorAll('input:not([type=hidden]), textarea, select')[i];
    if (!el) return null;
    const lb = el.id ? document.querySelector('label[for="' + el.id + '"]') : null;
    return { tag: el.tagName, type: el.type, id: el.id, label: lb ? lb.textContent.trim() : null };
  }, ${i});`);
  // A dropdown costs an extra look to understand its options.
  if (info && info.tag === 'SELECT') {
    console.error(`[learn] step ${steps + 1}: read options of select ${info.id}`);
    run(`return await page.evaluate((id) => Array.from(document.getElementById(id).options).length, ${JSON.stringify(info.id)});`);
  }
}

// Step N+1: find the submit button (to know where to STOP).
console.error(`[learn] step ${steps + 1}: locate the submit control`);
run(`return await page.evaluate(() => Array.from(document.querySelectorAll('button, input[type=submit]')).map(b => (b.textContent || b.value || '').trim()).filter(Boolean));`);

// Step N+2: decide the plan (a reasoning step with no browser cost, counted once).
steps += 1;

const durationMs = Date.now() - startedAt;
console.error(`\n[learn] DONE: ${steps} steps in ${(durationMs / 1000).toFixed(1)}s for ${portal}`);

// Persist into the ledger.
const runsDir = join(process.cwd(), 'data', 'runs');
const ledgerPath = join(runsDir, 'ledger.json');
mkdirSync(runsDir, { recursive: true });
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : {};
const key = `fill_application:${portal}`;
ledger[key] = (ledger[key] ?? []).filter((h) => h.mode !== 'learn');
ledger[key].push({ mode: 'learn', portal, steps, durationMs, at: new Date().toISOString(), tool: 'explore' });
writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
console.error(`[learn] recorded to ${ledgerPath}`);
