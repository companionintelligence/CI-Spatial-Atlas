/**
 * The S3-compatible `ObjectStore` for the Node API (index.ts): the MinIO service
 * in the Compose stack, or any S3 endpoint an operator names with S3_ENDPOINT.
 *
 * Kept out of object-store.ts so that importing that file's pure helpers does
 * not load the S3 client. The Cloudflare Worker (worker.ts) uses those helpers
 * and stores media in R2 (object-store-r2.ts), so it never loads this module.
 *
 * This uses the AWS SDK rather than the MinIO JavaScript client. The MinIO
 * client brought query-string 7, stream-json 1 and decode-uri-component 0.2 into
 * the image, and no release on those lines is patched (npm audit, 2026-11-22).
 */

import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';

import {
  normaliseContentType,
  objectStoreConfigFromEnv,
  parseEndpoint,
  type ObjectStore,
  type ObjectStoreConfig,
} from './object-store.js';

/** An S3-backed store, or null when the environment has not configured one. */
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore | null {
  const result = objectStoreConfigFromEnv(env);
  return result.configured ? s3ObjectStore(result.config) : null;
}

export function s3ObjectStore(config: ObjectStoreConfig): ObjectStore {
  const { endPoint, port, useSSL } = parseEndpoint(config.endpoint);
  const client = new S3Client({
    endpoint: `${useSSL ? 'https' : 'http'}://${endPoint}:${port}`,
    region: config.region ?? 'us-east-1',
    // MinIO and most self-hosted S3 stores address the bucket in the path.
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // Send and check checksums only where an operation requires them. Newer SDK
    // releases add checksum trailers by default, and not every S3-compatible
    // store accepts them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    describe: () => `S3 bucket "${config.bucket}" at ${config.endpoint}`,
    async put(key, body, contentType) {
      // The length is passed explicitly. With an unknown size the upload can
      // become multipart, and a failure part-way through leaves an incomplete
      // upload occupying the bucket until a lifecycle rule reaps it; a single
      // sized PUT either lands or does not.
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: contentType,
        }),
      );
    },
    async get(key) {
      let res;
      try {
        res = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
      if (!res.Body || res.ContentLength === undefined) {
        throw new Error(`S3 returned no body or length for ${config.bucket}/${key}`);
      }
      return {
        stream: res.Body as Readable,
        size: res.ContentLength,
        // Trust what we recorded at upload time; fall back to a type no browser
        // will ever render as a document rather than guessing from the key.
        contentType: normaliseContentType(res.ContentType) ?? 'application/octet-stream',
      };
    },
  };
}

/** A missing object is `NoSuchKey` (GET) or `NotFound` (HEAD), a 404: a normal
 *  answer for a stale URL, not an outage, so it must not become a 500. */
function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  return (
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.Code === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}
