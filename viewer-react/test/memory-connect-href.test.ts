import { describe, expect, it } from 'vitest';

import { memoryConnectHref } from '../src/ui/memoryConnectHref.js';

const PAGE = 'https://atlas.example/?view=abc&memory=https%3A%2F%2Fold.example';

describe('memoryConnectHref', () => {
  it('points ?memory= at the typed address and keeps the rest of the page', () => {
    expect(memoryConnectHref(PAGE, 'https://demo-1.example.ts.net')).toBe(
      'https://atlas.example/?view=abc&memory=https%3A%2F%2Fdemo-1.example.ts.net%2F',
    );
  });

  it('adds the parameter to a page that has none', () => {
    expect(memoryConnectHref('https://atlas.example/', 'https://memory.example.com/api')).toBe(
      'https://atlas.example/?memory=https%3A%2F%2Fmemory.example.com%2Fapi',
    );
  });

  it('accepts a local development address over plain HTTP', () => {
    expect(memoryConnectHref('http://localhost:4174/', 'http://localhost:8787')).toBe(
      'http://localhost:4174/?memory=http%3A%2F%2Flocalhost%3A8787%2F',
    );
  });

  it('trims the typed address', () => {
    expect(memoryConnectHref(PAGE, '  https://memory.example.com  ')).toBe(
      'https://atlas.example/?view=abc&memory=https%3A%2F%2Fmemory.example.com%2F',
    );
  });

  it('refuses anything that is not a web address', () => {
    expect(memoryConnectHref(PAGE, '')).toBeNull();
    expect(memoryConnectHref(PAGE, 'demo-1')).toBeNull();
    expect(memoryConnectHref(PAGE, 'ftp://memory.example.com')).toBeNull();
    expect(memoryConnectHref(PAGE, 'javascript:alert(1)')).toBeNull();
  });
});
