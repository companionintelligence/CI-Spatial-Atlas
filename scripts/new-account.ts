import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface AccountPayload {
  account: {
    name: string;
    createdAt: string;
    updatedAt: string;
  };
}

function normalizeAccountPayload(value: unknown, fallbackName: string, now: string): AccountPayload {
  if (typeof value !== 'object' || value === null) {
    return {
      account: {
        name: fallbackName,
        createdAt: now,
        updatedAt: now
      }
    };
  }

  const record = value as { account?: { createdAt?: unknown } };

  return {
    account: {
      name: fallbackName,
      createdAt: typeof record.account?.createdAt === 'string' ? record.account.createdAt : now,
      updatedAt: now
    }
  };
}

const inputName = process.argv.slice(2).join(' ').trim();
const accountName = inputName || 'earth-operator';

const dbPath = resolve('.ci-earth-account.json');
const now = new Date().toISOString();

let payload: AccountPayload = {
  account: {
    name: accountName,
    createdAt: now,
    updatedAt: now
  }
};

if (existsSync(dbPath)) {
  const current = JSON.parse(readFileSync(dbPath, 'utf-8')) as unknown;
  payload = normalizeAccountPayload(current, accountName, now);
}

writeFileSync(dbPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
console.log(`Account saved: ${accountName}`);