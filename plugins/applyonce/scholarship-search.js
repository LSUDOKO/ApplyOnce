/**
 * Buddy4Study scholarship search — READ-ONLY discovery (HARD RULE 3).
 *
 * SELF-HEALING NOTE (this is the interesting part):
 * Buddy4Study is a Next.js app using CSS-module class names with a build hash,
 * e.g. `Listing_scholarshipName__b3ok_`. That hash CHANGES ON EVERY DEPLOY, so
 * a literal selector would break roughly weekly. We therefore target the stable
 * prefix with an attribute-substring selector:
 *
 *     [class*="Listing_scholarshipName"]        <- survives the hash change
 *     .Listing_scholarshipName__b3ok_           <- would break on next deploy
 *
 * Each field also carries an ordered fallback list, so if the prefix itself is
 * renamed we degrade to a text/structure heuristic instead of returning null.
 * Verified against the live site on 2026-08-22 (261 live scholarships).
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { EmptyResultError, CommandExecutionError } from '@agentrhq/webcmd/errors';
import { assertNoChallenge, requireBoundedInt } from './utils.js';

const ORIGIN = 'https://www.buddy4study.com';

export const SCHOLARSHIP_COLUMNS = [
  'opportunity_id', 'title', 'award', 'eligibility',
  'deadline', 'deadline_iso', 'days_to_go', 'category', 'url',
];

cli({
  site: 'scholarship',
  name: 'search',
  tags: ['search', 'applyonce'],
  access: 'read',
  description: 'Search Indian scholarships by category (read-only discovery)',
  domain: 'buddy4study.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'category', positional: true, required: false, default: '',
      help: 'Category slug: girls | sc-st-obc | engineering | minority | college-students (blank = all)' },
    { name: 'limit', type: 'int', default: 15, help: 'Max rows (1-40)' },
    { name: 'scroll-passes', type: 'int', default: 3, help: 'Lazy-load scroll passes (1-6)' },
  ],
  columns: SCHOLARSHIP_COLUMNS,
  func: async (page, kwargs) => {
    const limit = requireBoundedInt(kwargs.limit, 15, 40, 'limit');
    const passes = requireBoundedInt(kwargs['scroll-passes'], 3, 6, 'scroll-passes');
    const category = String(kwargs.category ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    const url = category ? `${ORIGIN}/scholarships/${category}` : `${ORIGIN}/scholarships`;
    await page.goto(url, { waitUntil: 'load', settleMs: 2000 });
    await page.wait({ time: 3 });

    // Cards lazy-load: scroll a bounded number of times (HARD RULE 4: no hammering).
    for (let i = 0; i < passes; i++) {
      await page.evaluate('window.scrollBy(0, document.body.scrollHeight)');
      await page.wait({ time: 2 });
    }

    const payload = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

      // SELF-HEAL: ordered container strategies. Index 0 is the current layout;
      // anything later means the site changed and we recovered.
      // NOTE (verified 2026-08-22): "Listing_categoriesCard" is the OUTER grid
      // wrapper (exactly 1 node holding ~108 results), while
      // "Listing_categoriesBox" is the per-scholarship card. Targeting the
      // wrapper yields a single row, so the box is the primary strategy.
      const containerStrategies = [
        '[class*="Listing_categoriesBox"]',
        '[class*="categoriesBox"]',
        '[class*="scholarshipCard"]',
        '[class*="Listing_categoriesPart"]',
        'article',
      ];
      let cards = [];
      let usedStrategy = null;
      for (let i = 0; i < containerStrategies.length; i++) {
        const found = document.querySelectorAll(containerStrategies[i]);
        // A container strategy that matches exactly one node on a listing page
        // is almost certainly a wrapper, not a card; keep looking.
        if (found.length > 1) { cards = Array.from(found); usedStrategy = i; break; }
      }

      const pick = (root, selectors) => {
        for (const sel of selectors) {
          const el = root.querySelector(sel);
          const t = clean(el && el.textContent);
          if (t) return t;
        }
        return '';
      };

      const slugify = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

      const rows = cards.map((c) => {
        const title = pick(c, ['[class*="scholarshipName"]', 'h2', 'h3', '[class*="schtitle"]']);
        if (!title) return null;

        /**
         * VERIFIED 2026-08-22: the card carries several "awardCont" blocks -
         * the first is the award, a later one is the eligibility line. Read
         * them positionally by their "Award"/"Eligibility" prefix instead of
         * assuming a dedicated eligibility class exists (it does not).
         */
        const awardBlocks = Array.from(c.querySelectorAll('[class*="awardCont"], [class*="rightAward"]'))
          .map((e) => clean(e.textContent)).filter(Boolean);
        const award = (awardBlocks.find((t) => /^Award\\b/i.test(t)) || awardBlocks[0] || '')
          .replace(/^Award\\s*/i, '');
        const eligibility = (awardBlocks.find((t) => /^Eligibility\\b/i.test(t)) || '')
          .replace(/^Eligibility\\s*/i, '');

        /**
         * "daystoGo" holds EITHER an absolute date ("Deadline 5 October 2026")
         * OR a relative countdown ("9 days to go") — never both. Parse both
         * shapes from this card only, so one card cannot leak into another.
         */
        const deadlineRaw = pick(c, ['[class*="calendarDate"]', '[class*="daystoGo"]', '[class*="categoriesName"]']);
        const href = (c.querySelector('a') || {}).getAttribute ? c.querySelector('a').getAttribute('href') : null;
        const daysMatch = deadlineRaw.match(/(\\d+)\\s*days?\\s*to\\s*go/i);
        const dateMatch = deadlineRaw.match(/(\\d{1,2}\\s+\\w+\\s+\\d{4})/);

        return {
          opportunity_id: href ? slugify(href.split('/').filter(Boolean).pop()) : slugify(title),
          title,
          award: award || null,
          eligibility: eligibility || null,
          deadline: dateMatch ? dateMatch[1] : null,
          days_to_go: daysMatch ? Number(daysMatch[1]) : null,
          href,
        };
      }).filter(Boolean);

      return {
        rows, usedStrategy,
        challenge: clean(document.title) + ' ' + clean((document.body || {}).innerText || '').slice(0, 300),
      };
    })()`);

    assertNoChallenge(payload.challenge, 'Buddy4Study');

    if (payload.usedStrategy === null || payload.rows.length === 0) {
      throw new EmptyResultError('scholarship search',
        `No scholarships found${category ? ` in category "${category}"` : ''}`);
    }
    // SELF-HEAL SIGNAL — surfaced so the MCP layer can report the recovery.
    if (payload.usedStrategy > 0) {
      process.stderr.write(`[applyonce] self-heal: scholarship listing matched fallback strategy #${payload.usedStrategy}\n`);
    }

    const seen = new Set();
    return payload.rows
      .filter((r) => { if (seen.has(r.opportunity_id)) return false; seen.add(r.opportunity_id); return true; })
      .slice(0, limit)
      .map((r) => {
        /**
         * The site gives EITHER an absolute date OR a countdown. track_deadlines
         * needs one comparable field, so derive whichever half is missing and
         * expose a normalised ISO date alongside the raw display values.
         */
        // Calendar dates, not instants: read LOCAL components. toISOString()
        // would shift a local midnight back a day in IST (UTC+5:30).
        const toLocalIso = (ts) => {
          const d = new Date(ts);
          const pad = (n) => String(n).padStart(2, '0');
          return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        };
        let deadlineIso = null;
        let daysToGo = r.days_to_go;

        if (r.deadline) {
          const parsed = Date.parse(r.deadline);
          if (!Number.isNaN(parsed)) {
            deadlineIso = toLocalIso(parsed);
            if (daysToGo === null) {
              daysToGo = Math.max(0, Math.round((parsed - Date.now()) / 86400000));
            }
          }
        } else if (typeof daysToGo === 'number') {
          deadlineIso = toLocalIso(Date.now() + daysToGo * 86400000);
        }

        return {
          opportunity_id: r.opportunity_id,
          title: r.title,
          award: r.award,
          eligibility: r.eligibility,
          deadline: r.deadline || (deadlineIso ? `on or before ${deadlineIso}` : null),
          deadline_iso: deadlineIso,
          days_to_go: daysToGo,
          category: category || 'all',
          url: r.href ? (r.href.startsWith('http') ? r.href : ORIGIN + r.href) : null,
        };
      });
  },
});
