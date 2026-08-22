#!/usr/bin/env node
/**
 * ============================================================================
 * ApplyOnce REMOTE MCP server — the one Claude web connects to.
 * ============================================================================
 * The local server (src/mcp/server.ts) speaks stdio and drives a real browser
 * through webcmd. A cloud host has neither a browser nor the student's disk,
 * so this server:
 *
 *   • speaks Streamable HTTP (what Claude web's Connect requires)
 *   • fetches server-rendered HTML over plain HTTPS — no browser at all
 *   • is READ-ONLY end to end: it cannot fill a form, because filling needs
 *     the user's own logged-in browser and their local documents. Asking for
 *     it returns an honest, machine-readable error pointing at the local
 *     server — never a fake success.
 *
 * SAFETY: every hard rule still applies. Nothing here submits or pays (there is
 * no write path at all), anti-bot responses stop the run, and no personal data
 * is stored server-side — the remote server never sees a student profile.
 * ============================================================================
 */

import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

import { searchInternships, getInternship } from './internships.js';
import { searchScholarships, getScholarship } from './scholarships.js';
import { evaluateCriteria } from '../tools/check-eligibility.js';
import { ApplyOnceError, toApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';
import type { StudentProfile } from '../profile/loader.js';

const PORT = Number(process.env.PORT ?? 8080);
/** Shared secret. Set APPLYONCE_TOKEN in the host's environment. */
const TOKEN = process.env.APPLYONCE_TOKEN ?? '';
const VERSION = '1.0.0';

/* ------------------------------------------------------------------ *
 * A caller-supplied profile. The remote server NEVER persists this —
 * it lives only for the duration of one tool call. RULE 5.
 * ------------------------------------------------------------------ */
const ProfileInput = z.object({
  category: z.string().optional(),
  gender: z.string().optional(),
  annual_income: z.number().optional(),
  score_percent: z.number().optional(),
  level: z.string().optional(),
  skills: z.array(z.string()).optional(),
  work_mode: z.array(z.string()).optional(),
  duration_months: z.number().optional(),
  available_from: z.string().optional(),
}).optional();

type ProfileInputType = z.infer<typeof ProfileInput>;

/** Adapt the small remote profile to the shape evaluateCriteria expects. */
function toStudentProfile(p: ProfileInputType): StudentProfile {
  return {
    schema_version: '1.0.0',
    personal: {
      name: { full: 'Applicant' },
      dob: '2000-01-01',
      gender: p?.gender ?? 'prefer_not_to_say',
      category: p?.category ?? 'general',
      email: 'applicant@example.com',
      phone: '0000000000',
      address: { line1: '-', district: '-', state: '-', pincode: '000000' },
    },
    academic: {
      qualifications: [{
        level: p?.level ?? 'undergraduate',
        institution: '-',
        year_of_passing: new Date().getFullYear(),
        score_type: 'percentage',
        score: p?.score_percent ?? 0,
        score_max: 100,
        currently_enrolled: true,
      }],
    },
    family: p?.annual_income !== undefined ? { annual_income: p.annual_income } : {},
    skills: p?.skills ?? [],
    documents: {},
    preferences: {
      work_mode: (p?.work_mode ?? []) as string[],
      duration_months: p?.duration_months,
      available_from: p?.available_from,
    },
  } as StudentProfile;
}

const ok = (payload: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
});
const fail = (err: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(toApplyOnceError(err).toJSON(), null, 2) }],
  isError: true,
});

