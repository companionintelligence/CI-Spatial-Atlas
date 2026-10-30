/**
 * What makes the viewer installable, checked against the files that ship: the manifest, the
 * head tags that point at it, the icons it declares, and what the service worker precaches.
 *
 * Chrome offers to install a site only when all of this holds, and says nothing when it does
 * not, so a manifest edited back to `display: browser`, an icon dropped or an offline page
 * that needs a file the worker never stored would otherwise go unnoticed until someone tried
 * to install it. The built bundle is checked separately, by loading it in Chrome and asking
 * `Page.getInstallabilityErrors` (see the PR that added this file).
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const publicFile = (url: string) => here(`../public/${url.replace(/^\//, '')}`);
const read = (path: string) => readFileSync(path, 'utf8');

interface Icon {
  src: string;
  sizes: string;
  type?: string;
  purpose?: string;
}
interface Manifest {
  id?: string;
  name?: string;
  short_name?: string;
  start_url?: string;
  scope?: string;
  display?: string;
  orientation?: string;
  theme_color?: string;
  background_color?: string;
  icons?: Icon[];
}

const manifest: Manifest = JSON.parse(read(publicFile('manifest.webmanifest')));
const indexHtml = read(here('../index.html'));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string) {
  const b = readFileSync(path);
  if (b.length < 24 || b.toString('latin1', 1, 4) !== 'PNG') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const tags = (html: string, name: string) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)?.[1] ?? null;
const meta = (html: string, name: string) => tags(html, 'meta').find((t) => attr(t, 'name') === name);
const link = (html: string, rel: string) => tags(html, 'link').find((t) => attr(t, 'rel') === rel);

const purposes = (icon: Icon) => (icon.purpose ?? 'any').split(/\s+/);

/** A flat stylesheet as selector → property → value, with comments dropped (enough for offline.css). */
function rules(css: string) {
  const out = new Map<string, Map<string, string>>();
  for (const chunk of css.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const open = chunk.lastIndexOf('{');
    if (open === -1) continue;
    const declarations = new Map<string, string>();
    for (const declaration of chunk.slice(open + 1).split(';')) {
      const colon = declaration.indexOf(':');
      if (colon > 0) declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
    out.set(chunk.slice(0, open).trim().replace(/\s+/g, ' '), declarations);
  }
  return out;
}

describe('public/manifest.webmanifest', () => {
  it('is an installable standalone app named for the viewer', () => {
    expect(manifest.name).toBe('Companion Atlas');
    expect(manifest.short_name).toBe('Atlas');
    expect(manifest.display).toBe('standalone');
    // A stable identity that does not depend on start_url, and no orientation lock: a globe is
    // used in both, and on a tablet or a headset a lock is only a restriction.
    expect(manifest.id).toBe('/');
    expect(manifest.orientation).toBeUndefined();
  });

  it('starts inside its own scope', () => {
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url!.startsWith(manifest.scope!)).toBe(true);
  });

  it('declares 192 and 512 icons for any purpose and a 512 maskable one', () => {
    const icons = manifest.icons ?? [];
    expect(icons.some((i) => i.sizes === '192x192' && purposes(i).includes('any'))).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && purposes(i).includes('any'))).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512' && purposes(i).includes('maskable'))).toBe(true);
  });

  it('declares only icons that are real PNGs of the size it says', () => {
    for (const icon of manifest.icons ?? []) {
      const path = publicFile(icon.src);
      expect(existsSync(path), `${icon.src} is not in public/`).toBe(true);
      const size = pngSize(path);
      expect(size, `${icon.src} is not a PNG`).not.toBeNull();
      expect(`${size!.width}x${size!.height}`, `${icon.src} is not ${icon.sizes}`).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
    }
  });
});

describe('index.html', () => {
  it('links the manifest', () => {
    expect(attr(link(indexHtml, 'manifest') ?? '', 'href')).toBe('/manifest.webmanifest');
  });

  it('has a 180x180 apple-touch-icon, the one iOS uses for the home screen', () => {
    const href = attr(link(indexHtml, 'apple-touch-icon') ?? '', 'href');
    expect(href).toBeTruthy();
    expect(pngSize(publicFile(href!))).toEqual({ width: 180, height: 180 });
  });

  it('labels the home-screen icon with the short name and opts in to running as an app', () => {
    expect(attr(meta(indexHtml, 'apple-mobile-web-app-title') ?? '', 'content')).toBe(manifest.short_name);
    expect(attr(meta(indexHtml, 'mobile-web-app-capable') ?? '', 'content')).toBe('yes');
    expect(attr(meta(indexHtml, 'apple-mobile-web-app-capable') ?? '', 'content')).toBe('yes');
  });

  it('keeps viewport-fit=cover and does not lock zoom', () => {
    const viewport = attr(meta(indexHtml, 'viewport') ?? '', 'content') ?? '';
    expect(viewport).toContain('viewport-fit=cover');
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no|maximum-scale/);
  });
});

