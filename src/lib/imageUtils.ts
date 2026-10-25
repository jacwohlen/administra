import { blobToURL } from 'image-resize-compress';

/** Data URL for an image blob. */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return blobToURL(blob);
}
