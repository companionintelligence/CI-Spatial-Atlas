/**
 * A real OIDC issuer, in-process.
 *
 * Spins up a `node:http` server on an ephemeral port serving a JWKS containing
 * one EdDSA public key, and signs tokens with the matching private key — so
 * tests exercise `verifyBearer()` end to end (remote JWKS fetch, `kid`
 * selection, signature, issuer, audience, expiry) instead of hand-building an
 * `AuthContext`.
 *
 * Stubbing `fetch` would not work here: jose's Node build fetches the JWKS with
 * `node:http` / `node:https` directly (jose's `runtime/fetch_jwks` on Node),
 * so a global `fetch` stub is inert. A real listener is the harness.
 *
 * `auth.ts` caches one remote JWKS per URI for the life of the process; each
 * harness binds a fresh ephemeral port, so suites never share cached keys.
 */
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { SignJWT, exportJWK, generateKeyPair, type KeyLike } from 'jose';

export const AUDIENCE = 'companion-atlas';
const KID = 'test-key-1';

export interface TokenOptions {
  sub?: string;
  scope?: string;
  aud?: string;
  iss?: string;
  exp?: string | number;
  email?: string;
  /** Sign with a key the published JWKS does not contain. */
  wrongKey?: boolean;
}

export interface Issuer {
  issuer: string;
  jwksUri: string;
  /** Mint a bearer token; returns the bare token (no `Bearer ` prefix). */
  token(opts?: TokenOptions): Promise<string>;
  /** `Authorization` header value for a token with these options. */
  bearer(opts?: TokenOptions): Promise<string>;
  close(): Promise<void>;
}

/**
 * Start the issuer and point `COMPANION_OIDC_*` at it. Restore the previous env
 * with the returned `close()`.
 */
export async function startIssuer(): Promise<Issuer> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  const other = await generateKeyPair('EdDSA', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: KID, alg: 'EdDSA', use: 'sig' };

  const server: Server = createServer((req, res) => {
    if (!req.url?.endsWith('/jwks')) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const issuer = `http://127.0.0.1:${port}/api/auth`;
  const jwksUri = `${issuer}/jwks`;

  const prev = {
    issuer: process.env.COMPANION_OIDC_ISSUER,
    jwks: process.env.COMPANION_OIDC_JWKS_URI,
    audience: process.env.COMPANION_OIDC_AUDIENCE,
  };
  process.env.COMPANION_OIDC_ISSUER = issuer;
  process.env.COMPANION_OIDC_JWKS_URI = jwksUri;
  process.env.COMPANION_OIDC_AUDIENCE = AUDIENCE;

  const token = async (opts: TokenOptions = {}): Promise<string> => {
    const key: KeyLike = opts.wrongKey ? other.privateKey : privateKey;
    const jwt = new SignJWT({
      ...(opts.scope !== undefined ? { scope: opts.scope } : {}),
      ...(opts.email !== undefined ? { email: opts.email } : {}),
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: KID })
      .setIssuer(opts.iss ?? issuer)
      .setAudience(opts.aud ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m');
    // `sub` is omitted entirely when explicitly passed as an empty string, so a
    // test can mint the subject-less token verifyToken must reject.
    if (opts.sub !== '') jwt.setSubject(opts.sub ?? 'user_alice');
    return jwt.sign(key);
  };

  return {
    issuer,
    jwksUri,
    token,
    bearer: async (opts?: TokenOptions) => `Bearer ${await token(opts)}`,
    async close() {
      restore('COMPANION_OIDC_ISSUER', prev.issuer);
      restore('COMPANION_OIDC_JWKS_URI', prev.jwks);
      restore('COMPANION_OIDC_AUDIENCE', prev.audience);
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
