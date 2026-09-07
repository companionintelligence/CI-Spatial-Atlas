/**
 * URL sanitisers for anything that arrives inside a Story document.
 *
 * A story is *untrusted input*. `?story=<url>` loads a JSON document from an
 * arbitrary origin (see `story/useStory.ts`), and CI-Server memories are
 * assembled from third-party imports — so every `href`, `src` and `audioUrl` in
 * a story is attacker-controlled as far as this viewer is concerned. React
 * escapes text, but it does *not* filter URL-bearing props: `<a href={x}>` with
 * `x = "javascript:…"` is a working XSS. These two functions are the only place
 * a story-supplied URL is allowed to become a DOM attribute.
 *
 * Kept DOM-free (no `new URL`, no `document.createElement`) so the rules can be
 * unit-tested in node next to the Markdown reader that calls them.
 */

/** Schemes a *link* may use. `mailto:`/`tel:` are navigations a reader expects
 *  from prose; everything else — `javascript:`, `data:`, `vbscript:`, `file:`,
 *  `blob:`, custom app schemes — is refused. */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

/** Schemes *media* may use. Narrower than links on purpose: `data:` is refused
 *  even for images, because an SVG data URL is a document that can carry script
 *  the moment anything renders it as one (an `<object>`, a new tab, a CSS
 *  `url()`), and no legitimate story needs to inline its media here. */
const MEDIA_SCHEMES = new Set(['http', 'https']);

/**
 * Strip the characters a URL parser ignores but a naive scheme test does not.
 *
 * `java\tscript:alert(1)` and `java\nscript:alert(1)` are live payloads:
 * browsers drop ASCII whitespace and C0 controls while resolving a URL, so the
 * attribute value that fails a `/^javascript:/` test still navigates. Removing
 * them *before* reading the scheme is what closes that gap. It also removes
 * literal spaces, which costs nothing real — a URL with a space in it is
 * already malformed and should have been percent-encoded.
 */
function normalise(raw: string): string {
  // C0 controls, space, DEL, and the zero-width no-break space that
  // browsers also discard. Written with explicit escapes so the rule
  // survives a copy/paste through a tool that eats control characters.
  return raw.replace(/[\u0000-\u0020\u007f\u00a0\u2028\u2029\ufeff]/g, '');
}

const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/;

function allow(raw: string | null | undefined, schemes: Set<string>): string | null {
  if (typeof raw !== 'string') return null;
  const url = normalise(raw);
  if (url === '') return null;
  const m = SCHEME.exec(url);
  // No scheme at all: a relative path, a query, or a `#fragment`. It resolves
  // against the viewer's own origin, so there is nothing to smuggle — and
  // stories bundled with the app (`/stories/…`) legitimately use these.
  if (!m) return url;
  return schemes.has(m[1]!.toLowerCase()) ? url : null;
}

/** Sanitise a hyperlink destination. Returns null when the link must be dropped. */
export function safeHref(raw: string | null | undefined): string | null {
  return allow(raw, LINK_SCHEMES);
}

/** Sanitise an image / audio / video source. Returns null when it must be dropped. */
export function safeMediaUrl(raw: string | null | undefined): string | null {
  return allow(raw, MEDIA_SCHEMES);
}

/**
 * Whether a URL points at something a browser can actually fetch.
 *
 * Real archives are full of `ci-memory://demo/reykjavik.jpg` — an internal
 * address the pipeline resolves, not a URL an `<img>` can load. Rendering one
 * produces a broken-image glyph in the middle of a slide, so the presentation
 * layer treats "not loadable" the same as "absent" and falls back to a tint.
 */
export function isLoadableMedia(raw: string | null | undefined): boolean {
  const u = safeMediaUrl(raw);
  return u != null && (/^https?:/i.test(u) || u.startsWith('/'));
}