/** Build a fresh MCP server per session (the SDK requires one per transport). */
function buildServer(): McpServer {
  const server = new McpServer({ name: 'applyonce', version: VERSION });

  server.registerTool('find_opportunities', {
    title: 'Find opportunities',
    description:
      'READ-ONLY. Search live Indian internship and scholarship listings. Returns structured rows with deadlines, stipend/award and eligibility. Applies to nothing.',
    inputSchema: {
      query: z.string().optional().describe('Keyword, e.g. "web development". Defaults to web development.'),
      portal: z.enum(['internshala', 'scholarship', 'all']).optional(),
      location: z.string().optional().describe('City filter for internships, e.g. "bangalore".'),
      work_from_home: z.boolean().optional(),
      limit: z.number().optional().describe('Max rows per portal (1-40).'),
    },
  }, async ({ query, portal, location, work_from_home, limit }) => {
    try {
      const want = portal ?? 'all';
      const cap = Math.min(Math.max(limit ?? 10, 1), 40);
      const opportunities: unknown[] = [];
      const errors: unknown[] = [];

      if (want === 'internshala' || want === 'all') {
        try {
          const r = await searchInternships({
            query: query ?? 'web development', location, workFromHome: work_from_home, limit: cap,
          });
          opportunities.push(...r.rows.map((o) => ({ ...o, portal: 'internshala', kind: 'internship' })));
        } catch (e) {
          const err = toApplyOnceError(e);
          errors.push({ portal: 'internshala', ...err.toJSON().error });
        }
      }
      if (want === 'scholarship' || want === 'all') {
        try {
          const r = await searchScholarships({ limit: cap, query });
          opportunities.push(...r.rows.map((o) => ({ ...o, portal: 'scholarship', kind: 'scholarship' })));
        } catch (e) {
          const err = toApplyOnceError(e);
          errors.push({ portal: 'scholarship', ...err.toJSON().error });
        }
      }
      if (opportunities.length === 0 && errors.length > 0) {
        return ok({ ok: false, count: 0, opportunities: [], errors });
      }
      return ok({
        ok: true, query: query ?? 'web development', count: opportunities.length,
        opportunities, errors,
        note: 'Read-only discovery. Nothing was applied to.',
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('check_eligibility', {
    title: 'Check eligibility',
    description:
      'READ-ONLY. Reads one opportunity\'s stated criteria and decides qualify-vs-skip BEFORE any form is filled, showing a verdict and evidence per criterion.',
    inputSchema: {
      opportunity_url: z.string().describe('Internshala detail URL, or a scholarship id/URL.'),
      profile: ProfileInput.describe('Optional facts to judge against: category, gender, annual_income, score_percent, level, skills, work_mode, duration_months, available_from.'),
    },
  }, async ({ opportunity_url, profile }) => {
    try {
      const studentProfile = toStudentProfile(profile);
      const isInternshala = /internshala\.com/i.test(opportunity_url);

      let criteriaText = '';
      let deadlineIso: string | null = null;
      let skills: string[] = [];
      let summary: Record<string, unknown>;

      if (isInternshala) {
        const d = await getInternship(opportunity_url);
        criteriaText = [d.who_can_apply, d.title, d.duration, d.location].filter(Boolean).join('\n');
        skills = d.skills;
        summary = { title: d.title, organisation: d.company, deadline: d.apply_by, value: d.stipend, url: d.url };
      } else {
        const s = await getScholarship(opportunity_url);
        criteriaText = [s.eligibility, s.applicable_for, s.title, s.benefits].filter(Boolean).join('\n');
        deadlineIso = s.deadline_iso;
        summary = { title: s.title, organisation: s.offered_by, deadline: s.deadline_iso, value: s.award, url: s.url };
      }

      const checks = evaluateCriteria(criteriaText, studentProfile, { deadlineIso });

      if (skills.length > 0 && (profile?.skills?.length ?? 0) > 0) {
        const mine = new Set(profile!.skills!.map((x) => x.toLowerCase()));
        const overlap = skills.filter((s) => mine.has(s.toLowerCase()));
        checks.push({
          criterion: 'Skills match',
          verdict: overlap.length > 0 ? 'pass' : 'unknown',
          reason: overlap.length > 0
            ? `You have ${overlap.length}/${skills.length} of the listed skills: ${overlap.join(', ')}.`
            : `None of your skills match the listed skills (${skills.join(', ')}). You may still be eligible.`,
          evidence: skills.join(', '),
        });
      }

      const failed = checks.filter((c) => c.verdict === 'fail');
      const unknown = checks.filter((c) => c.verdict === 'unknown');
      const passed = checks.filter((c) => c.verdict === 'pass');
      const eligible = failed.length === 0;

      return ok({
        ok: true, eligible,
        confidence: checks.length === 0 ? 0.3
          : Number((passed.length / checks.length).toFixed(2)),
        recommendation: eligible ? (unknown.length > 0 ? 'apply_with_review' : 'apply') : 'skip',
        opportunity: summary,
        checks,
        reasons: checks.map((c) => `[${c.verdict.toUpperCase()}] ${c.criterion}: ${c.reason}`),
        blockers: failed.map((c) => c.reason),
        needs_human_confirmation: unknown.map((c) => c.reason),
        note: checks.length === 0
          ? 'The listing did not state machine-checkable criteria. Read it yourself before applying.'
          : 'Read-only. Nothing was filled or submitted.',
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('track_deadlines', {
    title: 'Track deadlines',
    description: 'READ-ONLY. Upcoming close dates across portals, urgency-sorted so nothing lapses.',
    inputSchema: {
      within_days: z.number().optional().describe('Only deadlines within this many days. Default 60.'),
      query: z.string().optional(),
      limit: z.number().optional(),
    },
  }, async ({ within_days, query, limit }) => {
    try {
      const within = Math.max(within_days ?? 60, 1);
      const cap = Math.min(Math.max(limit ?? 20, 1), 60);
      const { rows } = await searchScholarships({ limit: cap, query });

      const classify = (d: number | null) =>
        d === null ? 'unknown' : d < 0 ? 'closed' : d <= 3 ? 'critical' : d <= 14 ? 'soon' : 'upcoming';

      const all = rows.map((r) => ({
        opportunity_id: r.opportunity_id, portal: 'scholarship', kind: 'scholarship',
        title: r.title, deadline_iso: r.deadline_iso, days_remaining: r.days_to_go,
        urgency: classify(r.days_to_go), value: r.award, url: r.url,
      }));
      const upcoming = all
        .filter((r) => r.days_remaining !== null && r.days_remaining >= 0 && r.days_remaining <= within)
        .sort((a, b) => (a.days_remaining ?? 0) - (b.days_remaining ?? 0));

      return ok({
        ok: true, within_days: within,
        counts: {
          upcoming: upcoming.length,
          critical: upcoming.filter((r) => r.urgency === 'critical').length,
          soon: upcoming.filter((r) => r.urgency === 'soon').length,
        },
        upcoming,
        note: 'Read-only. Sorted by days remaining, soonest first.',
      });
    } catch (e) { return fail(e); }
  });

  server.registerTool('list_learned_portals', {
    title: 'List learned portals',
    description: 'READ-ONLY. Which portals this server can read, and which capabilities need the local server.',
    inputSchema: {},
  }, async () => ok({
    ok: true,
    deployment: 'remote',
    version: VERSION,
    portals: [
      { portal: 'internshala', kind: 'internship',
        capabilities: { discover: true, read_detail: true, check_eligibility: true, fill: false },
        source: 'server-rendered HTML over HTTPS (no browser required)' },
      { portal: 'scholarship', kind: 'scholarship',
        capabilities: { discover: true, read_detail: true, check_eligibility: true, fill: false },
        source: 'buddy4study brand pages, server-rendered __NEXT_DATA__' },
    ],
    fill_available: false,
    explanation:
      'This remote server is read-only by construction. Filling an application requires the student\'s own logged-in browser session and their local documents, neither of which exists on a cloud host — and shipping those to a server would break ApplyOnce\'s local-only data guarantee. Run the local stdio server for fill_application.',
  }));

  /**
   * fill_application is DELIBERATELY absent from the remote server.
   * Registering it as a stub that always errors is more honest than omitting
   * it, because a client that asks for it gets a reason and a route forward.
   */
  server.registerTool('fill_application', {
    title: 'Fill application (local only)',
    description:
      'NOT AVAILABLE REMOTELY. Filling needs the student\'s own logged-in browser and their local documents. Use the local ApplyOnce server. This tool never submits anything anywhere.',
    inputSchema: { opportunity_url: z.string().optional() },
  }, async () => fail(new ApplyOnceError('WEBCMD_UNAVAILABLE',
    'fill_application is not available on the remote server: a cloud host has no browser session and no access to your documents.',
    'Run the local ApplyOnce MCP server (npm run build && claude mcp add applyonce -- node dist/mcp/server.js). Your profile and documents never leave your machine.',
    { deployment: 'remote', fill_available: false })));

  return server;
}

/* ------------------------------------------------------------------ *
 * HTTP transport
 * ------------------------------------------------------------------ */
const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((_req, res, next) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, mcp-session-id, mcp-protocol-version, authorization');
  res.setHeader('access-control-expose-headers', 'mcp-session-id');
  res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');
  next();
});
app.options('/*splat', (_req, res) => { res.sendStatus(204); });

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'applyonce-remote', version: VERSION, transport: 'streamable-http' });
});

/** Constant-time token comparison so the endpoint cannot be probed by timing. */
function tokenValid(candidate: string): boolean {
  if (!TOKEN) return true;                    // no token configured = open (dev only)
  const a = Buffer.from(candidate);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** One transport per MCP session id. */
const transports = new Map<string, StreamableHTTPServerTransport>();

async function handleMcp(req: Request, res: Response, token: string): Promise<void> {
  if (!tokenValid(token)) {
    res.status(401).json({
      jsonrpc: '2.0', id: null,
      error: { code: -32001, message: 'Unauthorized: invalid or missing ApplyOnce token.' },
    });
    return;
  }

  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (sessionId && transports.has(sessionId)) {
    await transports.get(sessionId)!.handleRequest(req, res, req.body);
    return;
  }

  // A new session begins on initialize.
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      transports.set(id, transport);
      log.info('tool.start', `MCP session started: ${id}`);
    },
  });
  transport.onclose = () => {
    if (transport.sessionId) transports.delete(transport.sessionId);
  };

  await buildServer().connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// Token in the path — the shape Claude web's Connect accepts (…/c/<token>/mcp).
app.all('/c/:token/mcp', (req, res) => {
  handleMcp(req, res, req.params.token).catch((err) => {
    log.error('tool.error', `MCP transport error: ${(err as Error).message}`);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
});

// Bare /mcp, reading the token from an Authorization header instead.
app.all('/mcp', (req, res) => {
  const header = String(req.headers.authorization ?? '');
  const bearer = header.replace(/^Bearer\s+/i, '');
  handleMcp(req, res, bearer).catch((err) => {
    log.error('tool.error', `MCP transport error: ${(err as Error).message}`);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  });
});

app.listen(PORT, () => {
  process.stderr.write(`ApplyOnce remote MCP server v${VERSION} listening on :${PORT}\n`);
  process.stderr.write(`  health : GET  /health\n`);
  process.stderr.write(`  mcp    : POST /c/<token>/mcp   (or /mcp with a Bearer token)\n`);
  process.stderr.write(`  auth   : ${TOKEN ? 'token required' : 'OPEN — set APPLYONCE_TOKEN in production'}\n`);
});
