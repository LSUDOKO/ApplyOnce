/**
 * ============================================================================
 * Remote scholarship source — real data, no browser, no auth.
 * ============================================================================
 * VERIFIED 2026-08-22:
 *   • Buddy4Study's LISTING index is client-rendered: a server-side GET returns
 *     no scholarship cards, and their JSON API answers 401. We do not
 *     reverse-engineer that auth.
 *   • Their BRAND pages (/page/<slug>) ARE server-rendered, embedding a full
 *     `brandPage.scholarships[]` array in __NEXT_DATA__ with far richer fields
 *     than the HTML cards carry: ISO `deadline`, `eligibility`, `benefits`,
 *     `requiredDocument`, `applyLink`, `deadlineDateDiff`.
 *   • robots.txt allows these paths and publishes a sitemap, which is the
 *     site's own sanctioned discovery mechanism — so we enumerate slugs from
 *     the sitemap rather than guessing or crawling blindly.
 *
 * Result: real scholarships on a cloud host with no browser and no credentials.
 * ============================================================================
 */

import { fetchHtml } from './fetch.js';
import { clean } from './parse.js';
import { ApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';
import { POLITENESS } from '../safety.js';

const ORIGIN = 'https://www.buddy4study.com';

/**
 * Seed slugs verified to return data. Discovery from the sitemap extends this
 * at runtime; the seeds guarantee useful output even if a sitemap fetch fails.
 */
export const SEED_BRAND_SLUGS = [
  'reliance-foundation-scholarships',
  'kotak-kanya-scholarship',
  'colgate-keep-india-smiling-scholarship-program',
  'legrand-empowering-scholarship-program',
  'raman-kant-munjal-scholarships',
];

export interface RemoteScholarship {
  opportunity_id: string;
  title: string;
  award: string | null;
  eligibility: string | null;
  applicable_for: string | null;
  deadline: string | null;
  deadline_iso: string | null;
  days_to_go: number | null;
  benefits: string | null;
  documents_required: string | null;
  how_to_apply: string | null;
  apply_link: string | null;
  offered_by: string | null;
  url: string;
}

/** Pull __NEXT_DATA__ out of a server-rendered Next.js page. */
function extractNextData(html: string): unknown | null {
  const start = html.indexOf('__NEXT_DATA__');
  if (start < 0) return null;
  const open = html.indexOf('>', start);
  const close = html.indexOf('</script>', open);
  if (open < 0 || close < 0) return null;
  try {
    return JSON.parse(html.slice(open + 1, close));
  } catch {
    return null;
  }
}

/** Buddy4Study wraps HTML inside its text fields; flatten to readable prose. */
function prose(value: unknown, max = 1200): string | null {
  const text = clean(String(value ?? ''));
  if (!text || text === 'N/A') return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toLocalIsoDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface RawScholarship {
  scholarshipId?: number; title?: string; slug?: string; deadline?: string;
  purposeAward?: string; eligibility?: string; applicableFor?: string;
  benefits?: string; requiredDocument?: string; howToApply?: string;
  applyLink?: string; offeredBy?: string; deadlineDateDiff?: number;
}

/** Read one brand page and return every scholarship it lists. */
export async function fetchBrandPage(slug: string): Promise<RemoteScholarship[]> {
  const url = `${ORIGIN}/page/${slug}`;
  const { html } = await fetchHtml(url);
  const data = extractNextData(html) as
    { props?: { pageProps?: { scholarship?: { brandPage?: { scholarships?: RawScholarship[] } } } } } | null;

  const items = data?.props?.pageProps?.scholarship?.brandPage?.scholarships ?? [];
  const rows: RemoteScholarship[] = [];

  for (const item of items) {
    const title = prose(item.title, 200);
    if (!title) continue;

    let deadlineIso: string | null = null;
    let daysToGo: number | null = typeof item.deadlineDateDiff === 'number' ? item.deadlineDateDiff : null;
    if (item.deadline) {
      const parsed = Date.parse(item.deadline);
      if (!Number.isNaN(parsed)) {
        deadlineIso = toLocalIsoDate(parsed);
        if (daysToGo === null) daysToGo = Math.round((parsed - Date.now()) / 86_400_000);
      }
    }

    rows.push({
      opportunity_id: item.slug ?? String(item.scholarshipId ?? title.toLowerCase().replace(/[^a-z0-9]+/g, '-')),
      title,
      award: prose(item.purposeAward, 200),
      eligibility: prose(item.eligibility, 1500),
      applicable_for: prose(item.applicableFor, 200),
      deadline: deadlineIso,
      deadline_iso: deadlineIso,
      days_to_go: daysToGo,
      benefits: prose(item.benefits, 800),
      documents_required: prose(item.requiredDocument, 800),
      how_to_apply: prose(item.howToApply, 600),
      apply_link: item.applyLink ?? null,
      offered_by: prose(item.offeredBy, 120),
      url: item.slug ? `${ORIGIN}/scholarship/${item.slug}` : url,
    });
  }
  return rows;
}

/** Cached slug discovery — the sitemap is stable, so we read it at most hourly. */
let slugCache: { at: number; slugs: string[] } | null = null;
const SLUG_TTL_MS = 60 * 60 * 1000;

/**
 * Enumerate candidate brand slugs from the published sitemap (robots.txt points
 * at it, so this is the site's own intended discovery path).
 */
export async function discoverBrandSlugs(limit = 40): Promise<string[]> {
  if (slugCache && Date.now() - slugCache.at < SLUG_TTL_MS) return slugCache.slugs.slice(0, limit);

  const found = new Set<string>(SEED_BRAND_SLUGS);
  try {
    for (const shard of [1, 2]) {
      const { html } = await fetchHtml(`${ORIGIN}/sitemap${shard}.xml`, 15_000);
      for (const m of html.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const brand = /\/page\/([a-z0-9-]+)/i.exec(m[1]);
        if (brand) found.add(brand[1]);
        const scholarship = /\/scholarship\/([a-z0-9-]+)$/i.exec(m[1]);
        if (scholarship) found.add(scholarship[1]);
      }
      if (found.size > 200) break;
    }
  } catch (err) {
    log.warn('adapter.exec', `sitemap discovery failed, using seed slugs: ${(err as Error).message}`);
  }

  const slugs = [...found];
  slugCache = { at: Date.now(), slugs };
  return slugs.slice(0, limit);
}

/**
 * Fetch scholarships across several brand pages concurrently.
 * Concurrency is capped (RULE 4) so we never burst a site.
 */
export async function searchScholarships(options: {
  limit?: number;
  query?: string;
  discover?: boolean;
  /** Include past editions whose deadline has already passed. Default false. */
  includeClosed?: boolean;
} = {}): Promise<{ rows: RemoteScholarship[]; pagesRead: number; skippedClosed: number; source: string }> {
  const limit = Math.min(Math.max(options.limit ?? 15, 1), 60);
  const query = String(options.query ?? '').trim().toLowerCase();

  const slugs = options.discover === false
    ? SEED_BRAND_SLUGS
    : await discoverBrandSlugs(24);

  const rows: RemoteScholarship[] = [];
  const seen = new Set<string>();
  let pagesRead = 0;

  // Small batches, sequential between batches — polite by construction.
  const BATCH = 4;
  for (let i = 0; i < slugs.length && rows.length < limit * 6; i += BATCH) {
    const batch = slugs.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map((s) => fetchBrandPage(s)));
    pagesRead += batch.length;

    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      for (const row of result.value) {
        if (seen.has(row.opportunity_id)) continue;
        seen.add(row.opportunity_id);
        rows.push(row);
      }
    }
    if (i + BATCH < slugs.length) {
      await new Promise((r) => setTimeout(r, POLITENESS.minDelayMs));
    }
  }

  const matchesQuery = (r: RemoteScholarship) => !query
    || r.title.toLowerCase().includes(query)
    || (r.eligibility ?? '').toLowerCase().includes(query)
    || (r.applicable_for ?? '').toLowerCase().includes(query);

  /**
   * Brand pages list EVERY past edition of a programme (Legrand 2018-19,
   * Kotak Kanya 2021, …). A student cannot apply to a closed scholarship, so
   * default to those still open. `includeClosed` keeps them available for
   * research without ever putting an expired row at the top of a result set.
   */
  const isOpen = (r: RemoteScholarship) => r.days_to_go === null || r.days_to_go >= 0;

  const matching = rows.filter(matchesQuery);
  const open = matching.filter(isOpen);
  const closed = matching.filter((r) => !isOpen(r));
  const chosen = options.includeClosed ? matching : open;

  if (chosen.length === 0) {
    throw new ApplyOnceError('OPPORTUNITY_NOT_FOUND',
      query
        ? `No open scholarships matched "${query}" (${closed.length} closed edition(s) were skipped).`
        : `No open scholarships found (${closed.length} closed edition(s) were skipped).`,
      'Try a broader query, or pass include_closed to see past editions too.');
  }

  // Soonest deadline first; undated last.
  chosen.sort((a, b) => {
    if (a.deadline_iso && b.deadline_iso) return a.deadline_iso.localeCompare(b.deadline_iso);
    if (a.deadline_iso) return -1;
    if (b.deadline_iso) return 1;
    return 0;
  });

  return {
    rows: chosen.slice(0, limit),
    pagesRead,
    skippedClosed: options.includeClosed ? 0 : closed.length,
    source: 'buddy4study brand pages (server-rendered)',
  };
}

/** One scholarship by slug — searches the brand pages for a matching id. */
export async function getScholarship(idOrUrl: string): Promise<RemoteScholarship> {
  const slug = idOrUrl.includes('/')
    ? idOrUrl.split('/').filter(Boolean).pop()!
    : idOrUrl;

  // A brand page directly named by this slug is the cheapest hit.
  try {
    const direct = await fetchBrandPage(slug);
    const exact = direct.find((r) => r.opportunity_id === slug);
    if (exact) return exact;
    if (direct.length > 0) return direct[0];
  } catch { /* fall through to a wider search */ }

  const { rows } = await searchScholarships({ limit: 60 });
  const match = rows.find((r) => r.opportunity_id === slug || r.url.endsWith(slug));
  if (!match) {
    throw new ApplyOnceError('OPPORTUNITY_NOT_FOUND',
      `No scholarship found for "${idOrUrl}".`,
      'Run find_opportunities first and use an opportunity_id from those results.');
  }
  return match;
}
