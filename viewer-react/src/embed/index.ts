/**
 * Embedding — one import for the shell.
 *
 * `atlasChrome(window.location.search)` is the whole policy; everything else
 * here serves the two controls that policy implies (a snippet to copy, and a
 * bar that keeps the presenter reachable once the rail is gone).
 */
export {
  EMBED_PARAM, CREDENTIAL_PARAMS, TRANSIENT_PARAMS,
  atlasChrome, isEmbedded, flagIsOn, hiddenInEmbed,
  memoryCredentialsAllowed, stripForSharing, carriesCredentials,
  type ChromeDecision, type ChromeSurface,
} from './embedMode.js';
export {
  VIEW_PARAM, TIME_PARAM, EMBED_ALLOW, EMBED_REFERRER_POLICY,
  DEFAULT_EMBED_WIDTH, DEFAULT_EMBED_HEIGHT, DEFAULT_EMBED_TITLE,
  MIN_EMBED_WIDTH, MIN_EMBED_HEIGHT, MAX_EMBED_DIMENSION, PRIVATE_SOURCE_MESSAGE,
  encodeView, decodeView, encodeTime, decodeTime, restoredView,
  shareLink, embedLink, appLink, iframeSnippet, escapeAttribute,
  type ShareTarget, type ShareLink, type RestoredView, type SnippetOptions,
} from './embedUrl.js';
export { copyText, copyMessage, copyShortcut, didCopy, type CopyOutcome, type ClipboardLike } from './clipboard.js';
export { SharePanel, type SharePanelProps } from './SharePanel.js';
export { EmbedBar, type EmbedBarProps } from './EmbedBar.js';
