import { BrandMark, SlidesIcon } from '../ui/icons.js';
import { appLink } from './embedUrl.js';
import './embed.css';

/** Opens elsewhere — the arrow that says this link leaves the frame. */
const ExternalIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 4h6v6" /><path d="M20 4 11 13" />
    <path d="M18 14v5.5A1.5 1.5 0 0 1 16.5 21h-12A1.5 1.5 0 0 1 3 19.5v-12A1.5 1.5 0 0 1 4.5 6H10" />
  </svg>
);

export interface EmbedBarProps {
  /** The story's title — the only thing naming what the reader is looking at
   *  once the wordmark and the top bar are gone. */
  title?: string;
  /** Whether there is anything to present (the same data question the rail asks). */
  canPresent: boolean;
  onPresent: () => void;
  /** True while the presenter is open, so the bar does not offer to open it again. */
  presenting?: boolean;
  /** The embed's own URL; the "open in Atlas" link is this minus `?embed`. */
  href: string;
}

/**
 * The embed's only chrome.
 *
 * It exists because of what `atlasChrome` takes away. With the rail gone there
 * is no Present button, so the presenter would be mounted, funded, tested — and
 * unreachable, which is the precise failure this codebase keeps repeating. The
 * bar restores exactly one control, plus the two things any embedded artifact
 * owes its reader: what they are looking at, and where it came from.
 *
 * The link opens in a new tab on purpose. Following it in place would replace
 * the story with the full authoring application inside a 960×540 box on someone
 * else's page, with a rail that does not fit and a reader with no way back.
 */
export function EmbedBar({ title, canPresent, onPresent, presenting, href }: EmbedBarProps) {
  return (
    <div className="atlas-embedbar">
      <a
        className="embedbar-brand"
        href={appLink(href)}
        target="_blank"
        rel="noopener noreferrer"
        title="Open this story in Companion Atlas"
      >
        <BrandMark className="embedbar-mark" />
      </a>
      {/* The title is the accessible landmark for the whole embed; without the
          top bar there is nothing else naming the document. */}
      <b className="embedbar-title">{title || 'Companion Atlas'}</b>
      <div className="embedbar-grow" />
      {canPresent && !presenting && (
        <button className="atlas-btn embedbar-play" onClick={onPresent}>
          <SlidesIcon />Play story
        </button>
      )}
      <a
        className="embedbar-out"
        href={appLink(href)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Open in Companion&nbsp;Atlas<ExternalIcon />
      </a>
    </div>
  );
}
