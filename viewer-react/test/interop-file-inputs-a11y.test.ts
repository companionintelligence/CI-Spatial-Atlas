/**
 * The Import & export panel's file inputs are never an unnamed tab stop.
 *
 * Both pickers are a visually hidden `<input type="file">` opened by a styled
 * button beside it. Rendered as `<input type="file" class="io-file">` with
 * nothing else, each one was focusable and had no name of its own: axe reports
 * `label` (critical) for both. A keyboard user met two redundant tab stops, one
 * ahead of each picker button (Chromium named them "Choose File" from the
 * browser's default text, so a screen reader heard a duplicate of the real
 * button). In the media section the ring rule that was meant to show where
 * focus had gone (`.io-file:focus-visible + .atlas-btn`) could not even match,
 * because the button is not the next sibling there, so focus vanished
 * altogether.
 *
 * The button is the control. This pins the contract for every file input the
 * panel renders: either it has a name (`aria-label`, `aria-labelledby` or a
 * `<label for>` with text), or it is out of the tab order *and* out of the
 * accessibility tree. It does not say which, so a later change that labels the
 * input instead stays valid. A `<label>` that wraps the input is not
 * recognised; add that route here if the markup ever needs it.
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

/** True when a `<label for="id">` in the markup has some text and points at this input. */
function hasLabelFor(html: string, id: string | undefined): boolean {
  if (!id) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const labels = html.matchAll(new RegExp(`<label\\b[^>]*\\bfor="${escaped}"[^>]*>([\\s\\S]*?)</label>`, 'g'));
  return [...labels].some((m) => m[1]!.replace(/<[^>]*>/g, '').trim() !== '');
}

function isNamed(attrs: Record<string, string>, html: string): boolean {
  return Boolean(attrs['aria-label']?.trim() || attrs['aria-labelledby']?.trim() || hasLabelFor(html, attrs.id));
}

/** True when `text` is the content of a real `<button>` element, not merely somewhere in the markup. */
const hasButton = (html: string, text: string): boolean =>
  new RegExp(`<button\\b[^>]*>\\s*${text}\\s*</button>`).test(html);

function isOutOfTheWay(attrs: Record<string, string>): boolean {
  return attrs.tabindex === '-1' && attrs['aria-hidden'] === 'true';
}

describe('file inputs in the Import & export panel', () => {
  it('finds both pickers, so the checks below cannot pass on an empty list', () => {
    // One for KML/GeoJSON/story files, one for photos and video.
    expect(fileInputs(panel())).toHaveLength(2);
  });

  it('leaves none of them as an unnamed tab stop', () => {
    const html = panel();
    for (const attrs of fileInputs(html)) {
      expect(isNamed(attrs, html) || isOutOfTheWay(attrs), JSON.stringify(attrs)).toBe(true);
    }
  });

  it('applies to the media section on its own too (the scene editor mounts it directly)', () => {
    const html = section();
    const inputs = fileInputs(html);
    expect(inputs).toHaveLength(1);
    expect(isNamed(inputs[0]!, html) || isOutOfTheWay(inputs[0]!), JSON.stringify(inputs[0])).toBe(true);
  });

  it('still renders the visible buttons that open them', () => {
    // The inputs are out of the way only because these are in it, so they have to be real <button> elements
    // and not just text. That is all this pins: a button with tabindex="-1", or one that is always disabled,
    // would still pass. Keyboard operation was checked by hand when the inputs left the tab order (a Tab
    // walk, and Enter on each trigger opening the chooser), not by this test.
    const html = panel();
    expect(hasButton(html, 'Choose files')).toBe(true);
    expect(hasButton(html, 'Choose a file')).toBe(true);
  });
});

describe('the checks above', () => {
  it('count a <label for> with text as a name, so labelling the input later stays valid', () => {
    const named = '<label for="pick">Choose files</label><input type="file" id="pick"/>';
    expect(isNamed(fileInputs(named)[0]!, named)).toBe(true);
  });

  it('do not count an empty or mismatched <label for>', () => {
    for (const html of [
      '<label for="pick"></label><input type="file" id="pick"/>',
      '<label for="pick"><svg></svg> </label><input type="file" id="pick"/>',
      '<label for="other">Choose files</label><input type="file" id="pick"/>',
      '<input type="file" id="pick"/>',
    ]) {
      expect(isNamed(fileInputs(html)[0]!, html), html).toBe(false);
    }
  });

  it('only accept a <button> element as the visible trigger', () => {
    expect(hasButton('<button class="atlas-btn">Choose files</button>', 'Choose files')).toBe(true);
    expect(hasButton('<div class="atlas-btn">Choose files</div>', 'Choose files')).toBe(false);
    expect(hasButton('<p>Choose files</p>', 'Choose files')).toBe(false);
  });
});
