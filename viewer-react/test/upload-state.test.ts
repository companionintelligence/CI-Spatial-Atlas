/**
 * The progress bar's state machine.
 *
 * Small, and worth its own file because progress bars fail in ways that look
 * like the upload failing. Both bugs below have shipped in other codebases and
 * both are invisible in a screenshot of a working case:
 *
 *   • `loaded / total` with `total === 0` is `NaN`, which renders as a bar of
 *     width "NaN%" — an empty track that reads as a stalled transfer. `total` is
 *     0 whenever the length is not computable, which is not rare.
 *   • XHR can fire a final `progress` after `load`. A reducer that accepts it
 *     drags a finished upload back to "99%", and the panel sits there
 *     apparently unfinished beside a media entry that is already attached.
 */
import { describe, expect, it } from 'vitest';

import {
  initialUploadState,
  isUploadBusy,
  percentOf,
  uploadReducer,
  type UploadState,
  type UploadedMedia,
} from '../src/upload/mediaUpload.js';

const media: UploadedMedia = {
  key: 'u/a-0123456789abcdef/00112233445566778899aabbccddeeff.jpg',
  url: 'http://api.test/api/media/o/u/a-0123456789abcdef/00112233445566778899aabbccddeeff.jpg',
  contentType: 'image/jpeg',
  kind: 'image',
  bytes: 8,
};

const run = (actions: Parameters<typeof uploadReducer>[1][], from: UploadState = initialUploadState) =>
  actions.reduce(uploadReducer, from);

describe('percentages are always a number a bar can be drawn from', () => {
  it('is 0 rather than NaN when the length is unknown', () => {
    expect(percentOf(500, 0)).toBe(0);
    expect(percentOf(0, 0)).toBe(0);
    expect(percentOf(Number.NaN, 100)).toBe(0);
  });

  it('never exceeds 100 or drops below 0', () => {
    expect(percentOf(200, 100)).toBe(100);
    expect(percentOf(-5, 100)).toBe(0);
  });

  it('rounds to whole percent', () => {
    expect(percentOf(1, 3)).toBe(33);
  });
});

describe('the upload state machine', () => {
  it('walks idle → uploading → done', () => {
    const state = run([
      { type: 'start', fileName: 'holiday.jpg', total: 100 },
      { type: 'progress', loaded: 50, total: 100 },
      { type: 'done', media },
    ]);
    expect(state).toMatchObject({ phase: 'done', media, fileName: 'holiday.jpg' });
  });

  it('tracks progress as a percentage while uploading', () => {
    const state = run([
      { type: 'start', fileName: 'holiday.jpg', total: 100 },
      { type: 'progress', loaded: 25, total: 100 },
    ]);
    expect(state).toMatchObject({ phase: 'uploading', percent: 25, loaded: 25 });
  });

  it('keeps the size from `start` when a progress event reports none', () => {
    const state = run([
      { type: 'start', fileName: 'holiday.jpg', total: 100 },
      { type: 'progress', loaded: 40, total: 0 },
    ]);
    expect(state).toMatchObject({ phase: 'uploading', percent: 40 });
  });

  it('ignores a progress event that arrives after the upload finished', () => {
    const state = run([
      { type: 'start', fileName: 'holiday.jpg', total: 100 },
      { type: 'done', media },
      { type: 'progress', loaded: 99, total: 100 },
    ]);
    expect(state.phase).toBe('done');
  });

  it('ignores progress after a failure too', () => {
    const state = run([
      { type: 'start', fileName: 'holiday.jpg', total: 100 },
      { type: 'fail', failure: { code: 'network', message: 'no' } },
      { type: 'progress', loaded: 99, total: 100 },
    ]);
    expect(state.phase).toBe('failed');
  });

  it('a failure remembers which file it was about', () => {
    // The panel says "holiday.jpg is too large", not "a file was too large" —
    // which matters the moment somebody picks the wrong one of forty photos.
    const state = run([
      { type: 'start', fileName: 'holiday.jpg', total: 100 },
      { type: 'fail', failure: { code: 'too_large', message: 'too big' } },
    ]);
    expect(state).toMatchObject({ phase: 'failed', fileName: 'holiday.jpg' });
  });

  it('a refusal decided before sending is the same failed state', () => {
    // Client-side and server-side refusals land in one place, so a panel cannot
    // render one kind and silently drop the other.
    const state = uploadReducer(initialUploadState, {
      type: 'fail',
      failure: { code: 'unsupported_type', message: 'not accepted' },
    });
    expect(state).toMatchObject({ phase: 'failed', failure: { code: 'unsupported_type' } });
  });

  it('reset returns to idle from any phase', () => {
    expect(run([{ type: 'done', media }, { type: 'reset' }])).toEqual(initialUploadState);
  });

  it('says when it is busy, so the picker can be disabled and cancel offered', () => {
    expect(isUploadBusy({ phase: 'checking' })).toBe(true);
    expect(isUploadBusy(run([{ type: 'start', fileName: 'a.jpg', total: 1 }]))).toBe(true);
    expect(isUploadBusy({ phase: 'done', media, fileName: 'a.jpg' })).toBe(false);
    expect(isUploadBusy(initialUploadState)).toBe(false);
  });
});
