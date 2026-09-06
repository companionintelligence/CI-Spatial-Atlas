/**
 * End-to-end `verifyBearer()` against a **stubbed JWKS endpoint**.
 *
 * auth-oidc.test.ts covers `verifyToken` with a key handed in directly; this
 * file exercises the path a real request takes — env → `oidcConfigFromEnv` →
 * `createRemoteJWKSet` → `jwtVerify` — including the `kid` lookup and the key
 * cache, which a direct-key test cannot reach.
 *
 * The stub is a `node:http` server bound to **127.0.0.1 on an ephemeral port**,
 * not a mocked `fetch`: jose's Node build fetches a JWKS with `node:https.get`,
 * so stubbing `globalThis.fetch` looks like it works and silently doesn't
 * (every token then fails with a DNS error classified as `unknown` — which is
 * exactly how this file was first written, and it went green-adjacent enough to
 * be worth the warning). Loopback only; nothing leaves the machine, and no
 * Portal is required.
 *
 * The property under test is two-sided, and both sides matter:
 *   1. every forgery is rejected (wrong key / expired / wrong audience / wrong
 *      issuer / no sub), and
 *   2. all of them are rejected *identically* from the caller's point of view
 *      (`ANONYMOUS`), while the server log gets a distinct reason for each.
 *      Leaking which check failed turns Atlas into an oracle for repairing a
 *      stolen token.
 */
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';

import { verifyBearer, ANONYMOUS, type AuthFailureReason } from '../src/auth.js';

// The issuer stays the real Portal identifier (it is an *identifier*, never
// dereferenced) while the JWKS URI is overridden onto loopback — which also
// exercises COMPANION_OIDC_JWKS_URI, the env var a split deployment needs.
const ISSUER = 'https://hub.ci.localhost/api/auth';
const KID = 'portal-signing-key-1';

// The key Portal "publishes" and the key an attacker signs with. Both tokens
// carry the same `kid` on purpose: a token whose kid matches a served key but
// whose signature does not is the pure signature-failure case. A mismatched kid
// would instead fail at key *lookup*, which is a weaker (and different) test.
let portal: { publicKey: KeyLike; privateKey: KeyLike };
let attacker: { publicKey: KeyLike; privateKey: KeyLike };

let jwksServer: Server;
let jwksHits = 0;

const envBackup: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in envBackup)) envBackup[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/** Collects what auth.ts logged, so we can assert the reason without a real logger. */
function recorder() {
  const lines: Array<{ details: Record<string, unknown>; message: string }> = [];
  return {
    lines,
    warn: (details: Record<string, unknown>, message: string) => void lines.push({ details, message }),
    error: (details: Record<string, unknown>, message: string) => void lines.push({ details, message }),
    reason: () => lines.at(-1)?.details.reason as AuthFailureReason | undefined,
  };
}

async function sign(
  key: KeyLike,
  opts: { iss?: string; aud?: string; sub?: string | null; exp?: string | number; kid?: string } = {},
): Promise<string> {
  const jwt = new SignJWT({ scope: 'openid profile atlas:write', email: 'liam@ci' })
    .setProtectedHeader({ alg: 'EdDSA', kid: opts.kid ?? KID })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? 'companion-atlas')
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m');
  // `sub: null` means "omit the claim entirely" — the no-subject forgery.
  if (opts.sub !== null) jwt.setSubject(opts.sub ?? 'user_portal_42');
  return jwt.sign(key);
}

beforeAll(async () => {
  portal = await generateKeyPair('EdDSA');
  attacker = await generateKeyPair('EdDSA');
  const jwk = { ...(await exportJWK(portal.publicKey)), kid: KID, alg: 'EdDSA', use: 'sig' };

  jwksServer = createServer((req, res) => {
    jwksHits++;
    if (req.url !== '/jwks') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
  });
  jwksServer.listen(0, '127.0.0.1');
  await once(jwksServer, 'listening');
  const { port } = jwksServer.address() as AddressInfo;

  setEnv('COMPANION_OIDC_ISSUER', ISSUER);
  setEnv('COMPANION_OIDC_AUDIENCE', 'companion-atlas');
  setEnv('COMPANION_OIDC_JWKS_URI', `http://127.0.0.1:${port}/jwks`);
});

