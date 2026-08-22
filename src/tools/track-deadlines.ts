/**
 * track_deadlines — READ-ONLY (HARD RULE 3).
 * Aggregates close dates across the learned portals and sorts by urgency,
 * so a student does not lose an opportunity to a lapsed date.
 */

import { findOpportunities } from './find-opportunities.js';
import { log } from '../logging/logger.js';

export interface TrackDeadlinesInput {
  within_days?: number;
  portal?: 'internshala' | 'scholarship' | 'all';
  query?: string;
  category?: string;
  limit?: number;
  profile_path?: string;
  session?: string;
}

export interface DeadlineRow {
  opportunity_id: string;
  portal: string;
  kind: string;
  title: string;
  deadline: string | null;
  deadline_iso: string | null;
  days_remaining: number | null;
  urgency: 'closed' | 'critical' | 'soon' | 'upcoming' | 'unknown';
  value: string | null;
  url: string | null;
}

/**
 * Format a timestamp as a YYYY-MM-DD calendar date in LOCAL time.
 *
 * `new Date(ts).toISOString()` converts to UTC first, which in IST (UTC+5:30)
 * shifts a local midnight BACK one day — "5 October 2026" became 2026-10-04.
 * Deadlines are calendar dates, not instants, so we read the local components.
 */
export function toLocalIsoDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse the date shapes Indian portals actually emit. */
export function parseDeadline(raw: string | null, iso: string | null): string | null {
  if (iso) return iso;
  const value = String(raw ?? '').trim();
  if (!value) return null;

  // Internshala: "5 Sep' 26"
  const shortYear = value.match(/^(\d{1,2})\s+(\w{3,})'?\s*(\d{2})$/);
  if (shortYear) {
    const parsed = Date.parse(`${shortYear[1]} ${shortYear[2]} 20${shortYear[3]}`);
    if (!Number.isNaN(parsed)) return toLocalIsoDate(parsed);
  }
  // "5 October 2026"
  const full = Date.parse(value);
  if (!Number.isNaN(full)) return toLocalIsoDate(full);
  return null;
}

export function classifyUrgency(days: number | null): DeadlineRow['urgency'] {
  if (days === null) return 'unknown';
  if (days < 0) return 'closed';
  if (days <= 3) return 'critical';
  if (days <= 14) return 'soon';
  return 'upcoming';
}

export async function trackDeadlines(input: TrackDeadlinesInput = {}) {
  const withinDays = Math.max(Number(input.within_days) || 60, 1);

  const found = await findOpportunities({
    query: input.query,
    portal: input.portal ?? 'all',
    category: input.category,
    limit: input.limit ?? 15,
    profile_path: input.profile_path,
    session: input.session,
  });

  const rows: DeadlineRow[] = [];
  for (const o of found.opportunities) {
    const iso = parseDeadline(o.deadline, o.deadline_iso);
    const days = iso === null ? o.days_to_go
      : Math.round((Date.parse(iso) - Date.now()) / 86_400_000);

    rows.push({
      opportunity_id: o.opportunity_id,
      portal: o.portal,
      kind: o.kind,
      title: o.title,
      deadline: o.deadline,
      deadline_iso: iso,
      days_remaining: days,
      urgency: classifyUrgency(days),
      value: o.value,
      url: o.url,
    });
  }

  const withDates = rows.filter((r) => r.days_remaining !== null);
  const upcoming = withDates
    .filter((r) => r.days_remaining! >= 0 && r.days_remaining! <= withinDays)
    .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0));
  const closed = withDates.filter((r) => (r.days_remaining ?? 0) < 0);
  const unknown = rows.filter((r) => r.days_remaining === null);

  log.info('tool.end',
    `track_deadlines: ${upcoming.length} upcoming within ${withinDays} days (${upcoming.filter((r) => r.urgency === 'critical').length} critical)`,
    { within_days: withinDays, upcoming: upcoming.length });

  return {
    ok: true as const,
    within_days: withinDays,
    counts: {
      upcoming: upcoming.length,
      critical: upcoming.filter((r) => r.urgency === 'critical').length,
      soon: upcoming.filter((r) => r.urgency === 'soon').length,
      closed: closed.length,
      unknown_deadline: unknown.length,
    },
    upcoming,
    closed,
    unknown_deadline: unknown,
    errors: found.errors,
    note: 'Read-only. Sorted by days remaining, soonest first.',
  };
}
