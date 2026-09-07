import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Camera } from '@companion-atlas/story';
import { hiddenInEmbed } from './embedMode.js';
import {
  DEFAULT_EMBED_HEIGHT, DEFAULT_EMBED_WIDTH, MAX_EMBED_DIMENSION,
  MIN_EMBED_HEIGHT, MIN_EMBED_WIDTH, embedLink, iframeSnippet, shareLink,
} from './embedUrl.js';
import { copyWithFallback, type ClipboardLike, type CopyStatus } from './clipboard.js';
import './embed.css';

/** Copy — two offset sheets. Not `ShareIcon`, which already means "a link to
 *  this view" on the top bar; these buttons mean "take this text". */
const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.2" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </svg>
);

/** Frame sizes worth offering. 16:9 twice (a blog column and a wide one) and a
 *  4:3 that suits a sidebar; anything else is the custom fields below. */
const PRESETS: { label: string; width: number; height: number }[] = [
  { label: '640 × 360', width: 640, height: 360 },
  { label: '960 × 540', width: DEFAULT_EMBED_WIDTH, height: DEFAULT_EMBED_HEIGHT },
  { label: '800 × 600', width: 800, height: 600 },
];

export interface SharePanelProps {
  open: boolean;
  onClose: () => void;
  /** The app's current absolute URL. Normally `window.location.href`. */
  href: string;
  /** The pose to reopen at — captured when the panel opens, not live. */
  camera?: Camera | null;
  /** The scrubber position to reopen at, epoch ms. */
  timeMs?: number | null;
  /** True when the story came from a Companion Memory connection. */
  privateSource?: boolean;
  /** Story title, for the frame's accessible name. */
  storyTitle?: string;
  /** Injected in tests; defaults to `navigator.clipboard` at call time. */
  clipboard?: ClipboardLike | null;
  /** Injected in tests; defaults to `navigator.platform`, for the ⌘C/Ctrl+C hint. */
  platform?: string;
}

const clamp = (n: number, min: number) => Math.max(min, Math.min(MAX_EMBED_DIMENSION, Math.round(n)));

/**
 * Share this view — as a link, or as an `<iframe>` to paste into a page.
 *
 * Two things this panel refuses to fake:
 *
 *  - **The copy button always reports what happened.** `navigator.clipboard` is
 *    absent outside a secure context and rejects when the document is not
 *    focused, and the app's existing share button swallows both — see
 *    `clipboard.ts`. Here the outcome drives a `role="status"` line, and when
 *    the clipboard is unreachable the text is selected in a field the user can
 *    copy by hand. The fields are readable and selectable at all times, so the
 *    snippet is obtainable even if every copy route fails.
 *  - **A view it cannot honestly embed produces no snippet.** A memory-backed
 *    view gets the explanation instead of an iframe that would render the demo
 *    story to every reader.
 */
