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
import { runHistory } from '../logging/ledger.js';

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

  // Per-portal run history makes the reuse claim auditable over time.
  const history = runHistory();
  const runs = Object.fromEntries(
    Object.entries(history).map(([key, entries]) => [key, {
      total_runs: entries.length,
      latest: entries[0] ? { steps: entries[0].steps, duration_ms: entries[0].durationMs, at: entries[0].at } : null,
      first: entries[entries.length - 1]
        ? { steps: entries[entries.length - 1].steps, duration_ms: entries[entries.length - 1].durationMs }
        : null,
    }]),
  );

  return {
    ok: true as const,
    webcmd_version: version,
    learned_count: portals.length,
    portals,
    run_history: runs,
    not_learned: notLearned.map((portal) => ({
      portal, learned: false,
      note: 'No compiled command yet — the first run on this portal must explore it (slow path).',
    })),
    total_commands_registered: all.length,
    explanation:
      'Portals listed as learned are compiled webcmd commands. Running them costs one deterministic CLI call with no page reasoning. A portal that is not learned must be explored in a browser on every run, which is the cost ApplyOnce removes.',
  };
}
