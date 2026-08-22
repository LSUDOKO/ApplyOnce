import { describe, expect, it } from 'vitest';
import { getRegistry } from '@agentrhq/webcmd/registry';
import '../index.js';

/**
 * Look one command up out of webcmd's registry.
 * getRegistry() returns a Map keyed "site/name" (verified against webcmd 0.7.4).
 */
function cmd(site, name) {
  return getRegistry().get(`${site}/${name}`);
}

const SITES = ['internshala', 'scholarship'];
const NAMES = ['search', 'detail', 'fill'];

describe('registration', () => {
  it('registers all six commands', () => {
    for (const site of SITES) {
      for (const name of NAMES) {
        expect(cmd(site, name), `${site}/${name} should be registered`).toBeTruthy();
      }
    }
  });

  it('declares a browser requirement and a domain on every command', () => {
    for (const site of SITES) {
      for (const name of NAMES) {
        const c = cmd(site, name);
        expect(c.browser).toBe(true);
        expect(c.domain).toBeTruthy();
        expect(typeof c.func).toBe('function');
      }
    }
  });

  it('exposes stable output columns so consumers have a contract', () => {
    for (const site of SITES) {
      for (const name of NAMES) {
        expect(Array.isArray(cmd(site, name).columns)).toBe(true);
        expect(cmd(site, name).columns.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('HARD RULE 3 — discovery is read-only', () => {
  it('marks search and detail read-only', () => {
    for (const site of SITES) {
      expect(cmd(site, 'search').access).toBe('read');
      expect(cmd(site, 'detail').access).toBe('read');
    }
  });

  it('marks only fill as a write command', () => {
    for (const site of SITES) {
      expect(cmd(site, 'fill').access).toBe('write');
    }
  });
});

describe('HARD RULE 1 — no command may submit', () => {
  it('states in its description that fill never submits', () => {
    for (const site of SITES) {
      expect(cmd(site, 'fill').description).toMatch(/never submits/i);
    }
  });

  it('offers a dry-run so a form can be inspected without typing', () => {
    for (const site of SITES) {
      const names = cmd(site, 'fill').args.map((a) => a.name);
      expect(names).toContain('dry-run');
    }
  });

  it('accepts a caller-supplied plan rather than holding profile data', () => {
    for (const site of SITES) {
      const names = cmd(site, 'fill').args.map((a) => a.name);
      expect(names).toContain('values');
      expect(names).toContain('files');
    }
  });
});

describe('argument contracts', () => {
  it('requires a positional query for internshala search', () => {
    const query = cmd('internshala', 'search').args.find((a) => a.name === 'query');
    expect(query.required).toBe(true);
    expect(query.positional).toBe(true);
  });

  it('makes the scholarship category optional so an unfiltered scan works', () => {
    const category = cmd('scholarship', 'search').args.find((a) => a.name === 'category');
    expect(category.required).toBe(false);
  });

  it('requires a url for every detail and fill command', () => {
    for (const site of SITES) {
      for (const name of ['detail', 'fill']) {
        const url = cmd(site, name).args.find((a) => a.name === 'url');
        expect(url, `${site}/${name} must take a url`).toBeTruthy();
        expect(url.required).toBe(true);
      }
    }
  });

  it('exposes the dependent-dropdown and checkbox maps on scholarship fill', () => {
    const names = cmd('scholarship', 'fill').args.map((a) => a.name);
    expect(names).toContain('selects');
    expect(names).toContain('checks');
  });

  it('reports submitted and submit_control in fill output columns', () => {
    for (const site of SITES) {
      const columns = cmd(site, 'fill').columns;
      expect(columns).toContain('submitted');
      expect(columns).toContain('submit_control');
      expect(columns).toContain('status');
    }
  });
});

describe('discoverability', () => {
  it('tags every command so `webcmd list --tag applyonce` finds them', () => {
    for (const site of SITES) {
      for (const name of NAMES) {
        expect(cmd(site, name).tags).toContain('applyonce');
      }
    }
  });

  it('tags the search commands for `webcmd list --tag search`', () => {
    for (const site of SITES) {
      expect(cmd(site, 'search').tags).toContain('search');
    }
  });
});
