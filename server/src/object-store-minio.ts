/**
 * The MinIO-backed `ObjectStore` for the Node API (index.ts).
 *
 * Kept out of object-store.ts so that importing that file's pure helpers does
 * not import the MinIO client. The Cloudflare Worker (worker.ts) uses those
 * helpers and stores media in R2 (object-store-r2.ts); before this split its
 * bundle carried minio and its dependency tree, including query-string 7 and
 * decode-uri-component 0.2.2, without ever constructing a client.
 */

import { Client as MinioClient } from 'minio';

import {
  normaliseContentType,
  objectStoreConfigFromEnv,
  parseEndpoint,
  type ObjectStore,
  type ObjectStoreConfig,
} from './object-store.js';

/** A MinIO-backed store, or null when the environment has not configured one. */
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore | null {
  const result = objectStoreConfigFromEnv(env);
  return result.configured ? minioObjectStore(result.config) : null;
}

export function minioObjectStore(config: ObjectStoreConfig): ObjectStore {
  const { endPoint, port, useSSL } = parseEndpoint(config.endpoint);
  const client = new MinioClient({
    endPoint,
    port,
    useSSL,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    ...(config.region ? { region: config.region } : {}),
  });

  return {
    describe: () => `MinIO bucket "${config.bucket}" at ${config.endpoint}`,
    async put(key, body, contentType) {
      // The size is passed explicitly. With an unknown size the client starts a
      // multipart upload, and a failure part-way through leaves an incomplete
      // upload occupying the bucket until a lifecycle rule reaps it; a single
      // sized PUT either lands or does not.
      await client.putObject(config.bucket, key, body, body.length, { 'Content-Type': contentType });
    },
    async get(key) {
      let stat;
      try {
        stat = await client.statObject(config.bucket, key);
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      const stream = await client.getObject(config.bucket, key);
      return {
        stream,
        size: stat.size,
        // Trust what we recorded at upload time; fall back to a type no browser
        // will ever render as a document rather than guessing from the key.
        contentType: normaliseContentType(stat.metaData?.['content-type']) ?? 'application/octet-stream',
      };
    },
  };
}

/** MinIO reports a missing object as `NoSuchKey`/`NotFound` with a 404 code —
 *  a normal answer for a stale URL, not an outage, so it must not become a 500. */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: string; statusCode?: number } | null;
  return e?.code === 'NoSuchKey' || e?.code === 'NotFound' || e?.statusCode === 404;
}
