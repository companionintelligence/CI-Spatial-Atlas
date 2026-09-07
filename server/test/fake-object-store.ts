/**
 * An in-memory `ObjectStore`, so the whole upload surface is testable without
 * MinIO.
 *
 * The alternative — a suite that only runs where a container runs — is a suite
 * that does not run, and the refusal paths (401, 403, 413, 415, 502, 503) are
 * exactly the ones nobody would exercise by hand. `failWith` exists because
 * "the object store is down" is a path with its own status code and its own
 * promise that nothing was stored, and it cannot be reached by unplugging a
 * network in CI.
 */
import { Readable } from 'node:stream';

import type { ObjectStore, StoredObject } from '../src/object-store.js';

export interface FakeObjectStore extends ObjectStore {
  keys(): string[];
  body(key: string): Buffer | undefined;
  /** Make every subsequent `put`/`get` reject with this error. */
  failWith(err: Error | null): void;
}

export function fakeObjectStore(): FakeObjectStore {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let failure: Error | null = null;

  return {
    describe: () => 'in-memory test object store',
    async put(key, body, contentType) {
      if (failure) throw failure;
      objects.set(key, { body: Buffer.from(body), contentType });
    },
    async get(key): Promise<StoredObject | null> {
      if (failure) throw failure;
      const found = objects.get(key);
      if (!found) return null;
      return { stream: Readable.from([found.body]), size: found.body.length, contentType: found.contentType };
    },
    keys: () => [...objects.keys()],
    body: (key) => objects.get(key)?.body,
    failWith: (err) => {
      failure = err;
    },
  };
}
