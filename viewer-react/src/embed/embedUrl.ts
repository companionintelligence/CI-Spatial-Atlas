/**
 * The embed URL and the snippet an author copies.
 *
 * Two jobs, both pure:
 *
 *  1. Turn "the view I am looking at right now" into a URL that opens there —
 *     which means the camera and the clock have to be *in* the URL, because
 *     Atlas has never put them there (`safeShareUrl` copies `location.href`,
 *     and nothing in the app writes to it). A "copy link to this view" that
 *     does not carry the view is the failure this codebase keeps repeating.
 *  2. Wrap it in an `<iframe>` with attributes that are actually needed, and
 *     escape it so the snippet survives being pasted into an HTML editor.
 *
 * The decode half lives here too, next to the encode half, so the round trip is
 * one file and one test: an encoder without a decoder is a URL that looks right
 * and opens at the default view.
 */
import type { Camera } from '@companion-atlas/story';
import { clampPitchDeg, normalizeHeadingDeg } from '../authoring/camera.js';
import { EMBED_PARAM, stripForSharing } from './embedMode.js';

/** Camera pose. `lat,lon,height,heading,pitch` — see `encodeView`. */
export const VIEW_PARAM = 'view';
/** Clock position, epoch milliseconds. */
export const TIME_PARAM = 't';

/** Default iframe box: 16:9 at a size that still shows a globe and a timeline. */
export const DEFAULT_EMBED_WIDTH = 960;
export const DEFAULT_EMBED_HEIGHT = 540;
/** Below this the timeline and the inspector overlap into nonsense. */
export const MIN_EMBED_WIDTH = 320;
export const MIN_EMBED_HEIGHT = 240;
export const MAX_EMBED_DIMENSION = 4096;

/**
 * The permissions an embedded WebGL globe actually needs — and no more.
 *
 *  - `fullscreen`: the presenter goes full-screen (`theme/presenter.css` sits
 *    above every other layer for exactly that). Without this in `allow`, *and*
 *    the legacy `allowfullscreen` attribute alongside it for older engines, the
 *    request is rejected by the host page and the button does nothing.
 *  - `xr-spatial-tracking`: `rendererForDevice` asks `navigator.xr` whether an
 *    immersive session is possible and mounts the R3F globe if so. Inside a
 *    frame that permission is off by default, so on a headset browser the check
 *    would throw or answer no and the reader would silently get the desktop
 *    globe in a headset.
 *
 * Deliberately absent: `camera`, `microphone`, `geolocation`, `clipboard-write`.
 * Atlas asks for none of them, the embed has no share button to copy from, and
 * an allow-list that grants what is not used is a permission prompt waiting to
 * frighten a reader.
 */
export const EMBED_ALLOW = 'fullscreen; xr-spatial-tracking';

/**
 * `no-referrer`, on purpose.
 *
 * The frame's requests otherwise carry the *host page's* URL — to the Atlas
 * origin, and onward to every imagery and terrain tile server the globe talks
 * to. "Which page was this globe embedded on" is the embedder's business, not
 * a tile CDN's, and nothing in Atlas reads a referrer.
 */
export const EMBED_REFERRER_POLICY = 'no-referrer';

const LONLAT_DP = 5; // ~1 m; finer than a camera pose means anything at.
const HEIGHT_DP = 0;
const ANGLE_DP = 1;

const round = (n: number, dp: number): number => {
  const f = 10 ** dp;
  // `+ 0` collapses `-0`, which stringifies as "-0" and then fails a naive
  // equality check against a re-encoded `0`.
  return Math.round(n * f) / f + 0;
};

/**
 * A `Camera` → the `view` parameter.
 *
 * **Latitude first.** The canonical `Camera` is lon-first, every web map URL
 * ever written is lat-first, and a swapped pair is the classic silent bug: it
 * parses, it flies, and it lands in the Indian Ocean. Latitude first is the
 * form an author can sanity-check against Google Maps at a glance, and
 * `decodeView` rejects |lat| > 90, which catches most swaps outright.
 *
 * Returns null for a camera that cannot be expressed — the caller then simply
 * omits the parameter rather than emitting `view=NaN,NaN,…`, which would decode
 * to nothing and strand the embed at the default view with no clue why.
 */
export function encodeView(camera: Camera | null | undefined): string | null {
  if (!camera) return null;
  const lon = camera.location?.lon ?? camera.lon;
  const lat = camera.location?.lat ?? camera.lat;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat as number) > 90) return null;
  const height = camera.location?.height ?? camera.height ?? camera.range;
  const parts = [
    round(lat as number, LONLAT_DP),
    round(lon as number, LONLAT_DP),
    round(Number.isFinite(height) ? (height as number) : 0, HEIGHT_DP),
    round(normalizeHeadingDeg(camera.heading ?? 0), ANGLE_DP),
    round(clampPitchDeg(camera.pitch ?? -90), ANGLE_DP),
  ];
  return parts.join(',');
}

