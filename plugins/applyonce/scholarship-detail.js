/**
 * Buddy4Study scholarship detail — READ-ONLY (HARD RULE 3).
 * Supplies the eligibility prose that check_eligibility reasons over,
 * plus the deadline used by track_deadlines.
 */

import { cli, Strategy } from '@agentrhq/webcmd/registry';
import { CommandExecutionError } from '@agentrhq/webcmd/errors';
import { assertNoChallenge } from './utils.js';

const ORIGIN = 'https://www.buddy4study.com';

cli({
  site: 'scholarship',
  name: 'detail',
  tags: ['applyonce'],
  access: 'read',
  description: 'Read one scholarship: eligibility, award, deadline, documents required',
  domain: 'buddy4study.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'url', positional: true, required: true, help: 'Scholarship page URL or /page/... path' },
  ],
  columns: ['opportunity_id', 'title', 'award', 'deadline', 'eligibility',
    'documents_required', 'benefits', 'apply_url', 'url'],
  func: async (page, kwargs) => {
    const raw = String(kwargs.url ?? '').trim();
    if (!raw) throw new CommandExecutionError('url is required', 'Pass the scholarship page URL.');
    const url = raw.startsWith('http') ? raw : ORIGIN + (raw.startsWith('/') ? raw : '/' + raw);

    await page.goto(url, { waitUntil: 'load', settleMs: 2000 });
    await page.wait({ time: 3 });

    const data = await page.evaluate(`(() => {
      const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();

      const pick = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          const t = clean(el && el.textContent);
          if (t) return t;
        }
        return '';
      };

      /**
       * Scholarship pages are prose, so read a section by its HEADING text
       * rather than by class. Headings are far more stable than styling.
       */
      const sectionByHeading = (re, maxChars = 1500) => {
        const heads = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,strong,b'));
        for (const h of heads) {
          if (!re.test(clean(h.textContent))) continue;
          let node = h.parentElement && h.parentElement.tagName.match(/^H[1-6]$/) ? h.parentElement : h;
          let out = '';
          let sib = node.nextElementSibling;
          let hops = 0;
          while (sib && hops < 6) {
            if (/^H[1-6]$/.test(sib.tagName)) break;
            const t = clean(sib.textContent);
            if (t) out += (out ? ' ' : '') + t;
            if (out.length > maxChars) break;
            sib = sib.nextElementSibling; hops++;
          }
          if (out) return out.slice(0, maxChars);
        }
        return '';
      };

      const whole = clean((document.body || {}).innerText || '');
      const dateMatch = whole.match(/(?:Deadline|Last Date|Apply By)\\s*:?\\s*(\\d{1,2}\\s+\\w+\\s+\\d{4})/i);

      const applyLink = Array.from(document.querySelectorAll('a'))
        .find((a) => /apply\\s*now|apply\\s*online/i.test(clean(a.textContent)));

      return {
        title: pick(['h1', '[class*="scholarshipName"]', '[class*="schtitle"]']),
        award: sectionByHeading(/award|benefit|amount/i, 400)
          || pick(['[class*="rightAward"]', '[class*="awardCont"]']),
        deadline: dateMatch ? dateMatch[1] : pick(['[class*="calendarDate"]', '[class*="deadline"]']),
        eligibility: sectionByHeading(/eligibilit|who can apply/i, 1500),
        documents_required: sectionByHeading(/document/i, 1000),
        benefits: sectionByHeading(/benefit|award/i, 800),
        apply_url: applyLink ? applyLink.getAttribute('href') : null,
        challenge: clean(document.title) + ' ' + whole.slice(0, 300),
      };
    })()`);

    assertNoChallenge(data.challenge, 'Buddy4Study');

    if (!data.title) {
      throw new CommandExecutionError(
        'Could not read the scholarship page (no title found)',
        'Confirm the URL points at a scholarship detail page.',
      );
    }

    const slug = url.split('/').filter(Boolean).pop() || null;
    return [{
      opportunity_id: slug,
      title: data.title,
      award: data.award || null,
      deadline: data.deadline || null,
      eligibility: data.eligibility || null,
      documents_required: data.documents_required || null,
      benefits: data.benefits || null,
      apply_url: data.apply_url
        ? (data.apply_url.startsWith('http') ? data.apply_url : ORIGIN + data.apply_url)
        : null,
      url,
    }];
  },
});
