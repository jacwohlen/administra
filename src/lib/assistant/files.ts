import { fromBlob } from 'image-resize-compress';
import { ASSISTANT_LIMITS, type AssistantFile } from './types';

/**
 * Gets an upload ready for /api/assistant, in the browser. Photos are
 * re-encoded as JPEG at most ASSISTANT_LIMITS.imageMaxEdge pixels on the
 * long edge: that keeps the request within Netlify's body limit, loses
 * nothing the model would read (it scales larger images down anyway) and
 * drops EXIF data such as the GPS position. PDFs are sent as they are;
 * text and CSV files become pasted text.
 */

export type UploadErrorCode = 'heic' | 'unsupported_file' | 'too_large' | 'unreadable';

export class UploadError extends Error {
  constructor(readonly code: UploadErrorCode) {
    super(code);
    this.name = 'UploadError';
  }
}

export interface PreparedUpload {
  name: string;
  /** Bytes sent */
  size: number;
  /** An image or PDF for the model */
  file?: AssistantFile;
  /** Contents of a text file, appended to the pasted text */
  text?: string;
}

const TEXT_FILE = /\.(txt|csv|tsv)$/i;
const HEIC = /\.(heic|heif)$/i;

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  const type = file.type.toLowerCase();
  if (type === 'image/heic' || type === 'image/heif' || HEIC.test(file.name)) {
    throw new UploadError('heic');
  }
  if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > ASSISTANT_LIMITS.maxTotalBytes) throw new UploadError('too_large');
    return {
      name: file.name,
      size: file.size,
      file: { name: file.name, mediaType: 'application/pdf', data: await blobToBase64(file) }
    };
  }
  if (type.startsWith('text/') || TEXT_FILE.test(file.name)) {
    if (file.size > ASSISTANT_LIMITS.maxTextLength * 4) throw new UploadError('too_large');
    return { name: file.name, size: file.size, text: await file.text() };
  }
  if (!type.startsWith('image/')) throw new UploadError('unsupported_file');

  let blob: Blob;
  try {
    blob = await fromBlob(file, {
      maxWidthOrHeight: ASSISTANT_LIMITS.imageMaxEdge,
      format: 'jpeg',
      quality: 85
    });
  } catch {
    throw new UploadError('unreadable');
  }
  return {
    name: file.name,
    size: blob.size,
    file: { name: file.name, mediaType: 'image/jpeg', data: await blobToBase64(blob) }
  };
}

/** Bytes the prepared uploads take together. */
export function totalSize(uploads: PreparedUpload[]): number {
  return uploads.reduce((sum, u) => sum + (u.file ? u.size : 0), 0);
}

/** "1.2 MB" */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
