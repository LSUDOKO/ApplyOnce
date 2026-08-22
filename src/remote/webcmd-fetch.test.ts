/**
 * Verifies that the REMOTE server genuinely runs webcmd rather than
 * reimplementing it. These tests load webcmd's own `web/fetch` command object
 * out of the installed package and assert its contract.
 */
import { describe, it, expect } from 'vitest';
import { loadWebcmdFetch, webcmdAvailable } from './webcmd-fetch.js';

describe('webcmd is a real dependency of the remote server', () => {
  it('loads webcmd\'s own web/fetch command from the package export', async () => {
    const cmd = await loadWebcmdFetch();
    expect(cmd.site).toBe('web');
    expect(cmd.name).toBe('fetch');
    expect(typeof cmd.func).toBe('function');
  });

  it('uses a command webcmd declares BROWSERLESS, which is why it runs on a cloud host', async () => {
    const cmd = await loadWebcmdFetch();
    expect(cmd.browser).toBe(false);
  });

  it('uses a READ-ONLY command, matching the remote server\'s read-only guarantee', async () => {
    const cmd = await loadWebcmdFetch();
    expect(cmd.access).toBe('read');
  });

  it('reports availability without throwing', async () => {
    await expect(webcmdAvailable()).resolves.toBe(true);
  });

  it('caches the loaded command instead of re-importing per call', async () => {
    const a = await loadWebcmdFetch();
    const b = await loadWebcmdFetch();
    expect(a).toBe(b);
  });
});
