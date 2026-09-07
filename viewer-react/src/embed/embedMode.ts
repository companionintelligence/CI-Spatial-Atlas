/**
 * What an embedded Atlas is allowed to be.
 *
 * Atlas has one sharing affordance today — the Import & export panel's share
 * section — and it hands over the *whole application*: the authoring rail, the draw toolbar, the
 * scene editor, the import panel, the scrapbook drawer, and a Save button
 * wired to somebody else's Companion Memory. That is fine for a colleague and
 * wrong for an `<iframe>` on a blog, which is how a published story is actually
 * read.
 *
 * The rule is expressed here, once, as a pure function of the URL parameters,
 * for three reasons:
 *
 *  - It is testable with no DOM and no Cesium. Every other answer to "should
 *    this panel render?" in this codebase is an inline `&&` somewhere in
 *    `AtlasApp`, and a surface that was *meant* to be hidden but was missed is
 *    invisible until someone embeds the thing and finds a Save button in it.
 *  - The caller applies it in one place. `chrome.rail && <Rail …/>` reads as a
 *    statement of policy rather than a condition someone has to reconstruct.
 *  - Adding a surface to the shell forces a decision here, because the record
 *    is exhaustive over `ChromeSurface` and TypeScript will not let a new key
 *    go unanswered.
 *
 * Nothing in this module touches `window`; the caller passes the search string.
 */

/** The switch. `?embed=1` (or a bare `?embed`) puts the shell in reading mode. */
export const EMBED_PARAM = 'embed';

/**
 * Parameters that must never survive into a shared or embedded URL.
 *
 * `memory` is a private Companion Memory address and `token` is a bearer JWT —
 * an iframe `src` lives in the *host page's* HTML, so anything in it is
 * readable by that page, by its readers, by its analytics, and by anyone the
 * page's Referer reaches. `code` and `state` are the OAuth authorization code
 * and CSRF nonce that `auth/portal.ts` reads off the redirect URL; copying a
 * link straight after signing in would otherwise publish a live, single-use
 * credential. All four are stripped on the way out *and* refused on the way in
 * (see `memoryCredentialsAllowed`).
 */
export const CREDENTIAL_PARAMS = ['memory', 'token', 'code', 'state'] as const;

/**
 * Parameters that are not secret but are noise from a failed sign-in
 * (`auth/portal.ts` reads these to show an error). An embed that carried them
 * would open showing an authentication failure that never happened to the
 * reader.
 */
export const TRANSIENT_PARAMS = ['error', 'error_description', 'error_uri'] as const;

/**
 * Every surface of the shell whose presence is a policy decision rather than a
 * data one. "Is there anything to present?" is a data question and stays where
 * it is; "may this reader author?" is this module's.
 */
export type ChromeSurface =
  /** Left icon rail — globe, places, people, scrapbook, search, draw, scenes, present, import, avatar. */
  | 'rail'
  /** Top bar — wordmark, connection chip, and the icon cluster: search, draw,
   *  places toggle, layers, projection. (Share is not here — it is a section of
   *  the Import & export panel, under `interop`.) */
  | 'topBar'
  /** ⌘K palette, including its global key handler. */
  | 'commandPalette'
  /** The drawing toolbar and the pick handler that arms it. */
  | 'drawing'
  /** Scene list + scene editor aside. */
  | 'sceneAuthoring'
  /** Import & export panel, the drop overlay, and the file-drop handler. */
  | 'interop'
  /** Scrapbook drawer and the collected-memory film strip. */
  | 'scrapbook'
  /** The "Collect" button on a memory — writes to the scrapbook draft. */
  | 'collect'
  /** People facet panel. */
  | 'people'
  /** The share/embed panel itself. */
  | 'share'
  /** The globe. */
  | 'globe'
  /** The time scrubber. Without it an embedded 4D story is a still picture. */
  | 'timeline'
  /** The scene presenter — the thing an embed exists to show. */
  | 'presenter'
  /** Memory detail / place card. */
  | 'inspector'
  /** Full-screen media. */
  | 'lightbox'
  /** Stats ribbon, legend, place chip. */
  | 'overlays'
  /** The embed's own strip: title, play, and the way out to the full app. */
  | 'embedBar';

/** An exhaustive answer for every surface. */
export type ChromeDecision = Readonly<Record<ChromeSurface, boolean>> & {
  /** True in embed mode. Kept on the record so callers need one object. */
  readonly embedded: boolean;
};

/**
 * The full application: everything on.
 *
 * `embedBar` is the one surface that is *off* here — its "Open in Companion
 * Atlas" link would point the app at itself.
 */
const APP_CHROME: ChromeDecision = Object.freeze({
  embedded: false,
  rail: true,
  topBar: true,
  commandPalette: true,
  drawing: true,
  sceneAuthoring: true,
  interop: true,
  scrapbook: true,
  collect: true,
  people: true,
  share: true,
  globe: true,
  timeline: true,
  presenter: true,
  inspector: true,
  lightbox: true,
  overlays: true,
  embedBar: false,
// Frozen: `atlasChrome` hands the same object to every caller, so an
// accidental `chrome.rail = true` anywhere would rewrite the policy for the
// whole session rather than for one render.
});

