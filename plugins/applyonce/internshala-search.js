/**
 * Internshala internship search — READ-ONLY discovery (HARD RULE 3).
 *
 * Selectors verified against the live site on 2026-08-22:
 *   .individual_internship[internshipid]  — one card per listing
 *   .job-internship-name                  — role title
 *   .company-name                         — company
 *   .row-1-item span                      — location / stipend / duration
 *
 * Each is wrapped in a fallback chain so a reskin degrades instead of breaking.
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { assertNoChallenge, requireBoundedInt } from './utils.js';

const ORIGIN = 'https://internshala.com';

export const SEARCH_COLUMNS = [
  'opportunity_id', 'title', 'company', 'location', 'stipend',
  'duration', 'posted', 'apply_by', 'url',
];

/** Build the listing URL from a keyword + filters. */
function buildUrl({ query, location, workFromHome }) {
  const slug = String(query).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const parts = [];
  if (workFromHome) parts.push('work-from-home');
  parts.push(`${slug}-internship`);
  if (location && !workFromHome) parts.push(`in-${String(location).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  return `${ORIGIN}/internships/${parts.join('-')}/`;
}

cli({
  site: 'internshala',
  name: 'search',
  tags: ['search', 'applyonce'],
  access: 'read',                       // HARD RULE 3: discovery never writes
  description: 'Search Internshala internships (read-only discovery)',
  domain: 'internshala.com',
  strategy: Strategy.COOKIE,            // HARD RULE 2: reuse the user's own session
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Keyword, e.g. "web development"' },
    { name: 'location', type: 'string', default: '', help: 'City filter, e.g. "bangalore"' },
    { name: 'work-from-home', type: 'boolean', default: false, help: 'Only work-from-home internships' },
    { name: 'limit', type: 'int', default: 15, help: 'Max rows (1-40)' },
  ],
  columns: SEARCH_COLUMNS,
  func: async (page, kwargs) => {
    const query = String(kwargs.query ?? '').trim();
    if (!query) throw new CommandExecutionError('query is required', 'Pass a keyword, e.g. "web development".');
    const limit = requireBoundedInt(kwargs.limit, 15, 40, 'limit');

    const url = buildUrl({
      query,
      location: kwargs.location,
      workFromHome: kwargs['work-from-home'],
    });

    await page.goto(url, { waitUntil: 'load', settleMs: 1500 });
    await page.wait({ time: 2 });

    const payload = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

      // SELF-HEAL: ordered container strategies, newest layout first.
      const containerStrategies = ['.individual_internship', '[internshipid]', '.internship_meta'];
      let cards = [];
      let usedStrategy = null;
      for (let i = 0; i < containerStrategies.length; i++) {
        const found = document.querySelectorAll(containerStrategies[i]);
        if (found.length) { cards = Array.from(found); usedStrategy = i; break; }
      }

      const pick = (root, selectors) => {
        for (const sel of selectors) {
          const el = root.querySelector(sel);
          const text = clean(el && el.textContent);
          if (text) return text;
        }
        return '';
      };

      const rows = cards.map((c) => {
        const details = Array.from(c.querySelectorAll('.row-1-item span, .detail-row-1 span, .item_body'))
          .map((s) => clean(s.textContent)).filter(Boolean);
        // Order matters: a stipend string also contains "/month", so classify
        // stipend FIRST and exclude it before looking for the duration.
        const stipend = details.find((d) => /₹|rs\\.?\\s*\\d|unpaid/i.test(d)) || '';
        const duration = details.find((d) => d !== stipend && /^\\d+\\s*(month|week|year)/i.test(d)) || '';
        const location = details.find((d) => d !== stipend && d !== duration) || '';
        const href = (c.querySelector('a.job-title-href, a.view_detail_button, a') || {}).getAttribute
          ? c.querySelector('a.job-title-href, a.view_detail_button, a').getAttribute('href') : null;

        return {
          opportunity_id: c.getAttribute('internshipid') || null,
          title: pick(c, ['.job-internship-name', 'h3', '.heading_4_5', '.profile']),
          company: pick(c, ['.company-name', '.company_name', 'p.company-name', '.heading_6']).split('Actively hiring')[0].trim(),
          location,
          stipend,
          duration,
          posted: pick(c, ['.status-success', '.status-inactive', '.posted_by_container']),
          href,
        };
      }).filter((r) => r.opportunity_id && r.title);

      return {
        rows,
        usedStrategy,
        challenge: clean(document.title) + ' ' + clean((document.body || {}).innerText || '').slice(0, 300),
      };
    })()`);

    assertNoChallenge(payload.challenge, 'Internshala');

    if (payload.usedStrategy === null || payload.rows.length === 0) {
      throw new EmptyResultError('internshala search', `No Internshala internships matched "${query}"`);
    }
    // SELF-HEAL SIGNAL: a non-zero strategy index means the primary layout moved.
    if (payload.usedStrategy > 0) {
      process.stderr.write(`[applyonce] self-heal: Internshala listing matched fallback strategy #${payload.usedStrategy}\n`);
    }

    return payload.rows.slice(0, limit).map((r) => ({
      opportunity_id: r.opportunity_id,
      title: r.title,
      company: r.company,
      location: r.location || null,
      stipend: r.stipend || null,
      duration: r.duration || null,
      posted: r.posted || null,
      apply_by: null,                     // present only on the detail page
      url: r.href ? (r.href.startsWith('http') ? r.href : ORIGIN + r.href) : null,
    }));
  },
});
