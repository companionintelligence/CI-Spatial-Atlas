/**
 * `verifyBearer()` against a real JWKS endpoint.
 *
 * auth-oidc.test.ts covers `verifyToken` with a key passed in directly; this
 * covers the layer above it — env-driven config, the remote JWKS fetch, and the
 * degrade-to-ANONYMOUS behaviour the authorisation gates depend on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ANONYMOUS, canWrite, isAuthenticated, verifyBearer } from '../src/auth.js';
import { startIssuer, type Issuer } from './jwks-harness.js';

let issuer: Issuer;
beforeAll(async () => {
  issuer = await startIssuer();
});
afterAll(async () => {
  await issuer.close();
});

describe('verifyBearer against a live JWKS', () => {
  it('verifies a genuine token and yields an authenticated context', async () => {
    const ctx = await verifyBearer(await issuer.bearer({ sub: 'user_alice', email: 'alice@ci' }));
    expect(ctx.subject).toBe('user_alice');
    expect(ctx.email).toBe('alice@ci');
    expect(isAuthenticated(ctx)).toBe(true);
  });

  it('parses space-delimited scopes', async () => {
    const ctx = await verifyBearer(await issuer.bearer({ scope: 'openid profile atlas:write' }));
    expect(ctx.scopes).toEqual(['openid', 'profile', 'atlas:write']);
  });

  it.each([
    ['no Authorization header', undefined],
    ['a garbage token', 'Bearer not-a-jwt'],
  ])('degrades to ANONYMOUS with %s', async (_label, header) => {
    const ctx = await verifyBearer(header as string | undefined);
    expect(ctx).toEqual(ANONYMOUS);
    expect(isAuthenticated(ctx)).toBe(false);
  });

  it.each([
    ['a key absent from the JWKS', { wrongKey: true }],
    ['the wrong audience', { aud: 'some-other-client' }],
    ['the wrong issuer', { iss: 'https://evil.example/api/auth' }],
    ['an expired token', { exp: 1 }],
  ])('degrades to ANONYMOUS for %s', async (_label, opts) => {
    const ctx = await verifyBearer(await issuer.bearer(opts));
    expect(ctx).toEqual(ANONYMOUS);
  });

  it('rejects a well-signed token carrying no subject', async () => {
    // Without this, `String(payload.sub)` would mint the subject "undefined",
    // which canWrite would then happily match against an owner.
    const ctx = await verifyBearer(await issuer.bearer({ sub: '' }));
    expect(ctx).toEqual(ANONYMOUS);
  });

  it('rejects a token claiming the reserved "anonymous" subject', async () => {
    // Otherwise a forged-but-valid token could be minted to own the stories
    // that the pre-fix anonymous-write path created.
    const ctx = await verifyBearer(await issuer.bearer({ sub: 'anonymous' }));
    expect(ctx).toEqual(ANONYMOUS);
  });

  it('an unverifiable token cannot write anything, including ownerless stories', async () => {
    const ctx = await verifyBearer('Bearer forged');
    expect(canWrite('user_alice', ctx)).toBe(false);
    expect(canWrite(undefined, ctx)).toBe(false);
  });
});
