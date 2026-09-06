/**
 * The startup guard that keeps the dev auth bypass out of a deployment.
 *
 * Two halves:
 *   1. `assertAuthSafeToBoot` / `devAuthBypassAllowed` as pure functions over an
 *      env object — no global mutation, so the permutation table is exhaustive
 *      and order-independent.
 *   2. The property the guard actually protects, proved against the live issuer
 *      from jwks-harness.ts: the configuration it *permits* is one where tokens
 *      are really verified, and the configuration it *refuses* is one where an
 *      anonymous caller can write another subject's story.
 *
 * (2) matters because the guard is only worth having if "issuer configured"
 * genuinely implies "auth works" — asserting that needs a real JWKS endpoint,
 * not a hand-built AuthContext. A `fetch` stub would be inert here: jose's Node
 * build fetches JWKS over `node:http`/`node:https` directly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  assertAuthSafeToBoot,
  canWrite,
  devAuthBypassAllowed,
  isAuthenticated,
  verifyBearer,
} from '../src/auth.js';
import { startIssuer, type Issuer } from './jwks-harness.js';

/** An env with no OIDC issuer — the bypass is live. */
const noIssuer = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ ...extra });

/** An env with a configured issuer — real verification, bypass inactive. */
const withIssuer = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  COMPANION_OIDC_ISSUER: 'https://hub.ci.localhost/api/auth',
  ...extra,
});

describe('devAuthBypassAllowed', () => {
  it.each([
    ['NODE_ENV=development', { NODE_ENV: 'development' }],
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['NODE_ENV cased oddly', { NODE_ENV: 'Development' }],
    ['NODE_ENV padded', { NODE_ENV: ' test ' }],
    ['ATLAS_ALLOW_DEV_AUTH=1', { ATLAS_ALLOW_DEV_AUTH: '1' }],
    ['ATLAS_ALLOW_DEV_AUTH=true', { ATLAS_ALLOW_DEV_AUTH: 'true' }],
    ['the opt-in overriding production', { NODE_ENV: 'production', ATLAS_ALLOW_DEV_AUTH: '1' }],
  ])('allows the bypass with %s', (_label, env) => {
    expect(devAuthBypassAllowed(env)).toBe(true);
  });

  it.each([
    ['NODE_ENV unset', {}],
    ['NODE_ENV=production', { NODE_ENV: 'production' }],
    ['NODE_ENV=staging', { NODE_ENV: 'staging' }],
    ['NODE_ENV empty', { NODE_ENV: '' }],
    ['a falsy opt-in', { ATLAS_ALLOW_DEV_AUTH: '0' }],
    ['a non-committal opt-in', { ATLAS_ALLOW_DEV_AUTH: 'maybe' }],
    ['an empty opt-in', { ATLAS_ALLOW_DEV_AUTH: '' }],
  ])('refuses the bypass with %s', (_label, env) => {
    expect(devAuthBypassAllowed(env)).toBe(false);
  });
});

