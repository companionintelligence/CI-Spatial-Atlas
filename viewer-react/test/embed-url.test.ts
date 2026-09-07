/**
 * The embed URL and the snippet.
 *
 * The interesting failures here are all silent ones: a view parameter written
 * but never read (so the embed opens at the default camera), a lat/lon swap
 * (so it opens in the Indian Ocean), a raw `&` in an attribute (so the snippet
 * works on the author's page and breaks on the reader's), and a token that
 * survives into an iframe `src` on someone else's site.
 */
import { describe, expect, it } from 'vitest';
import type { Camera } from '@companion-atlas/story';
import { poseFromCamera } from '../src/authoring/camera.js';
import {
  DEFAULT_EMBED_HEIGHT, DEFAULT_EMBED_TITLE, DEFAULT_EMBED_WIDTH,
  EMBED_ALLOW, EMBED_REFERRER_POLICY, MAX_EMBED_DIMENSION, MIN_EMBED_WIDTH,
  appLink, decodeTime, decodeView, embedLink, encodeTime, encodeView,
  escapeAttribute, iframeSnippet, restoredView, shareLink,
} from '../src/embed/embedUrl.js';

const REYKJAVIK: Camera = { lat: 64.1466, lon: -21.9426, height: 90_000, heading: 200, pitch: -35 };
const HREF = 'https://atlas.example/?story=%2Fstories%2Fsample.json';

describe('the view parameter', () => {
  it('round-trips a camera', () => {
    const encoded = encodeView(REYKJAVIK)!;
    const back = decodeView(encoded)!;
    expect(back.lat).toBeCloseTo(64.1466, 4);
    expect(back.lon).toBeCloseTo(-21.9426, 4);
    expect(back.height).toBe(90_000);
    expect(back.heading).toBe(200);
    expect(back.pitch).toBe(-35);
  });

  it('writes latitude first, the way every map URL does', () => {
    // The canonical `Camera` is lon-first and every web map URL is lat-first.
    // A swap parses, flies, and lands in the ocean — so the order is asserted
    // rather than assumed, and `decodeView` rejects |lat| > 90 to catch most
    // swaps that reach it from elsewhere.
    expect(encodeView(REYKJAVIK)!.startsWith('64.1466,-21.9426')).toBe(true);
    expect(decodeView('-21.9426,64.1466')).not.toBeNull(); // a legal, if wrong, pair
    expect(decodeView('120,10')).toBeNull();               // not a latitude
    expect(decodeView('10,200')).toBeNull();               // not a longitude
  });

  it('reads the Atlas nested camera form as well as the flat one', () => {
    // A scene's camera can legally carry `location` instead of lon/lat — see
    // `poseFromCamera`. Reading only one spelling would drop the view for half
    // the corpus with no error.
    const nested: Camera = { location: { lon: 12.5, lat: 41.9, height: 4000 }, heading: 90, pitch: -60 };
    const back = decodeView(encodeView(nested)!)!;
    expect(back.lat).toBeCloseTo(41.9, 4);
    expect(back.lon).toBeCloseTo(12.5, 4);
    expect(back.height).toBe(4000);
  });

  it('refuses a camera it cannot express rather than writing NaN', () => {
    // `view=NaN,NaN` decodes to nothing and strands the embed at the default
    // view with no clue why; omitting the parameter at least fails honestly.
    expect(encodeView(null)).toBeNull();
    expect(encodeView({ lat: Number.NaN, lon: 3 })).toBeNull();
    expect(encodeView({ lon: 3 } as Camera)).toBeNull();
  });

  it('refuses malformed input from a URL somebody else wrote', () => {
    for (const bad of ['', 'nonsense', '64.1', '1,2,3,4,5,6', '64,-21,abc']) {
      expect(decodeView(bad), bad).toBeNull();
    }
    expect(decodeView(null)).toBeNull();
  });

  it('drops a zero height so the camera is not placed inside the terrain', () => {
    // A `Camera` with height 0 sits on the ellipsoid — the reader would open
    // looking at the inside of a mountain. Leaving it unset lets
    // `poseFromCamera` apply the framing `AtlasApp.flyTo` already uses.
    const decoded = decodeView('64.1466,-21.9426,0,10,-40')!;
    expect(decoded.height).toBeUndefined();
    expect(poseFromCamera(decoded)!.height).toBe(1_800_000);
  });

  it('produces a pose the existing camera code can fly to', () => {
    // The point of the round trip: what comes out has to be usable by the
    // function `AtlasApp` already calls, or the parameter is decoration.
    const pose = poseFromCamera(decodeView(encodeView(REYKJAVIK)!))!;
    expect(pose.latitude).toBeCloseTo((64.1466 * Math.PI) / 180, 6);
    expect(pose.height).toBe(90_000);
  });

  it('normalises a heading and clamps a pitch beyond the gimbal', () => {
    const c = decodeView('10,10,5000,-90,-140')!;
    expect(c.heading).toBe(270);
    expect(c.pitch).toBe(-90);
  });
});

