/**
 * Export the current story to a file the rest of the world can read.
 *
 * KML is the format that matters here: it is what Google Earth, QGIS and every
 * GIS tool will take, and being able to hand someone a `.kml` is what stops
 * Atlas being a closed island. `storyToKml` lives in `@companion-atlas/story`
 * so the server and any agent can produce the same bytes without a browser;
 * this module is only the browser's save-to-disk plumbing.
 */
import { storyToKml, type Story } from '@companion-atlas/story';

/** Strip a title down to something a filesystem and a Content-Disposition
 *  header will both accept, without ending up with an empty name. */
export function fileStem(title: string | undefined, fallback: string): string {
  const cleaned = (title ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s.-]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return cleaned.slice(0, 60) || fallback;
}

/**
 * Trigger a download of `blob`.
 *
 * The object URL is revoked on the next task rather than immediately: Safari
 * and older WebKit abort the download if the URL dies in the same tick as the
 * synthetic click, and the leak from one frame's delay is nothing next to a
 * download that silently does not happen.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadKml(story: Story): void {
  const kml = storyToKml(story);
  // The registered type. Google Earth and QGIS both sniff the extension too,
  // but a correct type is what makes it open rather than download-and-guess on
  // platforms that respect it.
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  downloadBlob(blob, `${fileStem(story.title, 'atlas-story')}.kml`);
}

export function downloadStoryJson(story: Story): void {
  const blob = new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `${fileStem(story.title, 'atlas-story')}.story.json`);
}
