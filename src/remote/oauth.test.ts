/**
 * OAuth provider tests.
 *
 * Claude web does not accept a secret in the URL — on Connect it performs OAuth
 * discovery and Dynamic Client Registration. Without these endpoints it fails
 * with "Couldn't register with ApplyOnce's sign-in service", which is exactly
 * what the live deployment did before this provider existed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { ApplyOnceOAuthProvider, canonicalToken, secretsMatch } from './oauth.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

const SECRET = '66KNmqQWshGft0SpoiS7UPmDe74IVpz3/QbM2DAn9bg=';

const client: OAuthClientInformationFull = {
  client_id: 'test-client',
  client_name: 'Claude Web',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
};

/** Minimal Express Response stand-in. */
function fakeRes() {
  const state: { status: number; body: string; location: string | null; headers: Record<string, string> } =
    { status: 200, body: '', location: null, headers: {} };
  return {
    state,
    setHeader(k: string, v: string) { state.headers[k] = v; return this; },
    status(code: number) { state.status = code; return this; },
    end(body?: string) { state.body = body ?? ''; return this; },
    redirect(code: number, url: string) { state.status = code; state.location = url; return this; },
  } as never;
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

describe('token canonicalisation', () => {
  it('folds a Base64 secret onto a URL-safe form', () => {
    expect(canonicalToken(SECRET)).toBe('66KNmqQWshGft0SpoiS7UPmDe74IVpz3_QbM2DAn9bg');
  });
  it('treats raw, url-safe and percent-encoded forms as the same secret', () => {
    expect(secretsMatch(SECRET, '66KNmqQWshGft0SpoiS7UPmDe74IVpz3_QbM2DAn9bg')).toBe(true);
    expect(secretsMatch(SECRET, '66KNmqQWshGft0SpoiS7UPmDe74IVpz3%2FQbM2DAn9bg%3D')).toBe(true);
  });
  it('still rejects a different secret', () => {
    expect(secretsMatch(SECRET, 'not-the-secret')).toBe(false);
  });
});

describe('ApplyOnceOAuthProvider', () => {
  let provider: ApplyOnceOAuthProvider;
  beforeEach(async () => {
    provider = new ApplyOnceOAuthProvider(SECRET);
    await provider.clientsStore.registerClient(client);
  });

  it('registers a client dynamically (RFC 7591)', async () => {
    const found = await provider.clientsStore.getClient('test-client');
    expect(found?.client_name).toBe('Claude Web');
  });

  it('shows a consent screen rather than auto-approving when a secret is set', async () => {
    const res = fakeRes() as unknown as ReturnType<typeof fakeRes>;
    await provider.authorize(client, {
      redirectUri: client.redirect_uris[0], codeChallenge: 'abc', state: 's1',
    }, res as never);
    expect(res.state.body).toContain('Connect to ApplyOnce');
    expect(res.state.body).toContain('cannot');          // states its limits
    expect(res.state.location).toBeNull();               // no redirect yet
  });

  it('rejects a wrong access code and accepts the right one', () => {
    expect(provider.verifySecret('nope')).toBe(false);
    expect(provider.verifySecret(SECRET)).toBe(true);
    expect(provider.verifySecret('66KNmqQWshGft0SpoiS7UPmDe74IVpz3_QbM2DAn9bg')).toBe(true);
  });

  it('completes the full authorization-code + PKCE exchange', async () => {
    const { verifier, challenge } = pkce();
    const res = fakeRes() as unknown as ReturnType<typeof fakeRes>;
    provider.completeAuthorization(client,
      { redirectUri: client.redirect_uris[0], codeChallenge: challenge, state: 'xyz' }, res as never);

    expect(res.state.status).toBe(302);
    const url = new URL(res.state.location!);
    expect(url.searchParams.get('state')).toBe('xyz');
    const code = url.searchParams.get('code')!;
    expect(code).toBeTruthy();

    const tokens = await provider.exchangeAuthorizationCode(client, code, verifier);
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.token_type).toBe('Bearer');

    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info.clientId).toBe('test-client');
    expect(info.scopes).toContain('applyonce:read');
  });

  it('rejects a bad PKCE verifier', async () => {
    const { challenge } = pkce();
    const res = fakeRes() as unknown as ReturnType<typeof fakeRes>;
    provider.completeAuthorization(client,
      { redirectUri: client.redirect_uris[0], codeChallenge: challenge }, res as never);
    const code = new URL(res.state.location!).searchParams.get('code')!;
    await expect(provider.exchangeAuthorizationCode(client, code, 'wrong-verifier'))
      .rejects.toThrow(/PKCE/i);
  });

  it('makes an authorization code single-use', async () => {
    const { verifier, challenge } = pkce();
    const res = fakeRes() as unknown as ReturnType<typeof fakeRes>;
    provider.completeAuthorization(client,
      { redirectUri: client.redirect_uris[0], codeChallenge: challenge }, res as never);
    const code = new URL(res.state.location!).searchParams.get('code')!;

    await provider.exchangeAuthorizationCode(client, code, verifier);
    await expect(provider.exchangeAuthorizationCode(client, code, verifier))
      .rejects.toThrow(/Invalid or expired/i);
  });

  it('rejects an unknown access token', async () => {
    await expect(provider.verifyAccessToken('garbage')).rejects.toThrow(/Invalid or expired/i);
  });

  it('also accepts the shared secret directly as a Bearer token (for CLI use)', async () => {
    const info = await provider.verifyAccessToken(SECRET);
    expect(info.clientId).toBe('applyonce-direct');
  });

  it('supports refresh tokens', async () => {
    const { verifier, challenge } = pkce();
    const res = fakeRes() as unknown as ReturnType<typeof fakeRes>;
    provider.completeAuthorization(client,
      { redirectUri: client.redirect_uris[0], codeChallenge: challenge }, res as never);
    const code = new URL(res.state.location!).searchParams.get('code')!;
    const first = await provider.exchangeAuthorizationCode(client, code, verifier);

    const second = await provider.exchangeRefreshToken(client, first.refresh_token!);
    expect(second.access_token).toBeTruthy();
    expect(second.access_token).not.toBe(first.access_token);
  });
});

describe('open mode (no secret configured)', () => {
  it('auto-approves so local development needs no consent step', async () => {
    const open = new ApplyOnceOAuthProvider('');
    await open.clientsStore.registerClient(client);
    const res = fakeRes() as unknown as ReturnType<typeof fakeRes>;
    await open.authorize(client, { redirectUri: client.redirect_uris[0], codeChallenge: 'c' }, res as never);
    expect(res.state.status).toBe(302);          // redirected immediately
    expect(open.isOpen).toBe(true);
  });
});
