import { blobToURL } from 'image-resize-compress';

/**
 * Data URL for an image blob. `blobToURL` reads the blob with
 * `readAsDataURL`, so the result is always a string even though the library
 * types it as `string | ArrayBuffer`.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  return (await blobToURL(blob)) as string;
}
