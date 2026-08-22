/**
 * Remote internship source — Internshala over plain HTTPS, no browser.
 *
 * VERIFIED 2026-08-22: Internshala's listing and detail pages are server-side
 * rendered. A bare GET returns the full card markup, so a cloud host with no
 * browser gets the same data the local adapter reads from a real DOM.
 */

import { fetchHtml } from './fetch.js';
import { webcmdFetch } from './webcmd-fetch.js';
import { parseInternshalaListing, parseInternshalaDetail,
  type ParsedInternship, type ParsedInternshipDetail } from './parse.js';
import { ApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';

const ORIGIN = 'https://internshala.com';

export function buildListingUrl(query: string, location = '', workFromHome = false): string {
  const slug = String(query).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts: string[] = [];
  if (workFromHome) parts.push('work-from-home');
  parts.push(`${slug || 'web-development'}-internship`);
  if (location && !workFromHome) {
    parts.push(`in-${location.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  return `${ORIGIN}/internships/${parts.join('-')}/`;
}

export async function searchInternships(options: {
  query: string; location?: string; workFromHome?: boolean; limit?: number;
}): Promise<{ rows: ParsedInternship[]; healedAt: number; url: string }> {
  const limit = Math.min(Math.max(options.limit ?? 15, 1), 40);
  const url = buildListingUrl(options.query, options.location, options.workFromHome);

  const { html } = await fetchHtml(url);
  const { rows, healedAt } = parseInternshalaListing(html);

  if (rows.length === 0) {
    throw new ApplyOnceError('OPPORTUNITY_NOT_FOUND',
      `No Internshala internships matched "${options.query}".`,
      'Try a broader keyword, or drop the location filter.', { url });
  }
  // SELF-HEAL SIGNAL: a non-zero strategy means the primary layout moved.
  if (healedAt > 0) {
    log.warn('selfheal.recovered',
      `Internshala listing matched fallback strategy #${healedAt}`, { url, strategy: healedAt });
  }
  return { rows: rows.slice(0, limit), healedAt, url };
}

export interface InternshipDetailWithProse extends ParsedInternshipDetail {
  /** Readability-extracted role description, courtesy of webcmd's web/fetch. */
  description: string | null;
  /** Which webcmd tier was needed: 'plain', or 'impit' if the site pushed back. */
  fetch_tier: string | null;
}

/**
 * Read one internship using BOTH paths, because each is better at a different job:
 *
 *   • raw HTML  -> structured fields that live in markup (stipend chip, the
 *                  APPLY BY heading/body pair, skill tabs, the company anchor)
 *   • webcmd    -> the role prose, readability-extracted with navigation,
 *                  ads and boilerplate stripped. That text is what eligibility
 *                  reasoning actually reads, and webcmd does it far better than
 *                  a regex over raw markup would.
 *
 * webcmd also reports the TIER it needed. `impit` means a plain request was
 * refused and webcmd escalated to a real browser fingerprint — signal we
 * surface rather than hide.
 */
export async function getInternship(url: string, traceId?: string): Promise<InternshipDetailWithProse> {
  const target = url.startsWith('http') ? url : `${ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;

  const [rawResult, webcmdResult] = await Promise.allSettled([
    fetchHtml(target),
    webcmdFetch(target, { maxChars: 8000, traceId }),
  ]);

  if (rawResult.status !== 'fulfilled') throw rawResult.reason;
  const detail = parseInternshalaDetail(rawResult.value.html, rawResult.value.finalUrl);

  if (!detail.title) {
    throw new ApplyOnceError('OPPORTUNITY_NOT_FOUND',
      `Could not read an internship at ${target}.`,
      'Confirm the URL points at an Internshala internship detail page.', { url: target });
  }

  const prose = webcmdResult.status === 'fulfilled' ? webcmdResult.value : null;
  if (webcmdResult.status === 'rejected') {
    log.warn('adapter.exec',
      `webcmd prose extraction failed, continuing with markup only: ${(webcmdResult.reason as Error).message}`,
      { url: target });
  }

  return {
    ...detail,
    description: prose?.content?.trim() || null,
    fetch_tier: prose?.tier ?? null,
  };
}
