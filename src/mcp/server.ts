#!/usr/bin/env node
/**
 * ============================================================================
 * ApplyOnce MCP server
 * ============================================================================
 * VERIFIED DESIGN NOTE:
 *   webcmd v0.7.4 does NOT ship an MCP server — its own start.md says MCP
 *   support is "not implemented yet". Adapters are CLI commands. So ApplyOnce
 *   is the MCP server, and webcmd is its execution engine. Every tool below
 *   ultimately shells out to a compiled `webcmd <site> <name>` command.
 *
 * SAFETY: none of these tools submits an application or makes a payment.
 *   read-only : find_opportunities, check_eligibility, list_learned_portals,
 *               track_deadlines
 *   write     : fill_application — stops at the final submit button and
 *               returns ready_for_review for a human to finish.
 *
 * Logs go to STDERR only; STDOUT carries the JSON-RPC stream.
 * ============================================================================
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import { fillApplication } from '../tools/fill-application.js';
import { findOpportunities } from '../tools/find-opportunities.js';
import { checkEligibility } from '../tools/check-eligibility.js';
import { listLearnedPortals } from '../tools/list-learned-portals.js';
import { trackDeadlines } from '../tools/track-deadlines.js';
import { toApplyOnceError } from '../errors.js';
import { log } from '../logging/logger.js';

const SERVER_NAME = 'applyonce';
const SERVER_VERSION = '0.1.0';

const TOOLS: Tool[] = [
  {
    name: 'find_opportunities',
    description:
      'READ-ONLY. Search live Indian internship and scholarship portals for opportunities matching the stored student profile. Returns structured rows with deadlines and award/stipend. Does not apply to anything.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword, e.g. "web development". Defaults to the profile\'s preferred job titles.' },
        portal: { type: 'string', enum: ['internshala', 'scholarship', 'all'], description: 'Which portal to search. Default "all".' },
        location: { type: 'string', description: 'City filter for internships, e.g. "bangalore".' },
        category: { type: 'string', description: 'Scholarship category slug, e.g. "girls", "sc-st-obc", "engineering".' },
        limit: { type: 'number', description: 'Max rows per portal (1-40). Default 10.' },
        profile_path: { type: 'string', description: 'Path or id of the local profile. Defaults to the sample profile.' },
      },
    },
  },
  {
    name: 'check_eligibility',
    description:
      'READ-ONLY. Read one opportunity\'s stated criteria and decide whether the student qualifies BEFORE any form is filled. Returns {eligible, confidence, reasons[], blockers[]} with explicit reasoning for each check.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunity_url: { type: 'string', description: 'The internship or scholarship URL to evaluate.' },
        portal: { type: 'string', enum: ['internshala', 'scholarship'], description: 'Inferred from the URL when omitted.' },
        profile_path: { type: 'string', description: 'Path or id of the local profile.' },
      },
      required: ['opportunity_url'],
    },
  },
  {
    name: 'fill_application',
    description:
      'Drives the portal and fills an application from the stored profile UP TO the final submit button, then STOPS. NEVER submits and never pays. Returns {status:"ready_for_review", filled_fields, unmapped_fields, missing_documents, submit_url} so a human can review and submit.',
    inputSchema: {
      type: 'object',
      properties: {
        opportunity_url: { type: 'string', description: 'The internship or scholarship application URL.' },
        portal: { type: 'string', enum: ['internshala', 'scholarship'], description: 'Inferred from the URL when omitted.' },
        profile_path: { type: 'string', description: 'Path or id of the local profile.' },
        session: { type: 'string', description: 'Optional webcmd session id to reuse a specific browser window.' },
        dry_run: { type: 'boolean', description: 'Scrape and map the form without typing anything. Default false.' },
      },
      required: ['opportunity_url'],
    },
  },
  {
    name: 'list_learned_portals',
    description:
      'READ-ONLY. Lists the portals ApplyOnce has already learned, straight from `webcmd list -f json`. A portal appearing here is a COMPILED command: future runs execute instantly instead of re-exploring the site.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'track_deadlines',
    description:
      'READ-ONLY. Reports upcoming close dates across saved//found opportunities, sorted by urgency, so nothing lapses.',
    inputSchema: {
      type: 'object',
      properties: {
        within_days: { type: 'number', description: 'Only include deadlines within this many days. Default 60.' },
        portal: { type: 'string', enum: ['internshala', 'scholarship', 'all'], description: 'Default "all".' },
        query: { type: 'string', description: 'Keyword for the internship search.' },
        category: { type: 'string', description: 'Scholarship category slug.' },
        limit: { type: 'number', description: 'Max rows per portal. Default 15.' },
        profile_path: { type: 'string', description: 'Path or id of the local profile.' },
      },
    },
  },
];

const server = new Server(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  const startedAt = Date.now();
  log.info('tool.start', `MCP tool called: ${name}`, { tool: name });

  try {
    let result: unknown;
    switch (name) {
      case 'find_opportunities':
        result = await findOpportunities(args as never);
        break;
      case 'check_eligibility':
        result = await checkEligibility(args as never);
        break;
      case 'fill_application':
        result = await fillApplication(args as never);
        break;
      case 'list_learned_portals':
        result = await listLearnedPortals();
        break;
      case 'track_deadlines':
        result = await trackDeadlines(args as never);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    log.info('tool.end', `${name} completed in ${Date.now() - startedAt}ms`, { tool: name });
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    // Every failure is machine-readable with a recovery hint — never a raw stack.
    const error = toApplyOnceError(err);
    log.error('tool.error', `${name} failed: ${error.message}`, {
      tool: name, code: error.code,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify(error.toJSON(), null, 2) }],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info('tool.start', `ApplyOnce MCP server v${SERVER_VERSION} ready on stdio`, {
    tools: TOOLS.map((t) => t.name),
  });
}

main().catch((err) => {
  log.error('tool.error', `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
