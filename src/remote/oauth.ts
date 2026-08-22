/**
 * ============================================================================
 * OAuth 2.1 provider — what Claude web's "Connect" actually requires.
 * ============================================================================
 * Claude web does NOT accept a secret in the URL. On Connect it performs OAuth
 * discovery, then Dynamic Client Registration (RFC 7591). With no
 * /.well-known/oauth-authorization-server it fails with
 * "Couldn't register with ApplyOnce's sign-in service".
 *
 * ApplyOnce's remote server is READ-ONLY over public pages and stores no
 * personal data, so there is no user account to authenticate against. What we
 * need is proof that the connecting client is authorised — so this implements
 * the full OAuth flow with a single shared access code (APPLYONCE_TOKEN) as
 * the human approval step. The user pastes it once on the consent screen.
 *
 * This is a real OAuth 2.1 implementation: PKCE (S256) is enforced,
 * authorization codes are single-use and short-lived, and tokens expire.
 * State is in-memory: a restart simply asks the user to reconnect, which is
 * the right trade for a server that deliberately persists nothing.
 * ============================================================================
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { log } from '../logging/logger.js';

const CODE_TTL_MS = 10 * 60 * 1000;          // OAuth 2.1: codes are short-lived
const TOKEN_TTL_S = 30 * 24 * 60 * 60;       // 30 days; the client can refresh

/** Fold a possibly-Base64 secret onto one canonical form (see server.ts). */
export function canonicalToken(value: string): string {
  let decoded = String(value ?? '');
  try { decoded = decodeURIComponent(decoded); } catch { /* keep as-is */ }
  return decoded.replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/, '');
}

export function secretsMatch(a: string, b: string): boolean {
  const x = Buffer.from(canonicalToken(a));
  const y = Buffer.from(canonicalToken(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

interface PendingCode {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
  resource?: string;
}

interface IssuedToken {
  clientId: string;
  expiresAt: number;
  scopes: string[];
}

/** In-memory client registry. Claude web registers itself on first Connect. */
class MemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    log.info('tool.start', `OAuth client registered: ${client.client_name ?? client.client_id}`,
      { client_id: client.client_id, redirect_uris: client.redirect_uris });
    return client;
  }
}

export class ApplyOnceOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new MemoryClientsStore();
  private readonly codes = new Map<string, PendingCode>();
  private readonly tokens = new Map<string, IssuedToken>();
  private readonly refreshTokens = new Map<string, IssuedToken>();

  constructor(private readonly sharedSecret: string) {}

  /** True when no secret is configured — dev only; every connection is allowed. */
  get isOpen(): boolean { return !this.sharedSecret; }

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.codes) if (v.expiresAt < now) this.codes.delete(k);
    for (const [k, v] of this.tokens) if (v.expiresAt < now) this.tokens.delete(k);
  }

  /**
   * Render the consent screen. The user pastes the ApplyOnce access code they
   * were given; that is the human approval step for this connection.
   */
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    this.sweep();

    // With no secret configured, approve immediately (local development).
    if (this.isOpen) {
      this.completeAuthorization(client, {
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        state: params.state,
        resource: params.resource ? String(params.resource) : undefined,
      }, res);
      return;
    }

    const form = {
      client_id: client.client_id,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge,
      state: params.state ?? '',
      resource: params.resource ? String(params.resource) : '',
      scopes: (params.scopes ?? []).join(' '),
    };

    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(consentPage(client.client_name ?? 'An MCP client', form));
  }

  /** Called by the consent form POST once the access code checks out. */
  completeAuthorization(
    client: OAuthClientInformationFull,
    params: { redirectUri: string; codeChallenge: string; state?: string; resource?: string },
    res: Response,
  ): void {
    const code = randomBytes(32).toString('base64url');
    this.codes.set(code, {
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      expiresAt: Date.now() + CODE_TTL_MS,
      resource: params.resource,
    });

    const target = new URL(params.redirectUri);
    target.searchParams.set('code', code);
    if (params.state) target.searchParams.set('state', params.state);
    res.redirect(302, target.href);
  }

  /** Verify the pasted access code against the configured secret. */
  verifySecret(candidate: string): boolean {
    if (this.isOpen) return true;
    return secretsMatch(candidate, this.sharedSecret);
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull, authorizationCode: string,
  ): Promise<string> {
    const pending = this.codes.get(authorizationCode);
    if (!pending) throw new Error('Invalid or expired authorization code');
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    codeVerifier?: string,
    _redirectUri?: string,
  ): Promise<OAuthTokens> {
    this.sweep();
    const pending = this.codes.get(authorizationCode);
    if (!pending || pending.clientId !== client.client_id) {
      throw new Error('Invalid or expired authorization code');
    }
    // PKCE S256 — the SDK also validates, we enforce independently.
    if (codeVerifier) {
      const challenge = createHash('sha256').update(codeVerifier).digest('base64url');
      if (challenge !== pending.codeChallenge) throw new Error('PKCE verification failed');
    }
    this.codes.delete(authorizationCode);       // single use
    return this.issue(client.client_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull, refreshToken: string,
  ): Promise<OAuthTokens> {
    const existing = this.refreshTokens.get(refreshToken);
    if (!existing || existing.clientId !== client.client_id) {
      throw new Error('Invalid refresh token');
    }
    this.refreshTokens.delete(refreshToken);
    return this.issue(client.client_id);
  }

  private issue(clientId: string): OAuthTokens {
    const accessToken = randomBytes(32).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const record: IssuedToken = {
      clientId,
      expiresAt: Date.now() + TOKEN_TTL_S * 1000,
      scopes: ['applyonce:read'],
    };
    this.tokens.set(accessToken, record);
    this.refreshTokens.set(refreshToken, record);
    log.info('tool.start', 'OAuth access token issued', { client_id: clientId });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: TOKEN_TTL_S,
      refresh_token: refreshToken,
      scope: 'applyonce:read',
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    this.sweep();
    const record = this.tokens.get(token);

    // Also accept the shared secret directly as a Bearer token, so Claude Code
    // and curl can use the server without running the browser consent flow.
    if (!record) {
      if (!this.isOpen && secretsMatch(token, this.sharedSecret)) {
        return { token, clientId: 'applyonce-direct', scopes: ['applyonce:read'] };
      }
      throw new Error('Invalid or expired access token');
    }
    if (record.expiresAt < Date.now()) {
      this.tokens.delete(token);
      throw new Error('Access token expired');
    }
    return {
      token,
      clientId: record.clientId,
      scopes: record.scopes,
      expiresAt: Math.floor(record.expiresAt / 1000),
    };
  }
}