/**
 * The `view` parameter → a `Camera`, or null when it is not one.
 *
 * Strict on purpose. This value arrives from a URL an arbitrary page wrote, and
 * a partially-believed pose is worse than none: a NaN height passes `Camera`'s
 * own checks and renders as a black screen (the same trap `cameraFromPose`
 * documents). Height is optional in the encoding only in the sense that a
 * missing or zero height falls back to the caller's default framing via
 * `poseFromCamera`, which is what `AtlasApp.flyTo` already uses.
 */
export function decodeView(raw: string | null | undefined): Camera | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const parts = raw.split(',').map((s) => Number(s.trim()));
  // lat,lon are required; height/heading/pitch may be omitted from the tail.
  if (parts.length < 2 || parts.length > 5) return null;
  if (!parts.every((n) => Number.isFinite(n))) return null;
  const [lat, lon, height, heading, pitch] = parts as [number, number, number?, number?, number?];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const camera: Camera = {
    lat: round(lat, LONLAT_DP),
    lon: round(lon, LONLAT_DP),
    heading: round(normalizeHeadingDeg(heading ?? 0), ANGLE_DP),
    pitch: round(clampPitchDeg(pitch ?? -90), ANGLE_DP),
  };
  // A zero height is a camera on the ellipsoid — inside the terrain. Treat it
  // as "unspecified" and let `poseFromCamera` apply its default framing.
  if (Number.isFinite(height) && (height as number) > 0) camera.height = round(height as number, HEIGHT_DP);
  return camera;
}

/** Clock position → the `t` parameter. Epoch ms: it is what the scrubber holds,
 *  and an ISO stamp percent-encodes its colons into an unreadable snippet. */
export function encodeTime(ms: number | null | undefined): string | null {
  if (!Number.isFinite(ms as number)) return null;
  return String(Math.round(ms as number));
}

