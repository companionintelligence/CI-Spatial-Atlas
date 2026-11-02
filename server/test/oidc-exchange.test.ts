import { describe, expect, it, vi } from 'vitest';

import { exchangeAuthorizationCode, type TokenExchangeEnv } from '../src/oidc-exchange.js';

const ENV: TokenExchangeEnv = {
  COMPANION_OIDC_ISSUER: 'https://hub.ci.localhost/api/auth',
  ATLAS_VIEWER_BASE_URL: 'https://atlas.example',
};

const VERIFIER = 'a'.repeat(43);

const GOOD = {
  code: 'code-from-the-portal',
  code_verifier: VERIFIER,
  redirect_uri: 'https://atlas.example/',
};

function portalAnswers(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('exchangeAuthorizationCode — what the Atlas server will redeem', () => {
  it('refuses a request without the code, the verifier or the redirect, and never calls the Portal', async () => {
    const portal = portalAnswers({});

    for (const bad of [
      null,
      'not an object',
      { ...GOOD, code: undefined },
      { ...GOOD, code: '' },
      { ...GOOD, code: 'x'.repeat(513) },
      { ...GOOD, code_verifier: undefined },
      { ...GOOD, redirect_uri: undefined },
    ]) {
      const result = await exchangeAuthorizationCode(bad, ENV, portal);

      expect(result.status, JSON.stringify(bad)).toBe(400);
    }

    expect(portal).not.toHaveBeenCalled();
  });

  it('refuses a verifier outside RFC 7636, and a redirect that is not the viewer’s own URL', async () => {
    const portal = portalAnswers({});

    for (const verifier of ['short', 'b'.repeat(129), `${'c'.repeat(42)} `, `${'d'.repeat(42)}+`]) {
      const result = await exchangeAuthorizationCode({ ...GOOD, code_verifier: verifier }, ENV, portal);

      expect(result.status, verifier).toBe(400);
    }

    for (const redirect of [
      'https://atlas.example/callback',
      'http://atlas.example/',
      'https://evil.example/',
      'https://atlas.example.evil.example/',
    ]) {
      const result = await exchangeAuthorizationCode({ ...GOOD, redirect_uri: redirect }, ENV, portal);

      expect(result.status, redirect).toBe(400);
    }

    expect(portal).not.toHaveBeenCalled();
  });

  it('answers 400 for every request when the viewer’s own URL is not configured, rather than trusting any redirect', async () => {
    const portal = portalAnswers({});
    const result = await exchangeAuthorizationCode(GOOD, { COMPANION_OIDC_ISSUER: ENV.COMPANION_OIDC_ISSUER }, portal);

    expect(result.status).toBe(400);
    expect(portal).not.toHaveBeenCalled();
  });

  it('answers 503 when the Portal is not configured', async () => {
    const portal = portalAnswers({});
    const result = await exchangeAuthorizationCode(GOOD, { ATLAS_VIEWER_BASE_URL: ENV.ATLAS_VIEWER_BASE_URL }, portal);

    expect(result).toEqual({ status: 503, body: { error: 'portal_not_configured' } });
    expect(portal).not.toHaveBeenCalled();
  });

  it('redeems the code at the issuer as the public client, with the verifier, and passes the tokens back', async () => {
    const tokens = { access_token: 'opaque-access', token_type: 'Bearer', id_token: 'id.tok.en', expires_in: 3600 };
    const portal = portalAnswers(tokens);

    const result = await exchangeAuthorizationCode(GOOD, ENV, portal);

    expect(result).toEqual({ status: 200, body: tokens });
    expect(portal).toHaveBeenCalledTimes(1);

    const [url, init] = portal.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));

    expect(url).toBe('https://hub.ci.localhost/api/auth/oauth2/token');
    expect(init.method).toBe('POST');
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('client_id')).toBe('companion-atlas');
    expect(form.get('code')).toBe('code-from-the-portal');
    expect(form.get('code_verifier')).toBe(VERIFIER);
    expect(form.get('redirect_uri')).toBe('https://atlas.example/');
    // No client secret: Atlas is a public client.
    expect(form.has('client_secret')).toBe(false);
  });

  it('passes the Portal’s own refusal through, so the viewer can show the real reason', async () => {
    const refusal = { error: 'invalid_grant', error_description: 'code_verifier does not match' };
    const result = await exchangeAuthorizationCode(GOOD, ENV, portalAnswers(refusal, 400));

    expect(result).toEqual({ status: 400, body: refusal });
  });

  it('answers 502 when the Portal cannot be reached', async () => {
    const unreachable = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await exchangeAuthorizationCode(GOOD, ENV, unreachable);

    expect(result).toEqual({ status: 502, body: { error: 'portal_unreachable' } });
  });

  it('answers 502 when the Portal answers something that is not a JSON object', async () => {
    const html = await exchangeAuthorizationCode(GOOD, ENV, portalAnswers('<html>gateway timeout</html>', 504));
    const array = await exchangeAuthorizationCode(GOOD, ENV, portalAnswers('[1, 2]', 200));

    expect(html).toEqual({ status: 502, body: { error: 'portal_bad_response' } });
    expect(array).toEqual({ status: 502, body: { error: 'portal_bad_response' } });
  });
});