describe('the colours', () => {
  const require = createRequire(import.meta.url);
  const tokens = read(require.resolve('@companionintelligence/tokens/tokens.css'));
  const tealDeepest = /--teal-950:\s*(#[0-9a-f]{6})/i.exec(tokens)?.[1];

  it('are the canon dark background the app paints, taken from the token, not retyped', () => {
    // src/theme/atlas.css: --atlas-bg is --teal-950, and body paints --atlas-bg.
    expect(read(here('../src/theme/atlas.css'))).toMatch(/--atlas-bg:\s*var\(--teal-950\)/);
    expect(tealDeepest).toBeTruthy();
    expect(manifest.theme_color).toBe(tealDeepest);
    expect(manifest.background_color).toBe(tealDeepest);
  });

  it('are the same in the page head, so the title bar does not change colour when the manifest loads', () => {
    expect(attr(meta(indexHtml, 'theme-color') ?? '', 'content')).toBe(manifest.theme_color);
    expect(attr(meta(read(publicFile('offline/index.html')), 'theme-color') ?? '', 'content')).toBe(manifest.theme_color);
  });

  it('are the canon dark values in the offline stylesheet too, which is copied to dist/ as it is and cannot import tokens', () => {
    // offline.css has the dark theme written out, so read the same four values back from the
    // token layer: a token change then fails here instead of leaving the offline page behind.
    const dark = /\.dark\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? '';
    const token = (name: string) => new RegExp(`(?<![\\w-])${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(dark)?.[1];
    const offline = rules(read(publicFile('offline/offline.css')));

    expect(token('--background')).toBe(tealDeepest);
    expect(offline.get('body')?.get('background')).toBe(token('--background'));
    expect(offline.get('body')?.get('color')).toBe(token('--foreground'));
    expect(offline.get('.retry')?.get('background')).toBe(token('--primary'));
    expect(offline.get('.retry')?.get('color')).toBe(token('--primary-foreground'));
    // The hover and focus states reuse the foreground colour.
    expect(offline.get('.retry:hover')?.get('background')).toBe(token('--foreground'));
    expect(offline.get('.retry:focus-visible')?.get('outline')).toContain(token('--foreground'));
  });
});

describe('public/sw.js and the offline page', () => {
  const source = read(publicFile('sw.js'));
  const offlineUrl = /const OFFLINE_URL = '([^']+)'/.exec(source)?.[1];
  const precache = (/const PRECACHE = \[([^\]]*)\]/.exec(source)?.[1] ?? '')
    .split(',')
    .map((item) => item.trim())
    .map((item) => (item === 'OFFLINE_URL' ? offlineUrl : /^'([^']+)'$/.exec(item)?.[1]))
    .filter((item): item is string => Boolean(item));

  /** A path that ends in / is that folder's index.html. */
  const fileFor = (url: string) => (url.endsWith('/') ? `${url}index.html` : url);

  it('precaches the offline page and only files that exist', () => {
    expect(offlineUrl).toBe('/offline/');
    expect(precache).toContain(offlineUrl);
    for (const url of precache) expect(existsSync(publicFile(fileFor(url))), `${url} is not in public/`).toBe(true);
  });

  it('serves the offline page from a folder, not an .html file, so no host redirects it', () => {
    // Cloudflare Pages and Workers assets answer /offline.html with a redirect to /offline, and
    // a redirected response cannot be used for a navigation.
    for (const url of precache) expect(url).not.toMatch(/\.html$/);
  });

  it('gives the offline page nothing to fetch that the worker has not stored', () => {
    const page = read(publicFile('offline/index.html'));
    const wanted = [...tags(page, 'link').map((t) => attr(t, 'href')), ...tags(page, 'img').map((t) => attr(t, 'src'))].filter(
      (url): url is string => Boolean(url) && url!.startsWith('/')
    );
    expect(wanted.length).toBeGreaterThan(0);
    for (const url of wanted) expect(precache, `${url} is used by the offline page but not precached`).toContain(url);
  });

  it('is a page with no script, that search engines leave alone', () => {
    const page = read(publicFile('offline/index.html'));
    expect(page).not.toMatch(/<script\b/i);
    expect(attr(meta(page, 'robots') ?? '', 'content')).toBe('noindex');
  });
});

describe('where the viewer is served from', () => {
  it('registers the worker from the bundle, not from an inline script in the page', () => {
    expect(read(here('../src/main.tsx'))).toMatch(/import \{ registerServiceWorker \} from '\.\/pwa\/registerServiceWorker\.js'/);
    expect(read(here('../src/main.tsx'))).toMatch(/^registerServiceWorker\(\);$/m);
    expect(indexHtml).not.toMatch(/serviceWorker/);
  });

  // viewer-react/Dockerfile writes nginx's config with printf, so these read that text.
  const dockerfile = read(here('../Dockerfile'));
  const nginxConf = (/^RUN printf '(server \{[^']*)'/m.exec(dockerfile)?.[1] ?? '').replace(/\\n/g, '\n');

  it('keeps shared caches from holding a stale worker in the container image', () => {
    // The one-line rule is `location = /sw.js { add_header Cache-Control "no-cache"; }`.
    expect(dockerfile).toMatch(/location = \/sw\.js \{ add_header Cache-Control "no-cache"; \}/);
  });

  it('serves the manifest as a manifest from the container image, which stock nginx would not', () => {
    // nginx's stock mime.types has no .webmanifest entry, so the file would go out as
    // application/octet-stream. default_type fills in only when no extension matches, and a
    // `types { }` block would replace the whole inherited table, so it is a location rule.
    expect(dockerfile).toMatch(/location = \/manifest\.webmanifest \{ default_type application\/manifest\+json; \}/);
    expect(nginxConf).not.toMatch(/^\s*types\s*\{/m);
  });

  it('writes an nginx config with balanced braces and both exact-match rules ahead of the SPA fallback', () => {
    expect(nginxConf).toContain('server {');
    expect(nginxConf.split('{')).toHaveLength(nginxConf.split('}').length);
    const at = (needle: string) => nginxConf.indexOf(needle);
    expect(at('location = /sw.js')).toBeGreaterThan(-1);
    expect(at('location = /manifest.webmanifest')).toBeGreaterThan(at('location = /sw.js'));
    expect(at('location / {')).toBeGreaterThan(at('location = /manifest.webmanifest'));
  });
});