export function SharePanel({
  open, onClose, href, camera, timeMs, privateSource, storyTitle, clipboard, platform,
}: SharePanelProps) {
  const [width, setWidth] = useState(DEFAULT_EMBED_WIDTH);
  const [height, setHeight] = useState(DEFAULT_EMBED_HEIGHT);
  const [status, setStatus] = useState<CopyStatus | null>(null);
  const linkRef = useRef<HTMLInputElement>(null);
  const embedRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const link = useMemo(
    () => shareLink({ href, camera, timeMs }),
    [href, camera, timeMs],
  );
  const embed = useMemo(
    () => embedLink({ href, camera, timeMs, privateSource }),
    [href, camera, timeMs, privateSource],
  );
  const snippet = useMemo(
    () => (embed.ok ? iframeSnippet(embed.url, { width, height, title: storyTitle }) : ''),
    [embed, width, height, storyTitle],
  );

  // A confirmation must not outlive what it described. Re-opening the panel, or
  // resizing the frame, invalidates "Embed code copied" — the clipboard now
  // holds a snippet for a different box.
  useEffect(() => { setStatus(null); }, [open, width, height, href]);

  // Escape closes, matching every other overlay in the shell. Bound while open
  // only, so a closed panel never competes for the key.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Move focus into the panel when it opens, so a keyboard user's next Tab is
  // inside it rather than back at the top of the page.
  useEffect(() => { if (open) headingRef.current?.focus(); }, [open]);

  const copy = useCallback(
    async (kind: 'link' | 'embed') => {
      const text = kind === 'link' ? (link.ok ? link.url : '') : snippet;
      if (!text) return;
      const field = kind === 'link' ? linkRef.current : embedRef.current;
      setStatus(await copyWithFallback({
        text,
        label: kind === 'link' ? 'Link' : 'Embed code',
        field,
        clipboard: clipboard !== undefined
          ? clipboard
          : (typeof navigator !== 'undefined' ? (navigator.clipboard as ClipboardLike | undefined) ?? null : null),
        // The only route that works in an insecure context (a LAN dev server on
        // a phone or a headset), which is exactly where an author tries this.
        execCommand: typeof document !== 'undefined' && typeof document.execCommand === 'function'
          ? (cmd) => document.execCommand(cmd)
          : null,
        platform: platform ?? (typeof navigator !== 'undefined' ? navigator.platform : ''),
      }));
    },
    [link, snippet, clipboard, platform],
  );

  if (!open) return null;

  return (
    <aside className="atlas-share" aria-label="Share this view">
      <header className="share-head">
        <h2 className="share-title" ref={headingRef} tabIndex={-1}>Share</h2>
        <button className="share-close" aria-label="Close share" onClick={onClose}>✕</button>
      </header>

      <section className="share-section" aria-labelledby="share-link-label">
        <label className="share-label" id="share-link-label" htmlFor="share-link-field">Link to this view</label>
        <div className="share-row">
          <input
            id="share-link-field"
            ref={linkRef}
            className="share-field"
            readOnly
            value={link.ok ? link.url : ''}
            // Landing on it with Tab selects it, so the manual route is one
            // keystroke rather than a drag.
            onFocus={(e) => e.currentTarget.select()}
          />
          <button className="atlas-btn" disabled={!link.ok} onClick={() => void copy('link')}>
            <CopyIcon />Copy link
          </button>
        </div>
        <p className="share-note">Opens at this camera and this moment. Your Companion Memory address and token are never included.</p>
      </section>

      <section className="share-section" aria-labelledby="share-embed-label">
        <span className="share-label" id="share-embed-label">Embed on a page</span>
        {!embed.ok ? (
          <p className="share-refusal" role="note">{embed.message}</p>
        ) : (
          <>
            <div className="share-sizes" role="group" aria-label="Frame size">
              {PRESETS.map((p) => {
                const active = p.width === width && p.height === height;
                return (
                  <button
                    key={p.label}
                    type="button"
                    className={`share-size${active ? ' active' : ''}`}
                    aria-pressed={active}
                    onClick={() => { setWidth(p.width); setHeight(p.height); }}
                  >
                    {p.label}
                  </button>
                );
              })}
              <label className="share-dim">
                <span>W</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_EMBED_WIDTH}
                  max={MAX_EMBED_DIMENSION}
                  value={width}
                  aria-label="Embed width in pixels"
                  onChange={(e) => setWidth(clamp(Number(e.target.value) || DEFAULT_EMBED_WIDTH, MIN_EMBED_WIDTH))}
                />
              </label>
              <label className="share-dim">
                <span>H</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={MIN_EMBED_HEIGHT}
                  max={MAX_EMBED_DIMENSION}
                  value={height}
                  aria-label="Embed height in pixels"
                  onChange={(e) => setHeight(clamp(Number(e.target.value) || DEFAULT_EMBED_HEIGHT, MIN_EMBED_HEIGHT))}
                />
              </label>
            </div>
            <textarea
              ref={embedRef}
              className="share-field share-snippet"
              readOnly
              rows={9}
              spellCheck={false}
              aria-label="Embed code"
              value={snippet}
              onFocus={(e) => e.currentTarget.select()}
            />
            <div className="share-row">
              <button className="atlas-btn primary" onClick={() => void copy('embed')}>
                <CopyIcon />Copy embed code
              </button>
            </div>
            <p className="share-note">
              The embed is a reading surface: it hides {hiddenInEmbed().join(', ')}, and keeps the globe,
              the timeline and the story.
            </p>
          </>
        )}
      </section>

      {/* One status line for both controls, named by the copy message itself.
          `role="status"` so the outcome is announced, not only seen. */}
      <p className={`share-status${status ? (status.ok ? ' ok' : ' warn') : ''}`} role="status">{status?.text ?? ''}</p>
    </aside>
  );
}