afterAll(async () => {
  jwksServer.close();
  await once(jwksServer, 'close');
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('verifyBearer over a stubbed Portal JWKS', () => {
  it('accepts a correctly signed token and yields the Portal subject', async () => {
    const log = recorder();
    const ctx = await verifyBearer(`Bearer ${await sign(portal.privateKey)}`, log);
    expect(ctx.subject).toBe('user_portal_42');
    expect(ctx.scopes).toEqual(['openid', 'profile', 'atlas:write']);
    expect(ctx.email).toBe('liam@ci');
    expect(log.lines).toEqual([]); // nothing to warn about on the happy path
  });

  it('rejects a token signed with a key the issuer does not publish', async () => {
    const log = recorder();
    // Same kid as Portal's key, different private key: passes lookup, fails crypto.
    const forged = await sign(attacker.privateKey);
    expect(await verifyBearer(`Bearer ${forged}`, log)).toEqual(ANONYMOUS);
    expect(log.reason()).toBe('signature_invalid');
  });

  it('rejects an expired token', async () => {
    const log = recorder();
    const expired = await sign(portal.privateKey, { exp: Math.floor(Date.now() / 1000) - 60 });
    expect(await verifyBearer(`Bearer ${expired}`, log)).toEqual(ANONYMOUS);
    expect(log.reason()).toBe('expired');
  });

  it('rejects a token minted for another audience (another Portal client)', async () => {
    const log = recorder();
    const wrongAud = await sign(portal.privateKey, { aud: 'ci-hub' });
    expect(await verifyBearer(`Bearer ${wrongAud}`, log)).toEqual(ANONYMOUS);
    expect(log.reason()).toBe('audience_mismatch');
  });

  it('rejects a token from another issuer', async () => {
    const log = recorder();
    const wrongIss = await sign(portal.privateKey, { iss: 'https://evil.example/api/auth' });
    expect(await verifyBearer(`Bearer ${wrongIss}`, log)).toEqual(ANONYMOUS);
    expect(log.reason()).toBe('issuer_mismatch');
  });

  it('rejects a signed token with no sub, rather than owning stories as "undefined"', async () => {
    const log = recorder();
    const noSub = await sign(portal.privateKey, { sub: null });
    expect(await verifyBearer(`Bearer ${noSub}`, log)).toEqual(ANONYMOUS);
    expect(log.reason()).toBe('claim_invalid');
  });

  it('rejects garbage that is not a JWT at all', async () => {
    const log = recorder();
    expect(await verifyBearer('Bearer not-a-token', log)).toEqual(ANONYMOUS);
    expect(log.reason()).toBe('malformed_token');
  });

  it('tells the caller nothing about which check failed', async () => {
    const log = recorder();
    const tokens = [
      await sign(attacker.privateKey),
      await sign(portal.privateKey, { exp: 1 }),
      await sign(portal.privateKey, { aud: 'ci-hub' }),
    ];
    const results = await Promise.all(tokens.map((t) => verifyBearer(`Bearer ${t}`, log)));
    // Identical to the caller...
    for (const r of results) expect(r).toEqual(ANONYMOUS);
    // ...distinguishable in the log.
    expect(new Set(log.lines.map((l) => l.details.reason))).toEqual(
      new Set(['signature_invalid', 'expired', 'audience_mismatch']),
    );
    // And the log never carries the raw credential — only a fingerprint of it.
    for (const l of log.lines) expect(String(l.details.token)).toMatch(/^[0-9a-f]{12}$/);
  });

  it('reuses one cached JWKS across requests instead of refetching per token', async () => {
    // Guards the `jwksCache` map in auth.ts: constructing a remote JWKS per
    // request would put a Portal round-trip in front of every API call and
    // hammer Portal under load.
    const before = jwksHits;
    const log = recorder();
    for (let i = 0; i < 3; i++) await verifyBearer(`Bearer ${await sign(portal.privateKey)}`, log);
    expect(jwksHits).toBe(before);
    expect(before).toBeGreaterThan(0); // ...but it really did fetch once, earlier
  });
});
