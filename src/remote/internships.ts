/**
 * Remote internship source — Internshala over plain HTTPS, no browser.
 *
 * VERIFIED 2026-08-22: Internshala's listing and detail pages are server-side
 * rendered. A bare GET returns the full card markup, so a cloud host with no
 * browser gets the same data the local adapter reads from a real DOM.
 */

import { fetchHtml } from './fetch.js';
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

export async function getInternship(url: string): Promise<ParsedInternshipDetail> {
  const target = url.startsWith('http') ? url : `${ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
  const { html, finalUrl } = await fetchHtml(target);
  const detail = parseInternshalaDetail(html, finalUrl);

  if (!detail.title) {
    throw new ApplyOnceError('OPPORTUNITY_NOT_FOUND',
      `Could not read an internship at ${target}.`,
      'Confirm the URL points at an Internshala internship detail page.', { url: target });
  }
  return detail;
}