describe('the time parameter', () => {
  it('round-trips the scrubber position', () => {
    expect(decodeTime(encodeTime(1_559_600_000_000)!)).toBe(1_559_600_000_000);
  });

  it('refuses anything that is not a number', () => {
    expect(encodeTime(Number.NaN)).toBeNull();
    expect(encodeTime(null)).toBeNull();
    expect(decodeTime('yesterday')).toBeNull();
    expect(decodeTime('')).toBeNull();
  });
});

describe('reading a view back off a URL', () => {
  it('recovers both halves', () => {
    const { url } = shareLink({ href: HREF, camera: REYKJAVIK, timeMs: 1_559_600_000_000 }) as { url: string };
    const restored = restoredView(new URL(url).search);
    expect(restored.camera!.lat).toBeCloseTo(64.1466, 4);
    expect(restored.timeMs).toBe(1_559_600_000_000);
  });

  it('answers with nulls for a plain URL rather than throwing', () => {
    expect(restoredView('')).toEqual({ camera: null, timeMs: null });
    expect(restoredView(undefined)).toEqual({ camera: null, timeMs: null });
  });
});

describe('the share link', () => {
  it('carries the view, which is what the label has always promised', () => {
    const link = shareLink({ href: HREF, camera: REYKJAVIK, timeMs: 1_559_600_000_000 });
    expect(link.ok).toBe(true);
    const u = new URL((link as { url: string }).url);
    expect(u.searchParams.get('view')).toBe('64.1466,-21.9426,90000,200,-35');
    expect(u.searchParams.get('t')).toBe('1559600000000');
    expect(u.searchParams.get('story')).toBe('/stories/sample.json');
  });

  it('strips credentials, including the ones the old share button kept', () => {
    const link = shareLink({
      href: 'https://atlas.example/?memory=https%3A%2F%2Fm.example&token=jwt&code=abc&state=xyz',
    }) as { url: string };
    expect(link.url).not.toContain('token');
    expect(link.url).not.toContain('memory');
    expect(link.url).not.toContain('code=');
    expect(link.url).not.toContain('state=');
  });

  it('never hands back an embed URL', () => {
    // Copying the plain link while looking at an embed must give the full app,
    // not another embed.
    const link = shareLink({ href: 'https://atlas.example/?embed=1&story=/s.json' }) as { url: string };
    expect(new URL(link.url).searchParams.get('embed')).toBeNull();
  });

  it('clears a stale view rather than handing out one nobody is looking at', () => {
    // The author opened a link that already carried a pose. If the caller has
    // no camera to offer — the viewer has not settled yet — the old one must go,
    // or the copied link claims a view that is not on screen, which only shows
    // up on the reader's side.
    const link = shareLink({
      href: 'https://atlas.example/?story=/s.json&view=1,2,3000,0,-45&t=99',
      camera: null,
      timeMs: null,
    }) as { url: string };
    const u = new URL(link.url);
    expect(u.searchParams.get('view')).toBeNull();
    expect(u.searchParams.get('t')).toBeNull();
    expect(u.searchParams.get('story')).toBe('/s.json');
  });

  it('reports a URL it cannot parse instead of pretending', () => {
    const link = shareLink({ href: 'not a url' });
    expect(link.ok).toBe(false);
  });
});

describe('the embed link', () => {
  it('turns the switch on and keeps the view', () => {
    const link = embedLink({ href: HREF, camera: REYKJAVIK }) as { url: string };
    const u = new URL(link.url);
    expect(u.searchParams.get('embed')).toBe('1');
    expect(u.searchParams.get('view')).toContain('64.1466');
  });

  it('refuses a memory-backed view rather than embedding the demo story', () => {
    // Without the connection the embed would boot, connect to nothing, and show
    // the bundled Pacific journey under the author's title — to every reader,
    // invisibly to the author, whose own browser has the real data.
    const link = embedLink({ href: HREF, camera: REYKJAVIK, privateSource: true });
    expect(link.ok).toBe(false);
    expect((link as { reason: string }).reason).toBe('private-source');
    expect((link as { message: string }).message).toContain('?story=');
  });

  it('takes an embed URL back to the full application', () => {
    expect(appLink('https://atlas.example/?embed=1&story=/s.json'))
      .toBe('https://atlas.example/?story=%2Fs.json');
    // A href it cannot parse comes back unchanged rather than throwing — the
    // embed bar's link is not worth crashing an embed over.
    expect(appLink('not a url')).toBe('not a url');
  });
});

