/**
 * The startup gate around the dev auth bypass.
 *
 * With `COMPANION_OIDC_ISSUER` unset, Atlas runs every request as one dev
 * subject with `*` scope. That is intentional (docs/INTEGRATION.md Mode A) and
 * auth.test.ts pins the behaviour. What this file pins is the *other* half of
 * the deal: that the state cannot be entered by accident in a deployed
 * environment, and is never entered quietly.
 */
import { describe, expect, it } from 'vitest';

import { assertAuthStartup, classifyAuthFailure } from '../src/auth.js';

/** Captures banner output; `assertAuthStartup` takes both env and logger. */
function recorder() {
  const lines: Array<{ details: Record<string, unknown>; message: string }> = [];
  return {
    lines,
    warn: (details: Record<string, unknown>, message: string) => void lines.push({ details, message }),
    error: (details: Record<string, unknown>, message: string) => void lines.push({ details, message }),
    text: () => lines.map((l) => l.message).join('\n'),
  };
}

describe('assertAuthStartup', () => {
  it('reports OIDC mode and the trusted issuer when configured', () => {
    const log = recorder();
    const report = assertAuthStartup(
      { COMPANION_OIDC_ISSUER: 'https://hub.ci.computer/api/auth', NODE_ENV: 'production' },
      log,
    );
    expect(report).toEqual({
      mode: 'oidc',
      issuer: 'https://hub.ci.computer/api/auth',
      jwksUri: 'https://hub.ci.computer/api/auth/jwks',
      audience: ['companion-atlas'],
    });
    // Which issuer this box trusts must be visible in the log, not just returned.
    expect(log.lines.at(-1)?.details.issuer).toBe('https://hub.ci.computer/api/auth');
  });

  it('refuses to start with no issuer under NODE_ENV=production', () => {
    const log = recorder();
    expect(() => assertAuthStartup({ NODE_ENV: 'production' }, log)).toThrow(/refusing to start/i);
    // The operator must be told which knob is missing, not just that it failed.
    expect(log.text()).toContain('COMPANION_OIDC_ISSUER');
  });

  it.each(['prod', 'staging'])('refuses to start with no issuer under ATLAS_ENV=%s', (env) => {
    expect(() => assertAuthStartup({ ATLAS_ENV: env }, recorder())).toThrow(/refusing to start/i);
  });

  it('refuses to start with no issuer under COMPANION_ENV=production', () => {
    expect(() => assertAuthStartup({ COMPANION_ENV: 'production' }, recorder())).toThrow(/refusing to start/i);
  });

  it('allows the bypass in production only when explicitly overridden, and still shouts', () => {
    const log = recorder();
    const report = assertAuthStartup(
      { NODE_ENV: 'production', ATLAS_ALLOW_INSECURE_AUTH: '1', ATLAS_DEV_SUBJECT: 'demo-box' },
      log,
    );
    expect(report).toEqual({ mode: 'insecure-dev', subject: 'demo-box' });
    expect(log.text()).toContain('*** AUTH DISABLED ***');
  });

  it('permits the bypass in local dev, with a loud banner naming the dev subject', () => {
    const log = recorder();
    const report = assertAuthStartup({ NODE_ENV: 'development' }, log);
    expect(report).toEqual({ mode: 'insecure-dev', subject: 'dev-operator' });
    expect(log.text()).toContain('*** AUTH DISABLED ***');
    expect(log.text()).toContain('dev-operator');
  });

  it('treats a completely empty env as local dev, not as production', () => {
    // Nothing set at all is the "someone ran node dist/index.js by hand" case:
    // annoying to break, and not the accident the gate is aimed at.
    expect(assertAuthStartup({}, recorder()).mode).toBe('insecure-dev');
  });
});

describe('classifyAuthFailure', () => {
  // Matched on `code`, not `instanceof` — see the comment in auth.ts. These
  // cases are the contract that keeps the server log readable.
  it('maps jose error codes to distinct reasons', () => {
    expect(classifyAuthFailure({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' })).toBe('signature_invalid');
    expect(classifyAuthFailure({ code: 'ERR_JWT_EXPIRED', claim: 'exp' })).toBe('expired');
    expect(classifyAuthFailure({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'aud' })).toBe('audience_mismatch');
    expect(classifyAuthFailure({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'iss' })).toBe('issuer_mismatch');
    expect(classifyAuthFailure({ code: 'ERR_JWT_CLAIM_VALIDATION_FAILED', claim: 'nbf' })).toBe('not_yet_valid');
    expect(classifyAuthFailure({ code: 'ERR_JWKS_NO_MATCHING_KEY' })).toBe('jwks_unavailable');
    expect(classifyAuthFailure(new Error('boom'))).toBe('unknown');
    expect(classifyAuthFailure(undefined)).toBe('unknown');
  });
});
