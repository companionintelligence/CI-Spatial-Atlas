import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputName = process.argv.slice(2).join(' ').trim();
const accountName = inputName || 'earth-operator';

const dbPath = resolve('.ci-earth-account.json');
const now = new Date().toISOString();

let payload = {
  account: {
    name: accountName,
    createdAt: now,
    updatedAt: now
  }
};

if (existsSync(dbPath)) {
  const current = JSON.parse(readFileSync(dbPath, 'utf-8'));
  payload = {
    ...current,
    account: {
      name: accountName,
      createdAt: current.account?.createdAt || now,
      updatedAt: now
    }
  };
}

writeFileSync(dbPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
console.log(`Account saved: ${accountName}`);
