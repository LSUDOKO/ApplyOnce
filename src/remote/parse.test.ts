/**
 * Parser regression tests built from the REAL markup Internshala and
 * Buddy4Study served on 2026-08-22. Each fixture below reproduces a nesting
 * quirk that actually broke the parser during development, so a future edit
 * cannot silently reintroduce the bug.
 */
import { describe, it, expect } from 'vitest';
import {
  clean, firstMatch, parseInternshalaListing, parseInternshalaDetail,
  parseScholarshipListing, toLocalIsoDate,
} from './parse.js';

describe('clean', () => {
  it('strips tags, decodes entities and collapses whitespace', () => {
    expect(clean('<div>  Hello   &amp;  <b>World</b> </div>')).toBe('Hello & World');
    expect(clean('&rupee; 10,000 /month')).toBe('₹ 10,000 /month');
    expect(clean('<script>evil()</script>ok')).toBe('ok');
  });
  it('survives nullish input', () => {
    expect(clean(undefined as unknown as string)).toBe('');
  });
});

describe('firstMatch — the self-healing primitive', () => {
  it('reports which strategy won so a heal is visible', () => {
    const html = '<span class="b">value</span>';
    const r = firstMatch(html, [/class="a"[^>]*>([^<]+)</i, /class="b"[^>]*>([^<]+)</i]);
    expect(r.value).toBe('value');
    expect(r.index).toBe(1);            // fallback won => healed
  });
  it('returns index -1 when nothing matches', () => {
    expect(firstMatch('<p>x</p>', [/class="z"[^>]*>([^<]+)</i]).index).toBe(-1);
  });
});

describe('parseInternshalaListing', () => {
  /** The class marker appears TWICE per card on the real page. */
  const card = (id: string, title: string, company: string, stipend: string, duration: string, loc: string) => `
    <div class="container-fluid individual_internship visibilityTrackerItem"
         id="individual_internship_${id}" internshipId="${id}"
         data-href='/internship/detail/${title.toLowerCase().replace(/ /g, '-')}-at-x${id}'>
      <div class="individual_internship">
        <h2 class="job-internship-name"><a class="job-title-href" href="/x">${title}</a></h2>
        <div class="heading_6 company_name"><p class="company-name"> ${company} </p></div>
        <div class="row-1-item locations"><i class="ic-16-map-pin"></i><span><a>${loc}</a></span></div>
        <div class="row-1-item"><i class="ic-16-money"></i><span class='stipend'>${stipend}</span></div>
        <div class="row-1-item"><i class="ic-16-calendar"></i><span>${duration}</span></div>
      </div>
    </div>`;

  const html = card('111', 'Front End Development', 'Synergy Labs', '₹ 10,000 - 15,000 /month', '6 Months', 'Panipat')
    + card('222', 'Java Development', 'Gateway Software', '₹ 3,500 /month', '3 Months', 'Chennai');

  it('finds one row per internship despite the duplicated class marker', () => {
    const { rows } = parseInternshalaListing(html);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.opportunity_id)).toEqual(['111', '222']);
  });

  it('extracts chips from their NESTED spans, not the icon element', () => {
    const { rows } = parseInternshalaListing(html);
    expect(rows[0].stipend).toBe('₹ 10,000 - 15,000 /month');
    expect(rows[0].duration).toBe('6 Months');
    expect(rows[0].location).toBe('Panipat');
  });

  it('does not mistake a stipend for a duration (both contain "/month")', () => {
    const { rows } = parseInternshalaListing(html);
    expect(rows[0].duration).not.toContain('₹');
  });

  it('reads title, company and an absolute url', () => {
    const { rows } = parseInternshalaListing(html);
    expect(rows[0].title).toBe('Front End Development');
    expect(rows[0].company).toBe('Synergy Labs');
    expect(rows[0].url).toMatch(/^https:\/\/internshala\.com\//);
  });

  it('returns nothing rather than guessing on unrelated html', () => {
    const { rows, healedAt } = parseInternshalaListing('<html><body>no internships</body></html>');
    expect(rows).toHaveLength(0);
    expect(healedAt).toBe(-1);
  });
});