/**
 * The embed: a reading surface.
 *
 * What goes, and why it is not a matter of taste:
 *
 *  - **rail / topBar** — every entry point to authoring hangs off them, and the
 *    top bar carries the avatar and the connection chip, which describe the
 *    *author's* session and mean nothing to a stranger.
 *  - **drawing / sceneAuthoring / interop** — writing tools. The import panel
 *    also holds "Save to Memory" and the memory transfer, i.e. writes against a
 *    connection an embed must not have in the first place — and, since sharing
 *    moved into it, the control that would offer a reader a link to a view they
 *    do not own.
 *  - **scrapbook / collect / people** — the scrapbook is per-browser state
 *    (`useScrapbook` persists to local storage), so a reader collecting inside
 *    an iframe would be filling a draft they can never save, curate or open.
 *    A control that appears to work and goes nowhere is worse than no control.
 *  - **commandPalette** — ⌘K is a global key handler; an iframe swallowing the
 *    host page's shortcut is hostile.
 *  - **share** — the panel the control above opens. Off for the same reason,
 *    and kept as its own key because the trigger and the panel are separate
 *    decisions: `AtlasApp` passes `onShare` only when this is true, so the
 *    button cannot open something that was never mounted.
 *
 * What stays, because without it there is no reason to embed:
 *
 *  - **globe, timeline, presenter, inspector, lightbox, overlays** — the story
 *    itself, in time, with its scenes, and the ability to look at one memory
 *    and its photo. An embed with no timeline is a screenshot.
 *  - **embedBar** — with the rail gone there is no Present button, so the
 *    presenter would be mounted and unreachable; the bar is what makes it
 *    reachable, and it carries the link back to the full app.
 */
const EMBED_CHROME: ChromeDecision = Object.freeze({
  embedded: true,
  rail: false,
  topBar: false,
  commandPalette: false,
  drawing: false,
  sceneAuthoring: false,
  interop: false,
  scrapbook: false,
  collect: false,
  people: false,
  share: false,
  globe: true,
  timeline: true,
  presenter: true,
  inspector: true,
  lightbox: true,
  overlays: true,
  embedBar: true,
});

/** Normalise whatever the caller has — a search string, a parsed set, nothing. */
function toParams(search: string | URLSearchParams | null | undefined): URLSearchParams {
  if (search instanceof URLSearchParams) return search;
  if (typeof search !== 'string') return new URLSearchParams();
  return new URLSearchParams(search);
}

/**
 * Read a flag that may legitimately be present with no value.
 *
 * `?embed` and `?embed=1` both mean yes; `?embed=0` and `?embed=false` mean no.
 * The explicit "off" spellings matter because they are how someone debugging an
 * embed turns the chrome back on without editing the rest of a long URL.
 */
export function flagIsOn(raw: string | null): boolean {
  if (raw === null) return false;
  const v = raw.trim().toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/** Is this URL asking for the embedded reading surface? */
export function isEmbedded(search: string | URLSearchParams | null | undefined): boolean {
  return flagIsOn(toParams(search).get(EMBED_PARAM));
}

/**
 * **The predicate.** Which surfaces of the shell may render, for this URL.
 *
 * Apply it once, at the top of `AtlasApp`, and gate each surface on its key.
 */
export function atlasChrome(search: string | URLSearchParams | null | undefined): ChromeDecision {
  return isEmbedded(search) ? EMBED_CHROME : APP_CHROME;
}

/**
 * Whether `?memory=` / `?token=` may be honoured at all.
 *
 * This is the explicit decision the embed forces, and it is a security one
 * rather than a cosmetic one. An iframe's `src` is written by the *embedding*
 * page, so in embed mode every query parameter is attacker-supplied: a page
 * that embeds `…/?embed=1&memory=https://evil.example&token=…` would otherwise
 * get an Atlas that queries an arbitrary server, with credentials, inside a
 * frame the attacker controls. An embed therefore never accepts a memory
 * connection from its URL — it renders `?story=` (a public document) or the
 * bundled sample, and nothing else.
 *
 * Note the deliberate limit: this governs *URL* credentials only. A deployment
 * that hard-codes `VITE_MEMORY_URL` / `VITE_MEMORY_TOKEN` into its build has
 * chosen to serve that data from that origin, and hiding it from the embed
 * would be theatre — the same build serves it unembedded at the same URL.
 * An operator who does not want that must not build those vars in.
 */
export function memoryCredentialsAllowed(search: string | URLSearchParams | null | undefined): boolean {
  return !isEmbedded(search);
}

/**
 * Remove everything that must not travel, in place, and return the same URL.
 *
 * Used for both halves of sharing — the plain "copy link" and the embed `src` —
 * because the two leak identically and only one of them was ever guarded.
 */
export function stripForSharing(url: URL): URL {
  for (const p of CREDENTIAL_PARAMS) url.searchParams.delete(p);
  for (const p of TRANSIENT_PARAMS) url.searchParams.delete(p);
  return url;
}

/**
 * Human names for the surfaces, so the share panel can *tell* the author what
 * an embed hides.
 *
 * Derived from the decision below rather than written out beside it. A
 * hand-kept list is a promise that rots the first time a surface changes side,
 * and "the embed hides the scrapbook" printed next to an embed that shows the
 * scrapbook is worse than saying nothing.
 */
const SURFACE_LABELS: Partial<Record<ChromeSurface, string>> = {
  rail: 'the navigation rail',
  topBar: 'the top bar and account',
  drawing: 'drawing tools',
  sceneAuthoring: 'the scene editor',
  interop: 'import and export',
  scrapbook: 'the scrapbook',
  people: 'the people panel',
  commandPalette: 'search',
};

/** The named surfaces the app shows and an embed does not, in reading order. */
export function hiddenInEmbed(): string[] {
  return (Object.keys(SURFACE_LABELS) as ChromeSurface[])
    .filter((k) => APP_CHROME[k] && !EMBED_CHROME[k])
    .map((k) => SURFACE_LABELS[k]!);
}

/** True when any credential is present — the reason a view cannot be embedded as-is. */
export function carriesCredentials(search: string | URLSearchParams | null | undefined): boolean {
  const params = toParams(search);
  return CREDENTIAL_PARAMS.some((p) => params.get(p) !== null);
}