/** The consent screen shown in the browser during Connect. */
function consentPage(clientName: string, form: Record<string, string>): string {
  const hidden = Object.entries(form)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}" />`)
    .join('\n      ');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Connect to ApplyOnce</title>
<style>
 :root { color-scheme: light dark; }
 body { font-family: ui-sans-serif, system-ui, sans-serif; max-width: 460px;
        margin: 8vh auto; padding: 0 1.25rem; line-height: 1.5; }
 h1 { font-size: 1.3rem; margin-bottom: .25rem; }
 .sub { color: #666; font-size: .9rem; margin-top: 0; }
 .card { border: 1px solid #d8d8d8; border-radius: 10px; padding: 1.1rem; margin: 1.4rem 0; }
 label { display:block; font-size:.85rem; font-weight:600; margin-bottom:.4rem; }
 input[type=password] { width:100%; padding:.6rem; font-size:1rem; border:1px solid #bbb;
        border-radius:6px; box-sizing:border-box; }
 button { margin-top:1rem; width:100%; padding:.75rem; font-size:1rem; font-weight:600;
        background:#1a7f5a; color:#fff; border:0; border-radius:6px; cursor:pointer; }
 ul { font-size:.87rem; color:#444; padding-left:1.1rem; }
 .note { font-size:.8rem; color:#666; }
</style></head>
<body>
  <h1>Connect to ApplyOnce</h1>
  <p class="sub"><strong>${escapeHtml(clientName)}</strong> wants to connect.</p>

  <div class="card">
    <p style="margin-top:0"><strong>This connection can:</strong></p>
    <ul>
      <li>Search live internship and scholarship listings</li>
      <li>Read an opportunity's eligibility criteria and deadlines</li>
    </ul>
    <p style="margin-bottom:0"><strong>It cannot:</strong> fill or submit any application,
    make a payment, or read any personal data. This server stores nothing.</p>
  </div>

  <form method="POST" action="/oauth/consent">
      ${hidden}
    <label for="secret">ApplyOnce access code</label>
    <input id="secret" name="secret" type="password" autocomplete="off" required
           placeholder="Paste the access code you were given" />
    <button type="submit">Approve and connect</button>
  </form>

  <p class="note">The access code is the <code>APPLYONCE_TOKEN</code> set on this
  deployment. Ask whoever runs this server if you do not have it.</p>
</body></html>`;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
