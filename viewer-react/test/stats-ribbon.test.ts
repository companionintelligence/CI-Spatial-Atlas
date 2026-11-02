/**
 * The stats ribbon names what it counts. A count of one reads "1 Year", not "1 Years",
 * and the same goes for memories and places.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatsRibbon } from '../src/ui/Overlays.js';
import type { AtlasModel } from '../src/model/atlasModel.js';

function ribbon(memories: number, places: number, years: number) {
  const stats = { memories, places, years } as AtlasModel['stats'];
  return renderToStaticMarkup(createElement(StatsRibbon, { stats }));
}

describe('StatsRibbon labels', () => {
  it('uses the singular for a count of one', () => {
    const markup = ribbon(1, 1, 1);
    expect(markup).toContain('>Memory<');
    expect(markup).toContain('>Place<');
    expect(markup).toContain('>Year<');
    expect(markup).not.toContain('Years');
  });

  it('uses the plural for any other count', () => {
    const markup = ribbon(3, 0, 2);
    expect(markup).toContain('>Memories<');
    expect(markup).toContain('>Places<');
    expect(markup).toContain('>Years<');
  });
});