describe('parseInternshalaDetail', () => {
  // Reproduces the three nesting quirks that broke extraction:
  // company inside an <a>, headings wrapping labels in an icon+span, and &nbsp;.
  const html = `
    <div class="heading_4_5">Front End Development</div>
    <div class="heading_6 company_name"><div class="company_and_premium">
      <a class="link_display_like_text" href="/company/x"> Synergy Labs </a></div></div>
    <div id="location_names"><i class="ic-16-map-pin"></i><span><a>Panipat</a></span></div>
    <div class="other_detail_item stipend_container">
      <div class="item_heading"><i class="ic-16-money"></i><span> Stipend </span></div>
      <div class="item_body"><span class="stipend">₹ 10,000 - 15,000 /month</span></div></div>
    <div class="other_detail_item">
      <div class="item_heading"><i class="ic"></i><span> Start&nbsp;Date </span></div>
      <div class="item_body" id="start-date-first"><span>Starts&nbsp;immediately</span><span>Immediately</span></div></div>
    <div class="other_detail_item">
      <div class="item_heading"><i class="ic"></i><span> Duration </span></div>
      <div class="item_body">6 Months</div></div>
    <div class="other_detail_item">
      <div class="item_heading"><i class="ic"></i><span> APPLY BY </span></div>
      <div class="item_body">5 Sep' 26</div></div>
    <div class="round_tabs">React</div><div class="round_tabs">Node.js</div>`;

  const d = parseInternshalaDetail(html, 'https://internshala.com/internship/detail/x1786004884');

  it('reads a company nested inside an anchor', () => {
    expect(d.company).toBe('Synergy Labs');
  });
  it('reads heading/body pairs whose label is wrapped in an icon and a span', () => {
    expect(d.duration).toBe('6 Months');
    expect(d.apply_by).toBe("5 Sep' 26");
    expect(d.stipend).toContain('10,000');
  });
  it('handles &nbsp; inside a heading label', () => {
    expect(d.start_date).toBeTruthy();
  });
  it('deduplicates the mobile/desktop "starts immediately" pair', () => {
    expect(d.start_date).toBe('Immediately');
  });
  it('extracts location and skills', () => {
    expect(d.location).toBe('Panipat');
    expect(d.skills).toEqual(['React', 'Node.js']);
  });
  it('derives the opportunity id from the url', () => {
    expect(d.opportunity_id).toBe('1786004884');
  });
});

describe('parseScholarshipListing', () => {
  const card = (name: string, award: string, elig: string, when: string) => `
    <div class="Listing_categoriesBox__CiGvQ">
      <div class="Listing_daystoGo__x">${when}</div>
      <h2 class="Listing_scholarshipName__b3ok_">${name}</h2>
      <div class="Listing_awardCont__a">Award ${award}</div>
      <div class="Listing_awardCont__a">Eligibility ${elig}</div>
      <a href="/page/${name.toLowerCase().replace(/ /g, '-')}">more</a>
    </div>`;
  const html = card('Alpha Scholarship', 'INR 50,000', 'For UG students', 'Deadline 5 October 2026')
    + card('Beta Scholarship', 'INR 1 lakh', 'For girls', '9 days to go');

  it('matches the hashed CSS-module class by its stable PREFIX', () => {
    const { rows, healedAt } = parseScholarshipListing(html);
    expect(rows).toHaveLength(2);
    expect(healedAt).toBe(0);
  });

  it('separates award from eligibility across repeated award blocks', () => {
    const { rows } = parseScholarshipListing(html);
    expect(rows[0].award).toBe('INR 50,000');
    expect(rows[0].eligibility).toBe('For UG students');
  });

  it('handles BOTH deadline shapes: absolute date and relative countdown', () => {
    const { rows } = parseScholarshipListing(html);
    expect(rows[0].deadline_iso).toBe('2026-10-05');
    expect(rows[1].days_to_go).toBe(9);
    expect(rows[1].deadline_iso).toBeTruthy();     // derived from the countdown
  });
});

describe('toLocalIsoDate', () => {
  it('formats from LOCAL components so IST cannot shift the day back', () => {
    const noon = new Date(2026, 9, 5, 12, 0, 0).getTime();
    expect(toLocalIsoDate(noon)).toBe('2026-10-05');
    const midnight = new Date(2026, 9, 5, 0, 0, 0).getTime();
    expect(toLocalIsoDate(midnight)).toBe('2026-10-05');
  });
});
