/**
 * What the browser refuses before sending, and what it says when the server
 * refuses instead.
 *
 * Two properties this file exists to hold:
 *
 * 1. **The client's checks are a courtesy, and behave like one.** They save a
 *    doomed transfer; they never decide. So with no capability yet fetched
 *    nothing is refused (the server will judge), an unknown `File.type` is
 *    passed through rather than blocked, and every limit compared against comes
 *    from the server's own answer rather than a constant copied into the
 *    viewer that would drift the first time an operator raises the cap.
 *
 * 2. **A failure names an action.** "Upload failed" is the message that costs
 *    the most time in this codebase: no storage configured, not signed in, file
 *    too big and store-is-down want four different responses from whoever is
 *    reading, and flattening them sends them after the wrong one.
 */
import { describe, expect, it } from 'vitest';

import {
  acceptAttribute,
  describeContentTypes,
  describeFailure,
  formatBytes,
  normaliseContentType,
  validateFile,
  NOT_SIGNED_IN,
  STORAGE_NOT_CONFIGURED,
  type UploadCapability,
} from '../src/upload/mediaUpload.js';

const capability: UploadCapability = {
  configured: true,
  maxBytes: 1024,
  contentTypes: ['image/jpeg', 'image/png', 'video/mp4'],
};

const file = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
  name: 'holiday.jpg',
  size: 512,
  type: 'image/jpeg',
  ...over,
});

describe('what the browser refuses before sending', () => {
  it('accepts a file inside the server’s limits', () => {
    expect(validateFile(file(), capability)).toBeNull();
  });

  it('refuses one over the cap, naming both sizes', () => {
    const refusal = validateFile(file({ size: 4096 }), capability);
    expect(refusal?.code).toBe('too_large');
    expect(refusal?.message).toContain('4 kB');
    expect(refusal?.message).toContain('1 kB');
  });

  it('a file exactly at the cap is accepted, matching the server', () => {
    // Off-by-one here would refuse a file the server takes — a control saying
    // no to something that works is as misleading as one saying yes to
    // something that does not.
    expect(validateFile(file({ size: 1024 }), capability)).toBeNull();
  });

  it('refuses a type the server excluded, and names what it takes', () => {
    const refusal = validateFile(file({ name: 'map.svg', type: 'image/svg+xml' }), capability);
    expect(refusal?.code).toBe('unsupported_type');
    expect(refusal?.message).toContain('JPEG');
  });

  it('refuses an empty file rather than sending zero bytes', () => {
    expect(validateFile(file({ size: 0 }), capability)?.code).toBe('empty');
  });

  it('lets an unknown type through — the server holds the allowlist', () => {
    // Some browsers report nothing for an unfamiliar extension. Refusing here
    // would block a file the server would have accepted, and the user would
    // have no way to find out it was the viewer that said no.
    expect(validateFile(file({ name: 'clip.mov', type: '' }), capability)).toBeNull();
  });

  it('refuses nothing at all before the server has answered', () => {
    expect(validateFile(file({ size: 999_999_999, type: 'application/zip' }), null)).toBeNull();
  });

  it('reports the server’s own reason when storage is off', () => {
    const refusal = validateFile(file(), { configured: false, maxBytes: 0, contentTypes: [], reason: 'S3_BUCKET is unset.' });
    expect(refusal).toEqual({ code: 'not_configured', message: 'S3_BUCKET is unset.' });
  });

  it('falls back to a complete sentence when the server gave no reason', () => {
    const refusal = validateFile(file(), { configured: false, maxBytes: 0, contentTypes: [] });
    expect(refusal?.message).toBe(STORAGE_NOT_CONFIGURED);
    expect(refusal?.message).toContain('S3_ENDPOINT');
  });

  it('normalises a content type with parameters, as the server does', () => {
    expect(normaliseContentType('Image/JPEG; charset=binary')).toBe('image/jpeg');
    expect(validateFile(file({ type: 'Image/JPEG; charset=binary' }), capability)).toBeNull();
    expect(normaliseContentType('not a type')).toBeNull();
  });
});

describe('the file picker offers what the server takes', () => {
  it('builds accept from the server’s allowlist', () => {
    expect(acceptAttribute(capability)).toBe('image/jpeg,image/png,video/mp4');
  });

  it('falls back to something usable before the server has answered', () => {
    expect(acceptAttribute(null)).toBe('image/*,video/*');
  });

  it('describes an allowlist as prose a person can read', () => {
    expect(describeContentTypes(['image/jpeg', 'video/quicktime'])).toBe('JPEG and MOV');
    expect(describeContentTypes(['image/png'])).toBe('PNG');
  });
});

describe('a failure names the thing to do about it', () => {
  it('401 says the viewer has no sign-in, not “upload failed”', () => {
    const failure = describeFailure(401, JSON.stringify({ error: 'unauthenticated' }));
    expect(failure.code).toBe('unauthenticated');
    expect(failure.message).toBe(NOT_SIGNED_IN);
  });

  it('503 carries the server’s operator-actionable message through verbatim', () => {
    // The server knows which variables are unset; re-deriving that here would
    // be a second source of truth that is wrong the first time it changes.
    const body = JSON.stringify({ error: 'storage_not_configured', message: 'S3_ACCESS_KEY, S3_SECRET_KEY are unset.' });
    expect(describeFailure(503, body)).toMatchObject({
      code: 'not_configured',
      message: 'S3_ACCESS_KEY, S3_SECRET_KEY are unset.',
    });
  });

  it('413 and 415 keep the server’s limits rather than restating a guess', () => {
    expect(describeFailure(413, JSON.stringify({ message: 'larger than the 32 MB this server accepts' }))).toMatchObject({
      code: 'too_large',
      message: expect.stringContaining('32 MB'),
    });
    expect(describeFailure(415, JSON.stringify({ message: 'image/svg+xml cannot be uploaded.' })).code).toBe('unsupported_type');
  });

  it('502 is “configured and down”, distinct from “not configured”', () => {
    // The two want different people: one is a retry and then an operator, the
    // other is an operator only. Collapsing them sends users to the wrong one.
    expect(describeFailure(502, '{}').code).toBe('storage_unavailable');
    expect(describeFailure(503, '{}').code).toBe('not_configured');
  });

  it('an unrecognised status is honest rather than confidently wrong', () => {
    const failure = describeFailure(418, JSON.stringify({ error: 'teapot' }));
    expect(failure.code).toBe('unexpected');
    expect(failure.message).toContain('418');
  });

  it('survives a body that is not JSON at all', () => {
    // A proxy or gateway in front of the API answers with HTML; a JSON.parse
    // throwing here would turn a 502 into a blank mystery.
    const failure = describeFailure(502, '<html><body>Bad Gateway</body></html>');
    expect(failure.code).toBe('storage_unavailable');
    expect(failure.message).toContain('media storage');
  });

  it('keeps the status on the failure for a caller that wants to log it', () => {
    expect(describeFailure(413, '{}').status).toBe(413);
  });
});

describe('byte counts read the way the server writes them', () => {
  it('matches the server’s formatting for the values that appear in messages', () => {
    expect(formatBytes(32 * 1024 * 1024)).toBe('32 MB');
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(12)).toBe('12 bytes');
  });
});
