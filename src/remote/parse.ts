/**
 * ============================================================================
 * Server-side HTML parsing — same data, no browser.
 * ============================================================================
 * These parsers mirror what the webcmd adapters extract in a real DOM, but run
 * against raw HTML so they work on a cloud host.
 *
 * SELF-HEALING applies here too: every field is read through an ORDERED list of
 * patterns. When a pattern beyond index 0 matches, that is reported as a heal
 * so a layout change is visible instead of silently returning nulls.
 * ============================================================================
 */

/** Strip tags, decode the entities that actually appear, collapse whitespace. */
export function clean(html: string): string {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&rupee;|&#8377;/gi, '₹')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Try each pattern in order; return the first capture plus which index won. */
export function firstMatch(html: string, patterns: RegExp[]): { value: string; index: number } {
  for (let i = 0; i < patterns.length; i++) {
    const m = patterns[i].exec(html);
    if (m && m[1]) {
      const value = clean(m[1]);
      if (value) return { value, index: i };
    }
  }
  return { value: '', index: -1 };
}

export interface ParsedInternship {
  opportunity_id: string;
  title: string;
  company: string | null;
  location: string | null;
  stipend: string | null;
  duration: string | null;
  posted: string | null;
  url: string | null;
}

/**
 * Split the listing page into per-card HTML slices.
 * VERIFIED 2026-08-22 against the server-rendered page: each card opens with
 * `class="container-fluid individual_internship ..."` and carries
 * `internshipId="<digits>"` (note the capital I) plus a `data-href`.
 */
export function parseInternshalaListing(html: string): { rows: ParsedInternship[]; healedAt: number } {
  const containerPatterns = [
    /class="[^"]*individual_internship[^"]*"/gi,
    /internshipId\s*=\s*["']?\d+/gi,
  ];

  let starts: number[] = [];
  let healedAt = -1;
  for (let i = 0; i < containerPatterns.length; i++) {
    const re = new RegExp(containerPatterns[i].source, 'gi');
    const found: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) found.push(m.index);
    if (found.length > 0) { starts = found; healedAt = i; break; }
  }
  if (starts.length === 0) return { rows: [], healedAt: -1 };

  /**
   * VERIFIED 2026-08-22: the class marker appears TWICE per card (the listing
   * page emits 100 markers for 50 internships). Slicing naively between
   * consecutive markers cuts each card in half and loses the stipend/duration/
   * location chips, so anchor each card on its unique internshipId instead and
   * extend the slice to the NEXT DISTINCT id.
   */
  const anchors: Array<{ pos: number; id: string }> = [];
  const seenAnchor = new Set<string>();
  for (const pos of starts) {
    const window = html.slice(pos, pos + 600);
    const idMatch = /internshipId\s*=\s*["']?(\d+)/i.exec(window)
      ?? /id=["']individual_internship_(\d+)["']/i.exec(window);
    if (!idMatch) continue;
    if (seenAnchor.has(idMatch[1])) continue;
    seenAnchor.add(idMatch[1]);
    anchors.push({ pos, id: idMatch[1] });
  }
  if (anchors.length === 0) return { rows: [], healedAt: -1 };

  const rows: ParsedInternship[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < anchors.length; i++) {
    const from = Math.max(0, anchors[i].pos - 400);
    const to = i + 1 < anchors.length
      ? anchors[i + 1].pos
      : Math.min(html.length, anchors[i].pos + 8000);
    const card = html.slice(from, to);

    const id = firstMatch(card, [
      /internshipId\s*=\s*["']?(\d+)/i,
      /id=["']individual_internship_(\d+)["']/i,
    ]).value;
    if (!id || seen.has(id)) continue;

    const title = firstMatch(card, [
      /class="job-title-href"[^>]*>([^<]+)</i,
      /class="job-internship-name"[^>]*>[\s\S]{0,200}?>([^<]+)</i,
      /<h2[^>]*>[\s\S]{0,200}?>([^<]+)</i,
    ]).value;
    if (!title) continue;

    seen.add(id);

    const company = firstMatch(card, [
      /class="company-name"[^>]*>([^<]+)</i,
      /class="[^"]*company_name[^"]*"[^>]*>[\s\S]{0,200}?>([^<]+)</i,
    ]).value;

    const href = firstMatch(card, [
      /data-href=['"]([^'"]+)['"]/i,
      /class="job-title-href"[^>]*href="([^"]+)"/i,
    ]).value;

    /**
     * Detail chips. VERIFIED 2026-08-22: the markup nests the value one level
     * down, e.g. `<div class="row-1-item"><i …></i><span>3 Months</span></div>`,
     * so we must capture the whole block and strip tags — capturing the div's
     * immediate content yields only the icon element.
     * Classify by content: a stipend string also contains "/month".
     */
    const chips = [...card.matchAll(/class="[^"]*row-1-item[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/gi)]
      .map((m) => clean(m[1])).filter(Boolean);

    const stipend = chips.find((c) => /₹|rs\.?\s*\d|unpaid/i.test(c)) ?? null;
    const duration = chips.find((c) => c !== stipend && /^\d+\s*(month|week|year)/i.test(c)) ?? null;
    const location = chips.find((c) => c !== stipend && c !== duration && !/^\d/.test(c)) ?? null;
    const posted = firstMatch(card, [/class="[^"]*status-(?:success|inactive)[^"]*"[^>]*>([^<]+)</i]).value;

    rows.push({
      opportunity_id: id,
      title,
      company: company || null,
      location,
      stipend,
      duration,
      posted: posted || null,
      url: href ? (href.startsWith('http') ? href : `https://internshala.com${href}`) : null,
    });
  }

  return { rows, healedAt };
}

export interface ParsedInternshipDetail {
  opportunity_id: string | null;
  title: string;
  company: string | null;
  location: string | null;
  stipend: string | null;
  duration: string | null;
  start_date: string | null;
  apply_by: string | null;
  skills: string[];
  who_can_apply: string | null;
  url: string;
}

export function parseInternshalaDetail(rawHtml: string, url: string): ParsedInternshipDetail {
  // Internshala emits &nbsp; inside headings and bodies ("Start&nbsp;Date",
  // "Starts&nbsp;immediately"), which silently breaks a \s-based label match.
  // Normalise the entity to a real space once, up front.
  const html = rawHtml.replace(/&nbsp;|&#160;|\u00a0/gi, ' ');

  const title = firstMatch(html, [
    /class="[^"]*heading_4_5[^"]*"[^>]*>([^<]+)</i,
    /<h1[^>]*>([^<]+)</i,
    /<title>([^<|]+)/i,
  ]).value;

  /**
   * VERIFIED 2026-08-22: the detail page nests the company inside an anchor —
   * `<div class="heading_6 company_name"><div …><a …> Synergy Labs </a>`.
   * Capture the whole block and strip tags rather than guessing a nesting depth.
   */
  const company = firstMatch(html, [
    /class="[^"]*company_name[^"]*"[^>]*>([\s\S]{0,400}?)<\/div>/i,
    /class="company-name"[^>]*>([^<]+)</i,
  ]).value;

  /**
   * Detail pages render heading/body pairs. VERIFIED: the heading wraps its
   * label in an icon + span — `<div class="item_heading"><i …></i><span> Start
   * Date </span></div>` — so allow markup between the class and the label, and
   * capture the body block whole so nested tags are stripped by clean().
   */
  const pair = (label: RegExp): string => {
    /**
     * VERIFIED: the heading nests an icon and a span, so a lazy match up to
     * `</div>` stops at the INNER closing tag and never reaches the label.
     * Anchor on the label text itself, then take the next item_body block.
     * The body may also contain nested spans, so capture generously and let
     * clean() strip tags.
     */
    const re = new RegExp(
      `item_heading[\\s\\S]{0,200}?${label.source}[\\s\\S]{0,400}?item_body[^>]*>([\\s\\S]{0,400}?)<\\/div>`,
      'i');
    return firstMatch(html, [re]).value;
  };

  const skills = [...html.matchAll(/class="[^"]*round_tabs[^"]*"[^>]*>([^<]{1,40})</gi)]
    .map((m) => clean(m[1])).filter(Boolean).slice(0, 25);

  const whoCanApply = firstMatch(html, [
    /Who can apply[\s\S]{0,200}?<div[^>]*>([\s\S]{0,1200}?)<\/div>/i,
    /class="[^"]*who_can_apply[^"]*"[^>]*>([\s\S]{0,1200}?)<\/div>/i,
  ]).value;

  const idMatch = /(\d{6,})\/?(?:\?|$)/.exec(url);

  return {
    opportunity_id: idMatch ? idMatch[1] : null,
    title,
    company: company || null,
    // Each of these nests an icon + span (+ anchor), so capture the block and
    // let clean() strip the markup rather than matching immediate text.
    location: firstMatch(html, [
      /id="location_names"[^>]*>([\s\S]{0,400}?)<\/div>/i,
      /class="[^"]*location_link[^"]*"[^>]*>([\s\S]{0,200}?)</i,
    ]).value || null,
    stipend: firstMatch(html, [
      /class="[^"]*stipend_container[^"]*"[\s\S]{0,300}?class="[^"]*item_body[^"]*"[^>]*>([\s\S]{0,200}?)<\/div>/i,
      /class="[^"]*stipend[^"]*"[^>]*>([\s\S]{0,120}?)</i,
    ]).value || null,
    duration: pair(/Duration/) || null,
    // "Starts immediately" renders twice (mobile + desktop spans); dedupe it.
    start_date: (pair(/Start Date/) || '')
      .replace(/Starts\s*immediately\s*Immediately/i, 'Immediately') || null,
    apply_by: pair(/APPLY BY/i) || null,
    skills,
    who_can_apply: whoCanApply || null,
    url,
  };
}

export interface ParsedScholarship {
  opportunity_id: string;
  title: string;
  award: string | null;
  eligibility: string | null;
  deadline: string | null;
  deadline_iso: string | null;
  days_to_go: number | null;
  url: string | null;
}

/** Local calendar date — toISOString() would shift a local midnight in IST. */
export function toLocalIsoDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseScholarshipListing(html: string): { rows: ParsedScholarship[]; healedAt: number } {
  // Next.js CSS-module classes carry a per-deploy hash, so match the PREFIX.
  const containerPatterns = [
    /class="[^"]*Listing_categoriesBox[^"]*"/gi,
    /class="[^"]*categoriesBox[^"]*"/gi,
    /class="[^"]*scholarshipCard[^"]*"/gi,
  ];

  let starts: number[] = [];
  let healedAt = -1;
  for (let i = 0; i < containerPatterns.length; i++) {
    const re = new RegExp(containerPatterns[i].source, 'gi');
    const found: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) found.push(m.index);
    if (found.length > 1) { starts = found; healedAt = i; break; }
  }
  if (starts.length === 0) return { rows: [], healedAt: -1 };

  const rows: ParsedScholarship[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < starts.length; i++) {
    const to = i + 1 < starts.length ? starts[i + 1] : Math.min(html.length, starts[i] + 5000);
    const card = html.slice(starts[i], to);

    const title = firstMatch(card, [
      /class="[^"]*scholarshipName[^"]*"[^>]*>([\s\S]{0,180}?)</i,
      /<h2[^>]*>([\s\S]{0,180}?)</i,
    ]).value;
    if (!title) continue;

    const href = firstMatch(card, [/<a[^>]*href="([^"]+)"/i]).value;
    const slug = href
      ? href.split('/').filter(Boolean).pop()!.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)
      : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
    if (seen.has(slug)) continue;
    seen.add(slug);

    // Several award blocks: one prefixed "Award", a later one "Eligibility".
    const blocks = [...card.matchAll(/class="[^"]*(?:awardCont|rightAward)[^"]*"[^>]*>([\s\S]{0,300}?)<\/div>/gi)]
      .map((m) => clean(m[1])).filter(Boolean);
    const award = (blocks.find((b) => /^Award\b/i.test(b)) ?? blocks[0] ?? '').replace(/^Award\s*/i, '');
    const eligibility = (blocks.find((b) => /^Eligibility\b/i.test(b)) ?? '').replace(/^Eligibility\s*/i, '');

    // daystoGo holds EITHER an absolute date OR a countdown, never both.
    const dl = firstMatch(card, [
      /class="[^"]*(?:calendarDate|daystoGo|categoriesName)[^"]*"[^>]*>([\s\S]{0,160}?)<\/div>/i,
    ]).value;
    const days = /(\d+)\s*days?\s*to\s*go/i.exec(dl);
    const date = /(\d{1,2}\s+\w+\s+\d{4})/.exec(dl);

    let deadlineIso: string | null = null;
    let daysToGo: number | null = days ? Number(days[1]) : null;
    if (date) {
      const parsed = Date.parse(date[1]);
      if (!Number.isNaN(parsed)) {
        deadlineIso = toLocalIsoDate(parsed);
        if (daysToGo === null) daysToGo = Math.max(0, Math.round((parsed - Date.now()) / 86_400_000));
      }
    } else if (daysToGo !== null) {
      deadlineIso = toLocalIsoDate(Date.now() + daysToGo * 86_400_000);
    }

    rows.push({
      opportunity_id: slug,
      title,
      award: award || null,
      eligibility: eligibility || null,
      deadline: date ? date[1] : (deadlineIso ? `on or before ${deadlineIso}` : null),
      deadline_iso: deadlineIso,
      days_to_go: daysToGo,
      url: href ? (href.startsWith('http') ? href : `https://www.buddy4study.com${href}`) : null,
    });
  }

  return { rows, healedAt };
}
