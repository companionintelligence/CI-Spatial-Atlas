import { useMemo } from 'react';
import { Viewer, CzmlDataSource, Cesium3DTileset } from 'resium';
import { storyToCzml, type Story } from '@companion-atlas/story';

/**
 * Desktop/mobile renderer: CesiumJS via Resium. The Story is converted to CZML
 * (entities + a real `Clock`) and the reconstruction tilesets are added as
 * `Cesium3DTileset`s. This is the "4D scrubbing actually works" path — the CZML
 * clock drives the Cesium `Viewer` timeline natively.
 */
export function CesiumStoryViewer({ story }: { story: Story }) {
  const { czml, tilesets } = useMemo(() => storyToCzml(story), [story]);

  return (
    <Viewer full timeline animation shouldAnimate>
      <CzmlDataSource data={czml} />
      {tilesets.map((t) => (
        <Cesium3DTileset key={t.id} url={t.url} />
      ))}
    </Viewer>
  );
}
