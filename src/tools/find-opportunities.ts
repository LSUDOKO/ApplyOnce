/**
 * find_opportunities — READ-ONLY discovery (HARD RULE 3).
 * Searches the compiled portal adapters and returns structured rows.
 * It never applies to anything.
 */

import { loadProfile } from '../profile/loader.js';
import { execAdapter, hasCompiledCommand } from '../webcmd/bridge.js';
import { log, RunTracker } from '../logging/logger.js';
import { ApplyOnceError } from '../errors.js';

export interface FindOpportunitiesInput {
  query?: string;
  portal?: 'internshala' | 'scholarship' | 'all';
  location?: string;
  category?: string;
  limit?: number;
  profile_path?: string;
  session?: string;
}

export interface Opportunity {
  opportunity_id: string;
  portal: string;
  kind: 'internship' | 'scholarship';
  title: string;
  organisation: string | null;
  location: string | null;
  value: string | null;
  deadline: string | null;
  deadline_iso: string | null;
  days_to_go: number | null;
  eligibility: string | null;
  url: string | null;
}

export async function findOpportunities(input: FindOpportunitiesInput = {}) {
  const portal = input.portal ?? 'all';
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 40);
  const { profile } = loadProfile(input.profile_path);

  // Fall back to the student's own stated preferences when no query is given.
  const query = String(input.query ?? '').trim()
    || profile.preferences?.job_titles?.[0]
    || 'web development';
  const location = String(input.location ?? '').trim()
    || profile.preferences?.locations?.find((l) => l.toLowerCase() !== 'remote')
    || '';

  const wanted: Array<'internshala' | 'scholarship'> =
    portal === 'all' ? ['internshala', 'scholarship'] : [portal];

  const opportunities: Opportunity[] = [];
  const errors: Array<{ portal: string; code: string; message: string; recovery_hint: string }> = [];
  const learnOnce: Array<{ portal: string; mode: string; steps: number; duration_ms: number }> = [];

  for (const site of wanted) {
    const compiled = await hasCompiledCommand(site, 'search');
    if (!compiled) {
      errors.push({
        portal: site, code: 'ADAPTER_NOT_FOUND',
        message: `No compiled search command for "${site}".`,
        recovery_hint: 'Run `npm run adapters:install`, then `webcmd list -f json`.',
      });
      continue;
    }

    const tracker = new RunTracker('reuse', site);
    try {
      if (site === 'internshala') {
        tracker.step(`execute compiled command: webcmd internshala search "${query}"`);
        const args = [query, '--limit', String(limit)];
        if (location) args.push('--location', location);
        const rows = await execAdapter<Array<Record<string, unknown>>>(site, 'search', args,
          { session: input.session, timeoutMs: 240_000 });

        for (const r of rows ?? []) {
          opportunities.push({
            opportunity_id: String(r.opportunity_id ?? ''),
            portal: site,
            kind: 'internship',
            title: String(r.title ?? ''),
            organisation: (r.company as string) ?? null,
            location: (r.location as string) ?? null,
            value: (r.stipend as string) ?? null,
            deadline: (r.apply_by as string) ?? null,
            deadline_iso: null,
            days_to_go: null,
            eligibility: null,
            url: (r.url as string) ?? null,
          });
        }
      } else {
        tracker.step('execute compiled command: webcmd scholarship search');
        const args: string[] = [];
        if (input.category) args.push(String(input.category));
        args.push('--limit', String(limit));
        const rows = await execAdapter<Array<Record<string, unknown>>>(site, 'search', args,
          { session: input.session, timeoutMs: 280_000 });

        for (const r of rows ?? []) {
          opportunities.push({
            opportunity_id: String(r.opportunity_id ?? ''),
            portal: site,
            kind: 'scholarship',
            title: String(r.title ?? ''),
            organisation: null,
            location: null,
            value: (r.award as string) ?? null,
            deadline: (r.deadline as string) ?? null,
            deadline_iso: (r.deadline_iso as string) ?? null,
            days_to_go: (r.days_to_go as number) ?? null,
            eligibility: (r.eligibility as string) ?? null,
            url: (r.url as string) ?? null,
          });
        }
      }
      const m = tracker.finish();
      learnOnce.push({ portal: site, mode: m.mode, steps: m.steps, duration_ms: m.durationMs });
    } catch (err) {
      const e = err instanceof ApplyOnceError ? err : new ApplyOnceError('ADAPTER_FAILED', String(err));
      errors.push({ portal: site, code: e.code, message: e.message, recovery_hint: e.recoveryHint });
    }
  }

  log.info('tool.end', `find_opportunities returned ${opportunities.length} rows`, {
    portals: wanted, count: opportunities.length, errors: errors.length,
  });

  if (opportunities.length === 0 && errors.length > 0) {
    throw new ApplyOnceError('ADAPTER_FAILED',
      `Every portal search failed: ${errors.map((e) => `${e.portal}: ${e.message}`).join('; ')}`,
      errors[0]?.recovery_hint ?? 'Check `webcmd doctor` and retry.');
  }

  return {
    ok: true as const,
    query,
    portals_searched: wanted,
    count: opportunities.length,
    opportunities,
    errors,
    learn_once: learnOnce,
    note: 'Read-only discovery. No application was started. Use check_eligibility next, then fill_application.',
  };
}
