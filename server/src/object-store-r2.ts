/**
 * R2 object storage for the Cloudflare Worker deployment — the equivalent of
 * `minioObjectStore` (object-store.ts), reached through a Worker binding
 * instead of an S3 client over the network.
 *
 * Deliberately not an implementation of the `ObjectStore` interface in
 * object-store.ts: that interface's `get()` returns a Node `Readable`
 * (`StoredObject.stream`), which an R2 object's body — a Web
 * `ReadableStream` — cannot honestly satisfy without a fake. The Worker
 * route builds its `Response` straight from `R2ObjectBody.body` instead; this
 * module only wraps `put`/`get` against the binding. Every pure helper this
 * needs (key derivation, the content-type allowlist, the upload limits) is
 * reused unchanged from object-store.ts.
 */

export async function r2Put(bucket: R2Bucket, key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  await bucket.put(key, body, { httpMetadata: { contentType } });
}

export async function r2Get(bucket: R2Bucket, key: string) {
  return bucket.get(key);
}
