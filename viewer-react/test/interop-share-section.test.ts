/**
 * The share section only promises what it can deliver.
 *
 * Sharing moved out of the top bar and into the Import & export panel, and the
 * new copy read "A link that reopens the globe at this camera and this moment,
 * or an <iframe> to paste into a page" with a button labelled "Copy a link or
 * embed code" — unconditionally.
 *
 * That is false in exactly the state this panel is most used in. A view backed
 * by Companion Memory cannot be embedded: the credentials are stripped on the
 * way out (they have to be), so a reader would get the bundled sample instead,
 * and `shareLink` refuses with `private-source` before it even parses the URL —
 * `embed-ui.test.ts` pins that the snippet, the size presets and the "Copy
 * embed code" button are all absent in that case. So a connected author was
 * being offered embed code and getting a paragraph explaining why there is
 * none.
 *
 * The control this replaced was titled "Copy link to this view", which was
 * accurate whether or not a Memory was connected. Losing that when the button
 * moved is the kind of quiet regression this suite exists to catch.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InteropPanel, type InteropPanelProps } from '../src/interop/InteropPanel.js';

const noop = () => {};

const panel = (props: Partial<InteropPanelProps> = {}): string =>
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
    ...props,
  } as InteropPanelProps));

const CONNECTED = { url: 'https://ci.example/graphql', token: 't' };

describe('a story that can be embedded', () => {
  it('offers the iframe, because there is one to offer', () => {
    const html = panel();
    expect(html).toContain('Share this view');
    expect(html).toMatch(/iframe/);
    expect(html).toContain('Copy a link or embed code');
  });
});

describe('a memory-backed story, which cannot be embedded', () => {
  it('does not offer an iframe it will refuse to produce', () => {
    const html = panel({ memory: CONNECTED });
    expect(html).toContain('Share this view');
    expect(html).not.toMatch(/iframe/);
  });

  it('labels the button for what it will actually do', () => {
    const html = panel({ memory: CONNECTED });
    expect(html).toContain('Copy a link to this view');
    expect(html).not.toContain('Copy a link or embed code');
  });

  it('still offers the link, and says why the embed is missing', () => {
    // Silence would read as a bug in the panel. The reason is the same one
    // SharePanel gives, stated before the click rather than after it.
    const html = panel({ memory: CONNECTED });
    expect(html).toMatch(/reopens the globe/i);
    expect(html).toMatch(/cannot be embedded/i);
  });
});

describe('when sharing is off for the session', () => {
  it('renders no share section at all', () => {
    // `chrome.share` false — AtlasApp withholds `onShare`, so the button cannot
    // open a panel the chrome policy never mounted.
    const html = panel({ onShare: undefined });
    expect(html).not.toContain('Share this view');
    // …and the rest of the panel is untouched.
    expect(html).toContain('Bring data in');
  });
});
