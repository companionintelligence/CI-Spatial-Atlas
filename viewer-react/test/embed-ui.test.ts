/**
 * The two embed controls, as markup.
 *
 * Rendered with `react-dom/server` for the same reason as `scene-ui-list` and
 * `scene-ui-editor`: this workspace's suites run in node with no DOM, and
 * static markup answers everything that matters here — which control is
 * showing, what it is labelled, and whether the thing it points at exists.
 *
 * The behaviour under these controls (copying, the URL, the predicate) is
 * tested directly in the sibling `embed-*` suites, which is where the failure
 * modes actually live.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Camera } from '@companion-atlas/story';
import { SharePanel, type SharePanelProps } from '../src/embed/SharePanel.js';
import { EmbedBar, type EmbedBarProps } from '../src/embed/EmbedBar.js';
import { hiddenInEmbed } from '../src/embed/embedMode.js';

const CAMERA: Camera = { lat: 64.1466, lon: -21.9426, height: 90_000, heading: 200, pitch: -35 };
const noop = () => {};

const share = (props: Partial<SharePanelProps> = {}): string =>
  renderToStaticMarkup(createElement(SharePanel, {
    open: true,
    onClose: noop,
    href: 'https://atlas.example/?story=%2Fstories%2Fsample.json',
    camera: CAMERA,
    timeMs: 1_559_600_000_000,
    ...props,
  }));

const bar = (props: Partial<EmbedBarProps> = {}): string =>
  renderToStaticMarkup(createElement(EmbedBar, {
    canPresent: true,
    onPresent: noop,
    href: 'https://atlas.example/?embed=1&story=%2Fs.json',
    ...props,
  }));

describe('the share panel', () => {
  it('renders nothing when closed, so it cannot swallow Escape or a Tab', () => {
    expect(share({ open: false })).toBe('');
  });

  it('shows the link and the snippet as selectable text, not only as buttons', () => {
    // Every copy route can fail (see embed-clipboard). The text itself is the
    // last fallback, so it is always on screen and always selectable.
    const html = share();
    expect(html).toContain('readonly=""');
    expect(html).toContain('&lt;iframe');
    expect(html).toContain('embed=1');
  });

  it('offers both copies, and names the frame after the story', () => {
    const html = share({ storyTitle: 'Pacific Journey' });
    expect(html).toContain('Copy link');
    expect(html).toContain('Copy embed code');
    expect(html).toContain('title=&quot;Pacific Journey&quot;');
  });

  it('carries the current camera and clock into both', () => {
    const html = share();
    expect(html).toContain('64.1466,-21.9426,90000,200,-35');
    expect(html).toContain('1559600000000');
  });

  it('never puts the memory address or the token on the clipboard', () => {
    const html = share({ href: 'https://atlas.example/?memory=https%3A%2F%2Fm.example&token=secret-jwt' });
    expect(html).not.toContain('secret-jwt');
    expect(html).not.toContain('m.example');
  });

  it('explains a view it cannot embed instead of offering a broken snippet', () => {
    const html = share({ privateSource: true });
    expect(html).not.toContain('Copy embed code');
    expect(html).toContain('Companion Memory');
    expect(html).toContain('?story=');
    // The plain link still works — it is the memory connection that cannot
    // travel, not the address of the page.
    expect(html).toContain('Copy link');
  });

  it('tells the author what the embed will hide, in the predicate’s words', () => {
    const html = share();
    for (const label of hiddenInEmbed()) expect(html, label).toContain(label);
  });

  it('reserves the status line, so a confirmation does not move the buttons', () => {
    // The line is present and empty before anything is copied; without it the
    // first confirmation shoves the control the user is aiming at.
    expect(share()).toContain('role="status"');
  });

  it('labels every control for a screen reader', () => {
    const html = share();
    expect(html).toContain('aria-label="Share this view"');
    expect(html).toContain('aria-label="Close share"');
    expect(html).toContain('aria-label="Embed code"');
    expect(html).toContain('aria-label="Embed width in pixels"');
    expect(html).toContain('aria-label="Embed height in pixels"');
    expect(html).toContain('aria-label="Frame size"');
  });

  it('marks the selected frame size as pressed', () => {
    expect(share()).toContain('aria-pressed="true"');
  });
});

describe('the embed bar', () => {
  it('gives the presenter the entry point the rail used to hold', () => {
    // Without this the presenter is mounted in an embed and unreachable.
    expect(bar()).toContain('Play story');
  });

  it('offers nothing to play when there is nothing to play', () => {
    // The same honesty rule the rail's Present button follows: hidden, not
    // shown disabled.
    expect(bar({ canPresent: false })).not.toContain('Play story');
    expect(bar({ presenting: true })).not.toContain('Play story');
  });

  it('names what the reader is looking at', () => {
    expect(bar({ title: 'Pacific Journey' })).toContain('Pacific Journey');
    // With no title it still says whose globe this is, rather than nothing.
    expect(bar()).toContain('Companion Atlas');
  });

  it('links out to the full app, in a new tab, without the embed switch', () => {
    // Following it in place would replace the story with the authoring app
    // inside a 960×540 box on someone else's page, with no way back.
    const html = bar();
    expect(html).toContain('href="https://atlas.example/?story=%2Fs.json"');
    expect(html).not.toContain('embed=1"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
});
