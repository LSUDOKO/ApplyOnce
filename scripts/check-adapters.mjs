#!/usr/bin/env node
/**
 * Adapter sanity gate (runs in CI).
 *
 * 1. Every adapter file must parse and import cleanly.
 * 2. No backticks inside a page.evaluate(`...`) template literal — a stray
 *    backtick in a comment silently terminates the literal and breaks the
 *    adapter at load time. This bit us twice while authoring, so it is a test.
 * 3. No adapter may contain a code path that clicks a submit/pay control
 *    (HARD RULE 1). We assert the guard is imported wherever writes happen.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DIR = resolve('plugins/applyonce');
const files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
const problems = [];

for (const file of files) {
  const path = join(DIR, file);
  const source = readFileSync(path, 'utf8');

  // (2) unbalanced backticks inside evaluate templates
  const evalBlocks = source.match(/page\.evaluate\(`[\s\S]*?`\)/g) ?? [];
  const backtickCount = (source.match(/`/g) ?? []).length;
  if (backtickCount % 2 !== 0) {
    problems.push(`${file}: odd number of backticks (${backtickCount}) — a comment likely closed a template literal`);
  }
  for (const block of evalBlocks) {
    const inner = block.slice('page.evaluate('.length + 1, -2);
    if (inner.includes('`')) {
      problems.push(`${file}: a backtick appears INSIDE a page.evaluate template literal`);
    }
  }

  // (3) HARD RULE 1 — fill adapters must import the submit guard
  if (/-fill\.js$/.test(file)) {
    if (!source.includes('assertNotSubmit')) {
      problems.push(`${file}: a fill adapter must import and call assertNotSubmit (HARD RULE 1)`);
    }
    if (!/submitted:\s*false/.test(source)) {
      problems.push(`${file}: a fill adapter must always return submitted: false (HARD RULE 1)`);
    }
  }

  // (1) it must actually load
  try {
    await import(pathToFileURL(path).href);
  } catch (err) {
    problems.push(`${file}: failed to import — ${String(err.message).slice(0, 120)}`);
  }
}

if (problems.length) {
  console.error('Adapter checks FAILED:\n' + problems.map((p) => `  ✖ ${p}`).join('\n'));
  process.exit(1);
}
console.log(`Adapter checks passed for ${files.length} files.`);
