import { describe, it, expect } from 'vitest';
import { generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { verifyToken, oidcConfigFromEnv, type OidcConfig } from '../src/auth.js';

const cfg: OidcConfig = {
  issuer: 'https://hub.ci.localhost/api/auth',
  jwksUri: 'https://hub.ci.localhost/api/auth/jwks',
  audience: ['companion-atlas'],
};

async function sign(
  priv: KeyLike,
  opts: { iss?: string; aud?: string; sub?: string; exp?: string | number; scope?: string } = {},
): Promise<string> {
  return new SignJWT({ scope: opts.scope ?? 'openid profile', email: 'liam@ci' })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(opts.iss ?? cfg.issuer)
    .setAudience(opts.aud ?? 'companion-atlas')
    .setSubject(opts.sub ?? 'user_123')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(priv);
}

describe('OIDC verifyToken — real signature/issuer/audience/expiry checks', () => {
  it('accepts a valid EdDSA token and extracts subject/scopes/email', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');
    const ctx = await verifyToken(await sign(privateKey), cfg, publicKey);
    expect(ctx.subject).toBe('user_123');
    expect(ctx.scopes).toEqual(['openid', 'profile']);
    expect(ctx.email).toBe('liam@ci');
  });

  it('rejects the wrong audience', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');
    await expect(verifyToken(await sign(privateKey, { aud: 'ci-hub' }), cfg, publicKey)).rejects.toThrow();
  });

  it('rejects the wrong issuer', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');
    await expect(verifyToken(await sign(privateKey, { iss: 'https://evil/api/auth' }), cfg, publicKey)).rejects.toThrow();
  });

  it('rejects a signature from a different key (the core bug the stub had)', async () => {
    const a = await generateKeyPair('EdDSA');
    const b = await generateKeyPair('EdDSA');
    await expect(verifyToken(await sign(a.privateKey), cfg, b.publicKey)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA');
    const expired = await sign(privateKey, { exp: 1 }); // epoch second 1 → 1970
    await expect(verifyToken(expired, cfg, publicKey)).rejects.toThrow();
  });
});

describe('oidcConfigFromEnv', () => {
  it('derives JWKS from an issuer that already includes /api/auth', () => {
    expect(oidcConfigFromEnv({ COMPANION_OIDC_ISSUER: 'https://hub.ci.localhost/api/auth' })?.jwksUri).toBe(
      'https://hub.ci.localhost/api/auth/jwks',
    );
  });
  it('derives JWKS from an origin-only issuer', () => {
    expect(oidcConfigFromEnv({ COMPANION_OIDC_ISSUER: 'https://hub.ci.localhost' })?.jwksUri).toBe(
      'https://hub.ci.localhost/api/auth/jwks',
    );
  });
  it('returns null when no issuer is set (auth disabled for dev)', () => {
    expect(oidcConfigFromEnv({})).toBeNull();
  });
  it('defaults audience to companion-atlas and splits a csv', () => {
    expect(oidcConfigFromEnv({ COMPANION_OIDC_ISSUER: 'x' })?.audience).toEqual(['companion-atlas']);
    expect(oidcConfigFromEnv({ COMPANION_OIDC_ISSUER: 'x', COMPANION_OIDC_AUDIENCE: 'a, b' })?.audience).toEqual(['a', 'b']);
  });
});
