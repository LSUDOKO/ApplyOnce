/**
 * ============================================================================
 * WEBCMD BRIDGE — the learn-once boundary lives here
 * ============================================================================
 * VERIFIED against @agentrhq/webcmd v0.7.4 (github.com/agentrhq/webcmd):
 *   • webcmd ships NO MCP server. `start.md` states MCP support is "not
 *     implemented yet". Adapters are CLI commands, so ApplyOnce is the MCP
 *     server and drives webcmd over its CLI. This module is that boundary.
 *   • `webcmd list -f json` is documented as "the source of truth for agents".
 *   • Adapters register via cli({ site, name, func }) from
 *     '@agentrhq/webcmd/registry' and are installed with `webcmd plugin install`.
 *
 * THE LEARN-ONCE RULE, in one sentence:
 *   if a compiled command for this portal exists  -> EXECUTE it (fast path)
 *   otherwise                                     -> EXPLORE and author (slow, once)
 * `hasCompiledCommand()` below is the exact branch point.
 * ============================================================================
 */

import { spawn } from 'node:child_process';
import { ApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';
import { POLITENESS } from '../safety.js';

export interface WebcmdCommand {
  command: string;
  site: string;
  name: string;
  description: string;
  access: string;
  strategy: string;
  browser: boolean;
  tags?: string[];
  args?: Array<{ name: string; type?: string; required?: boolean; help?: string }>;
  columns?: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  durationMs: number;
}

const WEBCMD_BIN = process.env.APPLYONCE_WEBCMD_BIN ?? 'webcmd';
const DEFAULT_TIMEOUT_MS = Number(process.env.APPLYONCE_WEBCMD_TIMEOUT ?? 180_000);

/** Last navigation timestamp per site, to honour the politeness budget (RULE 4). */
const lastCallAt = new Map<string, number>();

async function politeDelay(site: string): Promise<void> {
  const previous = lastCallAt.get(site);
  if (previous) {
    const wait = POLITENESS.minDelayMs - (Date.now() - previous);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastCallAt.set(site, Date.now());
}

/** Run a raw webcmd invocation. Never throws on non-zero — returns the result. */
export function runWebcmd(args: string[], timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ExecResult> {
  const startedAt = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(WEBCMD_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolvePromise({
        stdout, stderr: `${stderr}\n[applyonce] timed out after ${timeoutMs}ms`,
        code: 124, durationMs: Date.now() - startedAt,
      });
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += String(d); });
    child.stderr.on('data', (d) => { stderr += String(d); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        stdout, stderr: `${stderr}\n${err.message}`,
        code: 127, durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, code: code ?? 0, durationMs: Date.now() - startedAt });
    });
  });
}

/** Is the webcmd CLI present and healthy? */
export async function checkWebcmd(): Promise<{ available: boolean; version: string | null }> {
  const res = await runWebcmd(['--version'], 15_000);
  if (res.code === 127) return { available: false, version: null };
  const version = res.stdout.trim().split('\n')[0] || null;
  return { available: res.code === 0, version };
}

export async function requireWebcmd(): Promise<string> {
  const { available, version } = await checkWebcmd();
  if (!available) {
    throw new ApplyOnceError('WEBCMD_UNAVAILABLE',
      `The webcmd CLI could not be executed (tried "${WEBCMD_BIN}").`,
      'Install it with `npm i -g @agentrhq/webcmd`, then run `webcmd doctor`.');
  }
  return version ?? 'unknown';
}

/**
 * `webcmd list -f json` — the registry of COMPILED commands.
 * This is what makes learn-once observable: anything in here is already learned.
 */
export async function listCommands(): Promise<WebcmdCommand[]> {
  const res = await runWebcmd(['list', '-f', 'json'], 30_000);
  if (res.code !== 0) {
    throw new ApplyOnceError('WEBCMD_UNAVAILABLE',
      `\`webcmd list -f json\` failed (exit ${res.code}): ${res.stderr.trim().slice(0, 300)}`,
      'Run `webcmd doctor` to check the daemon and browser runtime.');
  }
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? (parsed as WebcmdCommand[]) : [];
  } catch {
    throw new ApplyOnceError('WEBCMD_UNAVAILABLE',
      'Could not parse the output of `webcmd list -f json`.',
      'Upgrade webcmd (`npm i -g @agentrhq/webcmd@latest`) and retry.',
      { stdout_preview: res.stdout.slice(0, 200) });
  }
}

/**
 * ==========================================================================
 * THE LEARN-ONCE BRANCH POINT
 * ==========================================================================
 * True  -> a compiled command exists; run it instantly (no exploration).
 * False -> first contact with this portal; the agent must explore and author.
 */
export async function hasCompiledCommand(site: string, name?: string): Promise<boolean> {
  const commands = await listCommands();
  return commands.some((c) =>
    c.site === site && (name ? c.name === name : true));
}

export async function getCompiledCommands(site: string): Promise<WebcmdCommand[]> {
  const commands = await listCommands();
  return commands.filter((c) => c.site === site);
}

/**
 * Execute a compiled adapter command and parse its structured output.
 * RULE 4: one polite delay per site, and NO retry loop here — a single
 * deliberate re-attempt is the caller's decision, capped by POLITENESS.
 */
export async function execAdapter<T = unknown>(
  site: string,
  name: string,
  args: string[] = [],
  options: { format?: 'json' | 'md' | 'table'; profile?: string; session?: string; timeoutMs?: number } = {},
): Promise<T> {
  await politeDelay(site);

  const format = options.format ?? 'json';
  const argv: string[] = [];
  if (options.profile) argv.push('--profile', options.profile);
  if (options.session) argv.push('--session', options.session);
  argv.push(site, name, ...args, '-f', format);

  log.debug('adapter.exec', `webcmd ${argv.join(' ')}`, { site, name });

  const res = await runWebcmd(argv, options.timeoutMs);

  if (res.code === 124) {
    throw new ApplyOnceError('TIMEOUT',
      `\`webcmd ${site} ${name}\` timed out.`,
      'The portal was slow or is showing a challenge. Open it in your browser, then retry once.',
      { site, name });
  }

  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).trim().slice(0, 500);
    if (/login|auth|sign in|unauthor/i.test(detail)) {
      throw new ApplyOnceError('LOGIN_REQUIRED',
        `${site} requires a logged-in session: ${detail}`,
        `Run \`webcmd ${site} ...\` once in your browser profile and log in, then retry.`,
        { site, name });
    }
    throw new ApplyOnceError('ADAPTER_FAILED',
      `\`webcmd ${site} ${name}\` failed (exit ${res.code}): ${detail}`,
      'If this repeats, the portal layout may have changed — the adapter will attempt its fallback paths.',
      { site, name, exit_code: res.code });
  }

  if (format !== 'json') return res.stdout as unknown as T;

  try {
    return JSON.parse(res.stdout) as T;
  } catch {
    throw new ApplyOnceError('ADAPTER_FAILED',
      `\`webcmd ${site} ${name}\` did not return valid JSON.`,
      'The adapter may have printed a human-readable message. Re-run with -f md to inspect it.',
      { site, name, stdout_preview: res.stdout.slice(0, 200) });
  }
}

/** Profiles are webcmd's cookie jars — RULE 2: we reuse the user's own login. */
export async function listProfiles(): Promise<Array<Record<string, unknown>>> {
  const res = await runWebcmd(['profile', 'list', '-f', 'json'], 20_000);
  if (res.code !== 0) return [];
  try {
    const parsed = JSON.parse(res.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
