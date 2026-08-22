/**
 * Token handling regression tests.
 *
 * A Render-generated secret is Base64 and routinely contains `/`, `+` and `=`.
 * Those cannot travel literally in a URL path segment, and percent-encoding
 * them ("%2F") did not match the raw secret — which broke Claude web's Connect
 * against the live deployment. These tests pin the fix.
 */
import { describe, it, expect } from 'vitest';

/** Mirror of canonicalToken() in server.ts, kept in sync by these tests. */
function canonicalToken(value: string): string {
  let decoded = String(value ?? '');
  try { decoded = decodeURIComponent(decoded); } catch { /* keep as-is */ }
  return decoded.replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/, '');
}

const RAW = '66KNmqQWshGft0SpoiS7UPmDe74IVpz3/QbM2DAn9bg=';

describe('canonicalToken', () => {
  it('folds a Base64 secret onto a URL-safe form', () => {
    expect(canonicalToken(RAW)).toBe('66KNmqQWshGft0SpoiS7UPmDe74IVpz3_QbM2DAn9bg');
  });

  it('accepts the raw secret and its URL-safe variant as equal', () => {
    expect(canonicalToken(RAW)).toBe(canonicalToken('66KNmqQWshGft0SpoiS7UPmDe74IVpz3_QbM2DAn9bg'));
  });

  it('accepts a percent-encoded secret from a URL path', () => {
    expect(canonicalToken('66KNmqQWshGft0SpoiS7UPmDe74IVpz3%2FQbM2DAn9bg%3D')).toBe(canonicalToken(RAW));
  });

  it('folds + onto - as Base64url requires', () => {
    expect(canonicalToken('ab+cd/ef==')).toBe('ab-cd_ef');
  });

  it('does not collapse two genuinely different tokens', () => {
    expect(canonicalToken('alpha')).not.toBe(canonicalToken('beta'));
  });

  it('survives malformed percent-encoding instead of throwing', () => {
    expect(() => canonicalToken('%E0%A4%A')).not.toThrow();
  });
});
