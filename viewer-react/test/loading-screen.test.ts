/**
 * The loading screen, in two places: the static copy in index.html, which a slow
 * connection shows before the bundle runs, and BootScreen, which the app shows while
 * its story loads. They have to say the same thing, and the icon links have to point
 * at files that ship.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BootScreen } from '../src/ui/BootScreen.js';

const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
const publicFile = (href: string) => fileURLToPath(new URL(`../public${href}`, import.meta.url));

describe('BootScreen', () => {
  it('announces the loading message as a polite status', () => {
    const markup = renderToStaticMarkup(createElement(BootScreen, {}));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('Loading Companion Atlas…');
  });

  it('hides the decorative globe from assistive tech and marks it for the breathing animation', () => {
    const markup = renderToStaticMarkup(createElement(BootScreen, {}));
    expect(markup).toMatch(/<svg[^>]*class="atlas-boot-mark"[^>]*aria-hidden="true"/);
  });

  it('shows the label it is given', () => {
    const markup = renderToStaticMarkup(createElement(BootScreen, { label: 'Reading your memories' }));
    expect(markup).toContain('Reading your memories');
    expect(markup).not.toContain('Loading Companion Atlas');
  });
});

describe('index.html first paint', () => {
  it('shows the same loading message inside #root, as a status', () => {
    expect(html).toMatch(/<div id="root">[\s\S]*role="status"[\s\S]*Loading Companion Atlas…/);
  });

  it('links icon files that ship in public/', () => {
    const hrefs = [...html.matchAll(/<link rel="icon"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(expect.arrayContaining(['/icons/icon.svg', '/icons/icon-192.png']));
    for (const href of hrefs) expect(existsSync(publicFile(href))).toBe(true);
  });
});
