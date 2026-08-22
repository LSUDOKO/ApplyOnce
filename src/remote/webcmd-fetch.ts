/**
 * ============================================================================
 * webcmd IN THE REMOTE PATH
 * ============================================================================
 * The local server drives webcmd's browser. A cloud host has no browser — but
 * webcmd's `web fetch` command is explicitly BROWSERLESS. Its manifest says:
 *
 *     "description": "Fetch a URL with local HTTP clients. Use after a blocked,
 *                     403, or Cloudflare response; never opens a browser."
 *     "browser": false,  "clientOwned": true,
 *     "packageExport": "./fetch/command"
 *
 * So the remote server imports that exact command and calls its `func()`
 * directly — the same code path `webcmd web fetch` runs on the CLI, minus the
 * process spawn. That is a real dependency on webcmd, not a reimplementation.
 *
 * WHAT WEBCMD GIVES US THAT PLAIN fetch() DOES NOT:
 *   • TIER ESCALATION — a plain request first; if the site blocks it, webcmd
 *     retries through `impit` with a real Chrome/Firefox TLS + header
 *     fingerprint. The returned `tier` tells us which was needed.
 *   • SSRF-SAFE PROXY — requests are routed through webcmd's safe proxy, which
 *     refuses private and loopback destinations unless explicitly allowed.
 *   • READABILITY EXTRACTION — clean prose with the boilerplate stripped,
 *     which is exactly what eligibility reasoning wants to read.
 *
 * WHERE WE STILL USE RAW HTML: webcmd's fetch always returns EXTRACTED text,
 * and card-level scraping needs the markup (class names, ids, data attributes).
 * So structured listing parsing uses a raw fetch, and everything prose-shaped —
 * eligibility criteria, scheme detail — goes through webcmd. Each tool is used
 * for what it is actually good at.
 * ============================================================================
 */

import { ApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';
import { detectAntiBot } from '../safety.js';

export interface WebcmdFetchResult {
  status: number;
  requestedUrl: string;
  finalUrl: string;
  contentType: string;
  /** 'plain' = a normal request worked. 'impit' = webcmd escalated to a browser fingerprint. */
  tier: 'plain' | 'impit';
  profile?: 'chrome' | 'firefox';
  title: string;
  extractionSource: string;
  truncated: boolean;
  content: string;
}

interface WebcmdCliCommand {
  site: string;
  name: string;
  browser: boolean;
  access: string;
  func: (kwargs: Record<string, unknown>) => Promise<unknown>;
}

let cachedCommand: WebcmdCliCommand | null = null;

/**
 * Load webcmd's own `web fetch` command object.
 * Cached because the dynamic import resolves the package once.
 */
export async function loadWebcmdFetch(): Promise<WebcmdCliCommand> {
  if (cachedCommand) return cachedCommand;
  try {
    const mod = await import('@agentrhq/webcmd/fetch/command') as { webFetchCommand: WebcmdCliCommand };
    if (!mod.webFetchCommand?.func) {
      throw new Error('webFetchCommand.func missing from @agentrhq/webcmd/fetch/command');
    }
    cachedCommand = mod.webFetchCommand;
    log.debug('adapter.exec', 'loaded webcmd web/fetch command', {
      site: cachedCommand.site, name: cachedCommand.name, browser: cachedCommand.browser,
    });
    return cachedCommand;
  } catch (err) {
    throw new ApplyOnceError('WEBCMD_UNAVAILABLE',
      `Could not load webcmd's web fetch command: ${(err as Error).message}`,
      'Ensure @agentrhq/webcmd is installed (it is a dependency of this server).');
  }
}

/** True when webcmd's browserless fetch is usable in this process. */
export async function webcmdAvailable(): Promise<boolean> {
  try { await loadWebcmdFetch(); return true; } catch { return false; }
}

/**
 * Fetch a page THROUGH WEBCMD. Returns readability-extracted prose plus the
 * tier webcmd needed — which is itself useful signal: `impit` means the site
 * refused a plain request and webcmd had to impersonate a browser.
 */
export async function webcmdFetch(url: string, options: {
  timeoutSeconds?: number; maxChars?: number;
} = {}): Promise<WebcmdFetchResult> {
  const command = await loadWebcmdFetch();
  const startedAt = Date.now();

  let rows: unknown;
  try {
    rows = await command.func({
      url,
      timeout: options.timeoutSeconds ?? 30,
      'max-chars': options.maxChars ?? 0,          // 0 = no truncation
      'allow-private': false,                      // never reach private hosts
    });
  } catch (err) {
    const message = (err as Error).message ?? String(err);
    if (/403|blocked|forbidden|challenge/i.test(message)) {
      throw new ApplyOnceError('ANTI_BOT_DETECTED',
        `${new URL(url).host} refused the request via webcmd: ${message}`,
        'ApplyOnce stops rather than evading. Use the local server, which uses your own browser session.',
        { url });
    }
    throw new ApplyOnceError('ADAPTER_FAILED',
      `webcmd web fetch failed for ${url}: ${message}`,
      'Retry once; if it persists the portal may be down.', { url });
  }

  const result = (Array.isArray(rows) ? rows[0] : rows) as WebcmdFetchResult | undefined;
  if (!result || typeof result.content !== 'string') {
    throw new ApplyOnceError('ADAPTER_FAILED',
      `webcmd web fetch returned no content for ${url}.`,
      'Retry once; the portal may have returned an empty body.', { url });
  }

  // RULE 4 — a challenge page is a stop signal, not a retry signal.
  const marker = detectAntiBot(`${result.title}\n${result.content.slice(0, 4000)}`);
  if (marker) {
    throw new ApplyOnceError('ANTI_BOT_DETECTED',
      `${new URL(url).host} served a challenge page (matched "${marker}").`,
      'ApplyOnce will not attempt to evade anti-bot protection.', { url, marker });
  }

  log.debug('adapter.exec',
    `webcmd fetched ${new URL(url).host} via tier=${result.tier}${result.profile ? `/${result.profile}` : ''}`,
    { url, tier: result.tier, ms: Date.now() - startedAt, chars: result.content.length });

  // Surface the escalation: it means the site pushed back on a plain request.
  if (result.tier === 'impit') {
    log.info('selfheal.recovered',
      `webcmd escalated to a ${result.profile ?? 'browser'} fingerprint for ${new URL(url).host} — a plain request was refused`,
      { url, tier: result.tier, profile: result.profile });
  }

  return result;
}
