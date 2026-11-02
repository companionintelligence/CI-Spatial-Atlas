/**
 * Account deletion from the Atlas sign-in screen, against a server that answers
 * the way Companion Memory does: `GET /authenticate/csrf`, `POST /authenticate`
 * for a bearer token, and `DELETE /account` (204 on success, 400 for an email
 * that does not match, 401 without the account's current bearer).
 *
 * It is a real HTTP server on 127.0.0.1, not a fetch stub, for the reason
 * memory-server.ts gives: the client under test reads real Responses. Sessions
 * live in an in-memory sessionStorage, since this suite has no DOM.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMemoryToken, deleteMemoryAccount, signInToMemory, storedMemoryToken } from '../src/memory/auth.js';

interface FakeAccount {
  email: string;
  password: string;
  token: string;
  deleted: boolean;
  deleteRequests: number;
}

interface FakeAccountServer {
  url: string;
  account: FakeAccount;
  close: () => Promise<void>;
}

async function startFakeAccountServer(): Promise<FakeAccountServer> {
  const account: FakeAccount = {
    email: 'liam@example.com',
    password: 'correct horse',
    token: 'access-1',
    deleted: false,
    deleteRequests: 0,
  };

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      const send = (status: number, payload?: unknown) => {
        if (payload === undefined) {
          res.writeHead(status).end();
          return;
        }
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(payload));
      };
      const body = JSON.parse(raw || '{}') as { username?: string; password?: string; confirmEmail?: string };

      if (req.method === 'GET' && req.url === '/authenticate/csrf') {
        return send(200, { csrfToken: 'csrf-1' });
      }

      if (req.method === 'POST' && req.url === '/authenticate') {
        if (body.username !== account.email || body.password !== account.password) {
          return send(401, { message: 'Invalid credentials' });
        }
        return send(200, { accessToken: account.token });
      }

      if (req.method === 'DELETE' && req.url === '/account') {
        account.deleteRequests += 1;
        if (account.deleted || req.headers.authorization !== `Bearer ${account.token}`) {
          return send(401, { message: 'unauthenticated' });
        }
        if ((body.confirmEmail ?? '').trim().toLowerCase() !== account.email) {
          return send(400, { message: 'Confirmation email does not match this account' });
        }
        account.deleted = true;
        return send(204);
      }

      return send(404, { message: 'not found' });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    account,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A per-tab sessionStorage stand-in: the suite runs in Node, which has none. */
function tabStorage(): Storage {
  const items = new Map<string, string>();

  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => {
      items.delete(key);
    },
    setItem: (key: string, value: string) => {
      items.set(key, String(value));
    },
  };
}

describe('deleting a Companion Memory account from the sign-in screen', () => {
  let server: FakeAccountServer;
  let memoryUrl: string;

  beforeEach(async () => {
    vi.stubGlobal('sessionStorage', tabStorage());
    server = await startFakeAccountServer();
    // The viewer's Memory URL usually ends in /graphql; the auth calls strip it.
    memoryUrl = `${server.url}/graphql`;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await server.close();
  });

  it('deletes with the typed email and leaves the tab signed out', async () => {
    const token = await signInToMemory({ memoryUrl, email: 'liam@example.com', password: 'correct horse' });
    expect(token).toBe('access-1');
    expect(storedMemoryToken(memoryUrl)).toBe('access-1');

    await deleteMemoryAccount({ memoryUrl, accessToken: token, confirmEmail: 'liam@example.com' });

    expect(server.account.deleted).toBe(true);
    expect(storedMemoryToken(memoryUrl)).toBeUndefined();
  });

  it('keeps the sign-in when the typed email does not match, so the person can retry', async () => {
    const token = await signInToMemory({ memoryUrl, email: 'liam@example.com', password: 'correct horse' });

    await expect(
      deleteMemoryAccount({ memoryUrl, accessToken: token, confirmEmail: 'someone@example.com' }),
    ).rejects.toThrow('Confirmation email does not match this account');
    expect(server.account.deleted).toBe(false);
    expect(storedMemoryToken(memoryUrl)).toBe('access-1');
  });

  it('uses the token from the sign-in, not whatever this tab still stores', async () => {
    const token = await signInToMemory({ memoryUrl, email: 'liam@example.com', password: 'correct horse' });
    clearMemoryToken();

    await deleteMemoryAccount({ memoryUrl, accessToken: token, confirmEmail: 'liam@example.com' });

    expect(server.account.deleted).toBe(true);
  });

  it('clears an expired sign-in and says so', async () => {
    const token = await signInToMemory({ memoryUrl, email: 'liam@example.com', password: 'correct horse' });
    // The server rotated the token after this tab signed in.
    server.account.token = 'access-2';

    await expect(
      deleteMemoryAccount({ memoryUrl, accessToken: token, confirmEmail: 'liam@example.com' }),
    ).rejects.toThrow('Your sign-in has expired');
    expect(server.account.deleted).toBe(false);
    expect(storedMemoryToken(memoryUrl)).toBeUndefined();
  });

  it('says when the server cannot be reached and keeps the sign-in', async () => {
    const token = await signInToMemory({ memoryUrl, email: 'liam@example.com', password: 'correct horse' });
    await server.close();

    await expect(
      deleteMemoryAccount({ memoryUrl, accessToken: token, confirmEmail: 'liam@example.com' }),
    ).rejects.toThrow('Couldn’t reach Companion Memory');
    expect(storedMemoryToken(memoryUrl)).toBe('access-1');
  });
});
