/**
 * The top-nav "what's shown on the globe" popover.
 *
 * Rendered with `react-dom/server`, same as `authoring-toolbar-note-order`:
 * no DOM in this workspace, and static markup answers what matters here —
 * which checkboxes exist, what they're labelled, and whether each is checked
 * for a given hidden set. `AuthoredCategory`'s meaning (which literal maps to
 * which checkbox) is exactly what a rename or reorder would silently break,
 * so every category gets its own assertion rather than one loop.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VisibilityToggles, type AuthoredCategory } from '../src/ui/VisibilityToggles.js';

const noop = () => {};
const noopCategory = (_c: AuthoredCategory) => {};

const render = (hidden: ReadonlySet<AuthoredCategory> = new Set(), open = true): string =>
  renderToStaticMarkup(
    createElement(VisibilityToggles, {
      open,
      hidden,
      onToggleCategory: noopCategory,
      onToggle: noop,
      onClose: noop,
    }),
  );

function rowContaining(html: string, needle: string): string | null {
  for (const match of html.matchAll(/<label\b[\s\S]*?<\/label>/g)) {
    if (match[0].includes(needle)) return match[0];
  }
  return null;
}

describe('what shows on the globe', () => {
  it('renders nothing but the toggle button when closed', () => {
    const html = render(new Set(), false);
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it('offers exactly the five categories the feature asked for', () => {
    const html = render();
    for (const label of ['Notes', 'Pins', 'Outlines', 'Areas', 'Images']) {
      expect(rowContaining(html, `>${label}<`)).not.toBeNull();
    }
  });

  it('checks every box when nothing is hidden', () => {
    const html = render(new Set());
    for (const label of ['Notes', 'Pins', 'Outlines', 'Areas', 'Images']) {
      expect(rowContaining(html, `>${label}<`)).toContain('checked=""');
    }
  });

  it('unchecks only the categories actually hidden', () => {
    const html = render(new Set(['note', 'photo']));
    expect(rowContaining(html, '>Notes<')).not.toContain('checked=""');
    expect(rowContaining(html, '>Images<')).not.toContain('checked=""');
    expect(rowContaining(html, '>Pins<')).toContain('checked=""');
    expect(rowContaining(html, '>Outlines<')).toContain('checked=""');
    expect(rowContaining(html, '>Areas<')).toContain('checked=""');
  });

  it('labels images off by default separately from the drawn categories, in the order requested', () => {
    // "notes, pins, outlines, areas, and images" — the order the feature was
    // asked for, so a screen reader announces them the same way it was described.
    const order = [...render().matchAll(/<span>(Notes|Pins|Outlines|Areas|Images)<\/span>/g)].map((m) => m[1]);
    expect(order).toEqual(['Notes', 'Pins', 'Outlines', 'Areas', 'Images']);
  });
});
