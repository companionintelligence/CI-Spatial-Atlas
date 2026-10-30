/**
 * The Import & export panel's file inputs are never an unnamed tab stop.
 *
 * Both pickers are a visually hidden `<input type="file">` opened by a styled
 * button beside it. Rendered as `<input type="file" class="io-file">` with
 * nothing else, each one was focusable and had no accessible name: axe reports
 * `label` (critical) for both, and a keyboard user met two silent tab stops
 * before reaching the real button. In the media section the ring rule that was
 * meant to show where focus had gone (`.io-file:focus-visible + .atlas-btn`)
 * could not even match, because the button is not the next sibling there, so
 * focus vanished altogether.
 *
 * The button is the control. This pins the contract for every file input the
 * panel renders: either it has a name, or it is out of the tab order *and* out
 * of the accessibility tree. It does not say which, so a later change that
 * labels the input instead stays valid.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InteropPanel, type InteropPanelProps } from '../src/interop/InteropPanel.js';
import { MediaUploadSection } from '../src/interop/MediaUploadSection.js';

const noop = () => {};

const panel = (): string =>
  renderToStaticMarkup(createElement(InteropPanel, {
    open: true,
    onClose: noop,
    story: null,
    files: [],
    onImported: noop,
    onRemoveFile: noop,
    onClearImported: noop,
    memory: null,
    onMemoryImported: noop,
    onShare: noop,
  } as InteropPanelProps));

const section = (): string =>
  renderToStaticMarkup(createElement(MediaUploadSection, { api: null, onUploaded: noop }));

/** Every `<input type="file" ...>` tag in the markup, as an attribute map. */
function fileInputs(html: string): Record<string, string>[] {
  const tags = html.match(/<input\b[^>]*>/g) ?? [];
  return tags
    .map((tag) => {
      const attrs: Record<string, string> = {};
      for (const m of tag.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) attrs[m[1]!.toLowerCase()] = m[2] ?? '';
      return attrs;
    })
    .filter((attrs) => attrs.type === 'file');
}

function isNamed(attrs: Record<string, string>): boolean {
  return Boolean(attrs['aria-label']?.trim() || attrs['aria-labelledby']?.trim());
}

function isOutOfTheWay(attrs: Record<string, string>): boolean {
  return attrs.tabindex === '-1' && attrs['aria-hidden'] === 'true';
}

describe('file inputs in the Import & export panel', () => {
  it('finds both pickers, so the checks below cannot pass on an empty list', () => {
    // One for KML/GeoJSON/story files, one for photos and video.
    expect(fileInputs(panel())).toHaveLength(2);
  });

  it('leaves none of them as an unnamed tab stop', () => {
    for (const attrs of fileInputs(panel())) {
      expect(isNamed(attrs) || isOutOfTheWay(attrs), JSON.stringify(attrs)).toBe(true);
    }
  });

  it('applies to the media section on its own too (the scene editor mounts it directly)', () => {
    const inputs = fileInputs(section());
    expect(inputs).toHaveLength(1);
    expect(isNamed(inputs[0]!) || isOutOfTheWay(inputs[0]!), JSON.stringify(inputs[0])).toBe(true);
  });

  it('still renders the visible buttons that open them', () => {
    // The inputs are out of the way only because these are in it.
    const html = panel();
    expect(html).toContain('Choose files');
    expect(html).toContain('Choose a file');
  });
});
