/**
 * list_learned_portals — READ-ONLY.
 *
 * This tool exists to make the LEARN-ONCE claim auditable rather than asserted.
 * It reads `webcmd list -f json` (webcmd's documented "source of truth for
 * agents") and reports which portals are already COMPILED commands.
 *
 * A portal listed here costs one deterministic CLI execution per run.
 * A portal NOT listed here costs a full browser exploration, every time.
 */

import { listCommands, checkWebcmd, type WebcmdCommand } from '../webcmd/bridge.js';
import { log } from '../logging/logger.js';

const APPLYONCE_SITES = new Set(['internshala', 'scholarship']);

export interface LearnedPortal {
  portal: string;
  learned: boolean;
  commands: Array<{ command: string; access: string; description: string; browser: boolean }>;
  capabilities: { discover: boolean; read_detail: boolean; fill: boolean };
}

export async function listLearnedPortals() {
  const { available, version } = await checkWebcmd();
  if (!available) {
    return {
      ok: false as const,
      error: {
        code: 'WEBCMD_UNAVAILABLE',
        message: 'The webcmd CLI is not available, so learned portals cannot be listed.',
        recovery_hint: 'Install it with `npm i -g @agentrhq/webcmd`, then run `webcmd doctor`.',
      },
    };
  }

  const all: WebcmdCommand[] = await listCommands();

  const bySite = new Map<string, WebcmdCommand[]>();
  for (const cmd of all) {
    if (!bySite.has(cmd.site)) bySite.set(cmd.site, []);
    bySite.get(cmd.site)!.push(cmd);
  }

  const portals: LearnedPortal[] = [];
  for (const [site, cmds] of bySite) {
    if (!APPLYONCE_SITES.has(site)) continue;   // ignore webcmd's own built-ins
    const names = new Set(cmds.map((c) => c.name));
    portals.push({
      portal: site,
      learned: true,
      commands: cmds.map((c) => ({
        command: c.command, access: c.access,
        description: c.description, browser: c.browser,
      })),
      capabilities: {
        discover: names.has('search'),
        read_detail: names.has('detail'),
        fill: names.has('fill'),
      },
    });
  }

  // Portals ApplyOnce knows about but has not compiled yet.
  const notLearned = [...APPLYONCE_SITES].filter((s) => !bySite.has(s));

  log.info('reuse.hit',
    `${portals.length} portal(s) are compiled commands; ${notLearned.length} still require exploration`,
    { learned: portals.map((p) => p.portal), not_learned: notLearned });

  return {
    ok: true as const,
    webcmd_version: version,
    learned_count: portals.length,
    portals,
    not_learned: notLearned.map((portal) => ({
      portal, learned: false,
      note: 'No compiled command yet — the first run on this portal must explore it (slow path).',
    })),
    total_commands_registered: all.length,
    explanation:
      'Portals listed as learned are compiled webcmd commands. Running them costs one deterministic CLI call with no page reasoning. A portal that is not learned must be explored in a browser on every run, which is the cost ApplyOnce removes.',
  };
}
