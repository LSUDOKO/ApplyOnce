/**
 * Internshala internship detail — READ-ONLY (HARD RULE 3).
 * Supplies the criteria that check_eligibility reasons over, and the
 * "APPLY BY" date that track_deadlines reports.
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { assertNoChallenge } from './utils.js';

const ORIGIN = 'https://internshala.com';

cli({
  site: 'internshala',
  name: 'detail',
  tags: ['applyonce'],
  access: 'read',
  description: 'Read one Internshala internship: criteria, stipend, deadline, skills',
  domain: 'internshala.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', positional: true, required: true, help: 'Internship detail URL or /internship/detail/... path' },
  ],
  columns: ['opportunity_id', 'title', 'company', 'location', 'stipend', 'duration',
    'start_date', 'apply_by', 'openings', 'skills', 'who_can_apply', 'perks', 'url'],
  func: async (page, kwargs) => {
    const raw = String(kwargs.url ?? '').trim();
    if (!raw) throw new CommandExecutionError('url is required', 'Pass the internship detail URL.');
    const url = raw.startsWith('http') ? raw : ORIGIN + (raw.startsWith('/') ? raw : '/' + raw);

    await page.goto(url, { waitUntil: 'load', settleMs: 1500 });
    await page.wait({ time: 2 });

    const data = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

      // Internshala renders detail as heading/body pairs; read them as a map.
      const headings = Array.from(document.querySelectorAll('.internship_other_details_container .item_heading, .other_detail_item_row .item_heading, .item_heading'));
      const details = {};
      for (const h of headings) {
        const key = clean(h.textContent).toLowerCase();
        const body = h.parentElement && h.parentElement.querySelector('.item_body');
        if (key && body && !details[key]) details[key] = clean(body.textContent);
      }

      const textOf = (sels) => {
        for (const s of sels) {
          const el = document.querySelector(s);
          const t = clean(el && el.textContent);
          if (t) return t;
        }
        return '';
      };

      const sectionAfter = (headingRe) => {
        const nodes = Array.from(document.querySelectorAll('.section_heading, .heading_5_5, h3, h4'));
        for (const n of nodes) {
          if (headingRe.test(clean(n.textContent))) {
            const sib = n.nextElementSibling;
            if (sib) return clean(sib.textContent).slice(0, 1200);
          }
        }
        return '';
      };

      return {
        title: textOf(['.heading_4_5', '.profile_on_detail_page', '.profile', 'h1']),
        company: textOf(['.company_name a', '.heading_6.company_name', '.company_name']),
        location: textOf(['#location_names', '.location_link', '.locations']),
        stipend: textOf(['.stipend_container .stipend', '.stipend']),
        duration: details['duration'] || '',
        start_date: details['start date'] || '',
        apply_by: details['apply by'] || '',
        openings: details['openings'] || '',
        skills: Array.from(document.querySelectorAll('.round_tabs_container .round_tabs, .skills_container span'))
          .map((s) => clean(s.textContent)).filter(Boolean).slice(0, 25),
        who_can_apply: sectionAfter(/who can apply/i),
        perks: Array.from(document.querySelectorAll('.perks_container .round_tabs, .perks span'))
          .map((s) => clean(s.textContent)).filter(Boolean).slice(0, 15),
        already_applied: !!document.querySelector('.already_applied, #already_applied'),
        challenge: clean(document.title) + ' ' + clean((document.body || {}).innerText || '').slice(0, 300),
      };
    })()`);

    assertNoChallenge(data.challenge, 'Internshala');

    if (!data.title) {
      throw new CommandExecutionError(
        'Could not read the Internshala detail page (no title found)',
        'Confirm the URL is an internship detail page and that you are logged in.',
      );
    }

    const idMatch = url.match(/(\d{6,})\/?$/);
    return [{
      opportunity_id: idMatch ? idMatch[1] : null,
      title: data.title,
      company: data.company || null,
      location: data.location || null,
      stipend: data.stipend || null,
      duration: data.duration || null,
      start_date: data.start_date || null,
      apply_by: data.apply_by || null,
      openings: data.openings || null,
      skills: data.skills,
      who_can_apply: data.who_can_apply || null,
      perks: data.perks,
      already_applied: data.already_applied,
      url,
    }];
  },
});
