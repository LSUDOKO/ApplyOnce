/**
 * ============================================================================
 * Browserless HTTP fetch — the cloud execution path.
 * ============================================================================
 * The local MCP server drives a real browser through webcmd. A cloud host has
 * no browser and no display, so the remote server fetches server-rendered HTML
 * over plain HTTPS instead.
 *
 * VERIFIED 2026-08-22: Internshala's listing and detail pages are server-side
 * rendered — a bare HTTPS GET returns 525 KB of HTML containing every card with
 * `internshipId`, `job-internship-name`, `company-name` and `data-href`. No
 * JavaScript execution is required for discovery.
 *
 * HARD RULE 4 still applies here: one request per call, a real timeout, a
 * single bounded retry, and an explicit stop on any anti-bot response.
 * ============================================================================
 */

import { ApplyOnceError } from '../errors.js';
import { detectAntiBot, POLITENESS } from '../safety.js';
import { log } from '../logging/logger.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_BYTES = 4_000_000;

/** A browser-like UA. We identify honestly as a normal client, we do not spoof a session. */
const HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-IN,en;q=0.9',
  'cache-control': 'no-cache',
};

/** Per-host politeness clock (RULE 4). */
const lastRequestAt = new Map<string, number>();

async function polite(host: string): Promise<void> {
  const previous = lastRequestAt.get(host);
  if (previous) {
    const wait = POLITENESS.minDelayMs - (Date.now() - previous);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  lastRequestAt.set(host, Date.now());
}

export interface FetchResult {
  html: string;
  status: number;
  finalUrl: string;
  durationMs: number;
}

/**
 * GET a page as HTML. Throws a machine-readable ApplyOnceError on failure.
 * One retry maximum, only for a transient network error or 5xx — never for a
 * 403/429, which we treat as the site asking us to stop.
 */
export async function fetchHtml(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<FetchResult> {
  const target = new URL(url);
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new ApplyOnceError('INVALID_INPUT', `Refusing to fetch a non-HTTP URL: ${url}`,
      'Pass an http(s) URL.');
  }
  await polite(target.host);

  const startedAt = Date.now();
  let lastError = '';

  for (let attempt = 1; attempt <= POLITENESS.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target.href, {
        headers: HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timer);

      // RULE 4: these mean "stop", not "try harder".
      if (response.status === 403 || response.status === 429) {
        throw new ApplyOnceError('ANTI_BOT_DETECTED',
          `${target.host} responded ${response.status} — the site is refusing automated requests.`,
          'ApplyOnce will not retry or evade this. Try the local server, which uses your own browser session.',
          { host: target.host, status: response.status });
      }

      if (response.status >= 500 && attempt < POLITENESS.maxAttempts) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      if (!response.ok) {
        throw new ApplyOnceError('ADAPTER_FAILED',
          `${target.host} responded ${response.status}.`,
          'Check the URL is still valid; the page may have moved.',
          { host: target.host, status: response.status });
      }

      // Bound the read so a huge page cannot exhaust the dyno.
      const raw = await response.text();
      const html = raw.length > MAX_BYTES ? raw.slice(0, MAX_BYTES) : raw;

      // RULE 4: a challenge page is a stop signal even behind a 200.
      const marker = detectAntiBot(html.slice(0, 4000));
      if (marker) {
        throw new ApplyOnceError('ANTI_BOT_DETECTED',
          `${target.host} served a challenge page (matched "${marker}").`,
          'ApplyOnce stops rather than evading anti-bot protection. Use the local server for this portal.',
          { host: target.host, marker });
      }

      const result: FetchResult = {
        html,
        status: response.status,
        finalUrl: response.url || target.href,
        durationMs: Date.now() - startedAt,
      };
      log.debug('adapter.exec', `fetched ${target.host}${target.pathname} (${html.length} bytes)`,
        { host: target.host, status: response.status, ms: result.durationMs });
      return result;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApplyOnceError) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      if ((err as Error).name === 'AbortError') {
        if (attempt >= POLITENESS.maxAttempts) {
          throw new ApplyOnceError('TIMEOUT', `${target.host} did not respond within ${timeoutMs}ms.`,
            'The portal is slow right now. Retry in a moment.', { host: target.host });
        }
      }
    }
  }

  throw new ApplyOnceError('ADAPTER_FAILED',
    `Could not fetch ${target.href}: ${lastError}`,
    'Check connectivity and that the portal is reachable.', { host: target.host });
}
