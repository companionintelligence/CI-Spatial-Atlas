import { describe, it, expect, afterEach } from 'vitest';
import { canRead, verifyBearer, ANONYMOUS } from '../src/auth.js';

const anon = { subject: 'anon', scopes: [] as string[], token: '' };

describe('canRead', () => {
  it('public/unlisted are readable by anyone', () => {
    expect(canRead('public', 'owner', anon)).toBe(true);
    expect(canRead('unlisted', 'owner', anon)).toBe(true);
  });
  it('private is readable only by the owner or a *-scoped subject', () => {
    expect(canRead('private', 'owner', anon)).toBe(false);
    expect(canRead('private', 'anon', anon)).toBe(true);
    expect(canRead('private', 'owner', { subject: 'other', scopes: ['*'], token: '' })).toBe(true);
  });
});

describe('verifyBearer', () => {
  const prev = process.env.COMPANION_OIDC_ISSUER;
  afterEach(() => {
    if (prev === undefined) delete process.env.COMPANION_OIDC_ISSUER;
    else process.env.COMPANION_OIDC_ISSUER = prev;
  });

  it('with no issuer configured, runs as the dev subject with * scope', async () => {
    delete process.env.COMPANION_OIDC_ISSUER;
    const ctx = await verifyBearer('Bearer whatever');
    expect(ctx.scopes).toContain('*');
    expect(ctx.subject).toBeTruthy();
  });

  it('with an issuer set but no token, is anonymous', async () => {
    process.env.COMPANION_OIDC_ISSUER = 'https://portal.example/oidc';
    expect(await verifyBearer(undefined)).toEqual(ANONYMOUS);
  });
});