/** The `t` parameter → epoch ms, or null. */
export function decodeTime(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** The view an embed should restore, read straight off a search string. */
export interface RestoredView {
  camera: Camera | null;
  timeMs: number | null;
}

/**
 * Read `view` and `t` off a URL. The reading half of `embedLink`.
 *
 * Not gated on embed mode: a plain shared link should restore the view too, and
 * the author who copies one is the first person to notice if it does not.
 */
export function restoredView(search: string | URLSearchParams | null | undefined): RestoredView {
  const params = search instanceof URLSearchParams
    ? search
    : new URLSearchParams(typeof search === 'string' ? search : '');
  return { camera: decodeView(params.get(VIEW_PARAM)), timeMs: decodeTime(params.get(TIME_PARAM)) };
}

/** What the author is looking at, as the caller knows it. */
export interface ShareTarget {
  /** The app's current absolute URL — normally `window.location.href`. */
  href: string;
  /** The camera pose to reopen at. */
  camera?: Camera | null;
  /** The scrubber position to reopen at, epoch ms. */
  timeMs?: number | null;
  /**
   * True when the story on screen came from a Companion Memory connection.
   * The caller knows this as `source === 'memory'`.
   */
  privateSource?: boolean;
}

export type ShareLink =
  | { ok: true; url: string }
  | { ok: false; reason: 'private-source' | 'bad-url'; message: string };

/**
 * Why a memory-backed view refuses to become an embed rather than producing one
 * that "works".
 *
 * The credentials are stripped from the URL — they have to be — and Atlas's
 * only other story source is `?story=` or the bundled sample. So the embed of a
 * memory view would boot, connect to nothing, and render the demo Pacific
 * journey under the author's title. Every reader would see fixtures presented
 * as somebody's memories, and the author would have no way to tell, because
 * their own browser has the connection and shows them the real thing.
 *
 * Refusing, with the route to a real answer, is the only honest option.
 */
export const PRIVATE_SOURCE_MESSAGE =
  'This view is loaded from your private Companion Memory. An embed cannot carry that connection, '
  + 'and without it readers would see the bundled demo story instead of yours. Save the journey, '
  + 'download it as .story.json, publish that file, then open Atlas with ?story=<its url> and copy '
  + 'the embed from there.';

const BAD_URL_MESSAGE = 'This page has no shareable address yet.';

/**
 * Put the commas back.
 *
 * `URLSearchParams` percent-encodes `,` even though RFC 3986 lists it as a
 * sub-delimiter that is legal unencoded in a query, and every parser — its own
 * included — reads the two spellings identically. The difference is that
 * `view=64.1466,-21.9426,90000,200,-35` is a pose an author can check against a
 * map at a glance, and `view=64.1466%2C-21.9426%2C90000%2C200%2C-35` is noise
 * three times as long in the one parameter they might want to read.
 */
function readableCommas(url: URL): URL {
  url.search = url.search.replace(/%2C/g, ',');
  return url;
}

function shareBase(target: ShareTarget): URL | null {
  let url: URL;
  try {
    url = new URL(target.href);
  } catch {
    return null;
  }
  stripForSharing(url);
  // Set *or clear*. The href may already carry a `view`/`t` from the link the
  // author opened; leaving a stale one in place when the caller has no pose
  // (the viewer has not settled, say) would hand out a link that claims a view
  // nobody is looking at — a lie that only shows up on the reader's screen.
  const view = encodeView(target.camera);
  if (view) url.searchParams.set(VIEW_PARAM, view);
  else url.searchParams.delete(VIEW_PARAM);
  const t = encodeTime(target.timeMs);
  if (t) url.searchParams.set(TIME_PARAM, t);
  else url.searchParams.delete(TIME_PARAM);
  return url;
}

/**
 * A plain "copy link to this view" URL — credentials stripped, view carried.
 *
 * The existing `safeShareUrl` in `AtlasApp` does half of this (it drops
 * `memory` and `token`); this also drops the OAuth `code`/`state` a link copied
 * straight after sign-in would otherwise publish, and it actually records the
 * view the label promises.
 */
export function shareLink(target: ShareTarget): ShareLink {
  const url = shareBase(target);
  if (!url) return { ok: false, reason: 'bad-url', message: BAD_URL_MESSAGE };
  url.searchParams.delete(EMBED_PARAM);
  return { ok: true, url: readableCommas(url).toString() };
}

/** The same URL, in reading mode — the `src` of the iframe. */
export function embedLink(target: ShareTarget): ShareLink {
  if (target.privateSource) {
    return { ok: false, reason: 'private-source', message: PRIVATE_SOURCE_MESSAGE };
  }
  const url = shareBase(target);
  if (!url) return { ok: false, reason: 'bad-url', message: BAD_URL_MESSAGE };
  url.searchParams.set(EMBED_PARAM, '1');
  return { ok: true, url: readableCommas(url).toString() };
}

/** An embed URL → the full-application URL, for the embed bar's way out. */
export function appLink(href: string): string {
  try {
    const url = new URL(href);
    url.searchParams.delete(EMBED_PARAM);
    return url.toString();
  } catch {
    return href;
  }
}

/**
 * Escape a string for an HTML *attribute value* in double quotes.
 *
 * Both replacements are load-bearing in a snippet. `&` must become `&amp;`
 * because a raw `&story=…` in an `href`/`src` is invalid HTML that some parsers
 * and most CMS editors mangle into an entity — the classic "the embed works on
 * my page but not on theirs". `"` must be escaped because a story title goes
 * into `title="…"`, and a story is untrusted input (see `ui/safeUrl.ts`): a
 * title containing `" onload="…` would otherwise be a snippet the author pastes
 * into their own site, carrying script.
 */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const clampDimension = (n: number | undefined, fallback: number, min: number): number => {
  if (!Number.isFinite(n as number)) return fallback;
  return Math.max(min, Math.min(MAX_EMBED_DIMENSION, Math.round(n as number)));
};

export interface SnippetOptions {
  width?: number;
  height?: number;
  /** Story title, for the frame's accessible name. */
  title?: string;
}

/** The accessible name a frame gets when the story has no usable title. */
export const DEFAULT_EMBED_TITLE = 'Companion Atlas story';

/**
 * The `<iframe>` an author copies.
 *
 * Attribute by attribute, all of them chosen rather than inherited:
 *
 *  - `width`/`height` + `style="border:0"` — a bare iframe has a 2px inset
 *    border in every engine, which frames a dark globe in grey.
 *  - `loading="lazy"` — a Cesium context costs a WebGL context, a tile budget
 *    and tens of megabytes. A globe three screens down a page must not boot
 *    until it is approached, and browsers cap concurrent WebGL contexts, so an
 *    eager one can kill an unrelated canvas elsewhere on the page.
 *  - `referrerpolicy` / `allow` / `allowfullscreen` — see the constants above.
 *  - `title` — an iframe with no accessible name is announced as "frame" and is
 *    a WCAG failure on the *embedder's* page, which they cannot fix from
 *    outside. Naming the story is the least the snippet can do.
 *
 * No `sandbox`. It would have to be `sandbox="allow-scripts allow-same-origin"`
 * for the app to run at all, and that combination is documented by the HTML
 * spec as removing the sandbox — so it would be a reassuring attribute that
 * protects nobody.
 */
export function iframeSnippet(url: string, opts: SnippetOptions = {}): string {
  const width = clampDimension(opts.width, DEFAULT_EMBED_WIDTH, MIN_EMBED_WIDTH);
  const height = clampDimension(opts.height, DEFAULT_EMBED_HEIGHT, MIN_EMBED_HEIGHT);
  const title = (opts.title ?? '').trim() || DEFAULT_EMBED_TITLE;
  return [
    '<iframe',
    `  src="${escapeAttribute(url)}"`,
    `  title="${escapeAttribute(title)}"`,
    `  width="${width}" height="${height}"`,
    '  style="border:0"',
    '  loading="lazy"',
    `  referrerpolicy="${EMBED_REFERRER_POLICY}"`,
    `  allow="${escapeAttribute(EMBED_ALLOW)}"`,
    '  allowfullscreen>',
    '</iframe>',
  ].join('\n');
}