describe('the snippet', () => {
  const url = 'https://atlas.example/?story=%2Fs.json&embed=1&view=64.1,-21.9,90000,0,-45';

  it('escapes the ampersands, which is what breaks it on other people’s pages', () => {
    // A raw `&` in an attribute is invalid HTML; plenty of editors and parsers
    // silently mangle it into an entity, which is the classic "the embed works
    // for me" bug. The escaped form is what every browser round-trips.
    const html = iframeSnippet(url);
    expect(html).toContain('&amp;embed=1');
    // Every ampersand inside the src is an entity, not a bare one.
    const src = /src="([^"]*)"/.exec(html)![1]!;
    expect(src.split('&').length - 1).toBe(src.split('&amp;').length - 1);
    expect(src).toContain('view=64.1,-21.9');
  });

  it('cannot be turned into an injection by a story title', () => {
    // A story is untrusted input (see ui/safeUrl.ts), and this snippet is
    // pasted straight into the author's own site.
    const html = iframeSnippet(url, { title: 'Trip" onload="alert(1)' });
    expect(html).toContain('title="Trip&quot; onload=&quot;alert(1)"');
    expect(html).not.toContain('onload="alert');
  });

  it('names the frame even when the story has none', () => {
    // An unnamed iframe is announced as "frame" and is a WCAG failure on the
    // embedder's page, which they cannot fix from outside.
    expect(iframeSnippet(url)).toContain(`title="${DEFAULT_EMBED_TITLE}"`);
    expect(iframeSnippet(url, { title: '   ' })).toContain(`title="${DEFAULT_EMBED_TITLE}"`);
  });

  it('carries the attributes an embedded WebGL globe needs', () => {
    const html = iframeSnippet(url);
    // Fullscreen twice: `allow` for the permissions policy, `allowfullscreen`
    // for engines that still only honour the legacy attribute. Without both,
    // the presenter's fullscreen button does nothing on the host page.
    expect(html).toContain(`allow="${EMBED_ALLOW}"`);
    expect(html).toContain('allowfullscreen');
    expect(EMBED_ALLOW).toContain('xr-spatial-tracking');
    // Lazy, because a Cesium context is a WebGL context and browsers cap them.
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(`referrerpolicy="${EMBED_REFERRER_POLICY}"`);
    expect(html).toContain('style="border:0"');
  });

  it('asks for no permission Atlas does not use', () => {
    // An allow-list that grants what is not used is a permission prompt waiting
    // to frighten a reader.
    for (const unused of ['camera', 'microphone', 'geolocation', 'payment', 'clipboard']) {
      expect(EMBED_ALLOW).not.toContain(unused);
    }
  });

  it('uses the default box, and clamps a nonsensical one', () => {
    expect(iframeSnippet(url)).toContain(`width="${DEFAULT_EMBED_WIDTH}" height="${DEFAULT_EMBED_HEIGHT}"`);
    expect(iframeSnippet(url, { width: 10, height: 10 })).toContain(`width="${MIN_EMBED_WIDTH}"`);
    expect(iframeSnippet(url, { width: 99_999, height: 99_999 })).toContain(`width="${MAX_EMBED_DIMENSION}"`);
    expect(iframeSnippet(url, { width: Number.NaN })).toContain(`width="${DEFAULT_EMBED_WIDTH}"`);
  });

  it('is one well-formed element', () => {
    const html = iframeSnippet(url);
    expect(html.startsWith('<iframe')).toBe(true);
    expect(html.trimEnd().endsWith('</iframe>')).toBe(true);
    expect(html.match(/<iframe/g)).toHaveLength(1);
  });
});

describe('attribute escaping', () => {
  it('handles the four characters that matter, and the ampersand first', () => {
    // Order is load-bearing: escaping `<` before `&` would produce `&amp;lt;`.
    expect(escapeAttribute('a & b "c" <d>')).toBe('a &amp; b &quot;c&quot; &lt;d&gt;');
  });
});