describe('assertAuthSafeToBoot', () => {
  it('refuses to boot when NODE_ENV marks production and no issuer is set', () => {
    expect(() => assertAuthSafeToBoot(noIssuer({ NODE_ENV: 'production' }))).toThrow(
      /Refusing to start/,
    );
  });

  // The whole point of the allowlist: an unset NODE_ENV is the likeliest shape
  // of a sloppy deployment, so it must fail closed rather than sail through.
  it('refuses to boot when NODE_ENV is unset and no issuer is set', () => {
    expect(() => assertAuthSafeToBoot(noIssuer())).toThrow(/Refusing to start/);
  });

  it('refuses to boot for an unrecognised NODE_ENV such as staging', () => {
    expect(() => assertAuthSafeToBoot(noIssuer({ NODE_ENV: 'staging' }))).toThrow(
      /Refusing to start/,
    );
  });

  it.each([
    ['NODE_ENV=development', { NODE_ENV: 'development' }],
    ['NODE_ENV=test', { NODE_ENV: 'test' }],
    ['an explicit ATLAS_ALLOW_DEV_AUTH=1', { NODE_ENV: 'production', ATLAS_ALLOW_DEV_AUTH: '1' }],
  ])('permits the issuer-less bypass with %s', (_label, env) => {
    expect(() => assertAuthSafeToBoot(noIssuer(env))).not.toThrow();
  });

  it.each([
    ['production', { NODE_ENV: 'production' }],
    ['an unset NODE_ENV', {}],
    ['staging', { NODE_ENV: 'staging' }],
  ])('permits boot in %s once an issuer is configured', (_label, env) => {
    expect(() => assertAuthSafeToBoot(withIssuer(env))).not.toThrow();
  });

  it('treats a whitespace-only issuer as unset, matching oidcConfigFromEnv', () => {
    expect(() =>
      assertAuthSafeToBoot({ COMPANION_OIDC_ISSUER: '   ', NODE_ENV: 'production' }),
    ).toThrow(/Refusing to start/);
  });

  it('explains the risk and every remedy in the failure message', () => {
    let message = '';
    try {
      assertAuthSafeToBoot(noIssuer({ NODE_ENV: 'production', ATLAS_DEV_SUBJECT: 'dev-operator' }));
    } catch (err) {
      message = (err as Error).message;
    }
    // The operator must learn what is wrong, why it is dangerous, and the fixes.
    expect(message).toContain('COMPANION_OIDC_ISSUER');
    expect(message).toContain('dev-operator');
    expect(message).toContain('"*" scope');
    expect(message).toContain('NODE_ENV=development');
    expect(message).toContain('ATLAS_ALLOW_DEV_AUTH=1');
  });

  it('names the configured dev subject rather than a hardcoded default', () => {
    expect(() =>
      assertAuthSafeToBoot(noIssuer({ NODE_ENV: 'production', ATLAS_DEV_SUBJECT: 'ci-robot' })),
    ).toThrow(/ci-robot/);
  });
});

describe('the configuration the guard refuses', () => {
  // Establishes that the guard is not defensive theatre: with no issuer, an
  // unauthenticated caller really does get write access to somebody else's
  // story. process.env is left issuer-less here on purpose.
  const saved = {
    issuer: process.env.COMPANION_OIDC_ISSUER,
    jwks: process.env.COMPANION_OIDC_JWKS_URI,
  };
  beforeAll(() => {
    delete process.env.COMPANION_OIDC_ISSUER;
    delete process.env.COMPANION_OIDC_JWKS_URI;
  });
  afterAll(() => {
    if (saved.issuer === undefined) delete process.env.COMPANION_OIDC_ISSUER;
    else process.env.COMPANION_OIDC_ISSUER = saved.issuer;
    if (saved.jwks === undefined) delete process.env.COMPANION_OIDC_JWKS_URI;
    else process.env.COMPANION_OIDC_JWKS_URI = saved.jwks;
  });

  it('grants a tokenless caller full ownership rights over another subject’s story', async () => {
    const ctx = await verifyBearer(undefined);
    expect(isAuthenticated(ctx)).toBe(true);
    expect(ctx.scopes).toContain('*');
    // The exact escalation the guard prevents shipping.
    expect(canWrite('user_alice', ctx)).toBe(true);
    expect(canWrite(undefined, ctx)).toBe(true);
  });

  it('grants the same rights for an outright invalid token', async () => {
    const ctx = await verifyBearer('Bearer not-a-jwt');
    expect(canWrite('user_alice', ctx)).toBe(true);
  });
});

describe('the configuration the guard permits', () => {
  // startIssuer() points COMPANION_OIDC_* at a live in-process JWKS endpoint.
  let issuer: Issuer;
  beforeAll(async () => {
    issuer = await startIssuer();
  });
  afterAll(async () => {
    await issuer.close();
  });

  it('boots in production, because auth is genuinely configured', () => {
    expect(() =>
      assertAuthSafeToBoot({ ...process.env, NODE_ENV: 'production' }),
    ).not.toThrow();
  });

  it('really verifies tokens rather than waving everyone through', async () => {
    const ctx = await verifyBearer(await issuer.bearer({ sub: 'user_alice' }));
    expect(ctx.subject).toBe('user_alice');
    expect(ctx.scopes).not.toContain('*');
    // No blanket write access: alice cannot touch mallory's story.
    expect(canWrite('user_mallory', ctx)).toBe(false);
    expect(canWrite('user_alice', ctx)).toBe(true);
  });

  it('rejects an unauthenticated caller instead of minting a dev subject', async () => {
    const ctx = await verifyBearer(undefined);
    expect(isAuthenticated(ctx)).toBe(false);
    expect(canWrite('user_alice', ctx)).toBe(false);
  });
});
