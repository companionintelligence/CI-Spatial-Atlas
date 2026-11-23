import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { s3ObjectStore } from '../src/object-store-s3.js';

/**
 * A stand-in for a path-style S3 endpoint: just enough of the protocol to show
 * that the store sends a sized PUT, reads the object back with its type and
 * length, and maps a missing key to null. Signatures are not checked here; a
 * run against a real MinIO is where the SDK's signing is proven.
 */
describe('s3ObjectStore against an S3-shaped endpoint', () => {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      void handle(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Path-style: /<bucket>/<key...>
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const key = path.replace(/^\/[^/]+\//, '');
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      objects.set(key, { body: Buffer.concat(chunks), contentType: String(req.headers['content-type'] ?? '') });
      res.writeHead(200, { ETag: '"test"' }).end();
      return;
    }
    if (req.method === 'GET') {
      const object = objects.get(key);
      if (!object) {
        const xml =
          '<?xml version="1.0" encoding="UTF-8"?><Error><Code>NoSuchKey</Code>' +
          '<Message>The specified key does not exist.</Message></Error>';
        res.writeHead(404, { 'Content-Type': 'application/xml', 'Content-Length': Buffer.byteLength(xml) }).end(xml);
        return;
      }
      res
        .writeHead(200, { 'Content-Type': object.contentType, 'Content-Length': object.body.length })
        .end(object.body);
      return;
    }
    res.writeHead(405).end();
  }

  const store = () =>
    s3ObjectStore({
      endpoint,
      accessKey: 'test-access',
      secretKey: 'test-secret',
      bucket: 'atlas',
    });

  it('stores a sized object and reads it back with its type and length', async () => {
    const body = Buffer.from('a small test image, byte for byte');
    await store().put('media/test.png', body, 'image/png');

    const got = await store().get('media/test.png');
    expect(got).not.toBeNull();
    expect(got!.size).toBe(body.length);
    expect(got!.contentType).toBe('image/png');

    const chunks: Buffer[] = [];
    for await (const chunk of got!.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).equals(body)).toBe(true);
  });

  it('answers null for a missing key, so the route can say 404 rather than 500', async () => {
    expect(await store().get('media/absent.png')).toBeNull();
  });

  it('describes the bucket without the secret', () => {
    const described = store().describe();
    expect(described).toContain('atlas');
    expect(described).not.toContain('test-secret');
  });
});
