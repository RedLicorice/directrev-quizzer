// Image rules for the dataset editor. They mirror the dataset repos' validate.mjs
// (images/ only, jpg/jpeg/png/gif/webp, <= 2 MiB per file) and add what an upload needs:
// the file type is decided from the bytes, never from the name or the declared MIME type.
// SVG is deliberately not accepted (script-capable).
import { createHash } from 'node:crypto';

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
/** Raw bytes of all uploads of one request: base64 inflates by 4/3 and a Function URL takes ~6 MB. */
export const MAX_UPLOAD_TOTAL_BYTES = 3.5 * 1024 * 1024;
export const MAX_UPLOADS = 12;

/** Paths the editor may write or delete: images/<flat name>, relative to the questions file. */
export const IMAGE_PATH_RE = /^images\/[A-Za-z0-9][A-Za-z0-9._-]{0,120}\.(png|jpe?g|gif|webp)$/i;

export type ImageExt = 'png' | 'jpeg' | 'gif' | 'webp';

export function sniffImage(b: Buffer): ImageExt | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 6 && (b.subarray(0, 6).toString('latin1') === 'GIF87a' || b.subarray(0, 6).toString('latin1') === 'GIF89a')) return 'gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** Content-addressed name, e.g. images/q003_B-3fa9c1d2.png (same bytes -> same name, so a retry is idempotent). */
export function imageName(qid: number, slot: string, bytes: Buffer, ext: ImageExt): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  return `images/q${String(qid).padStart(3, '0')}${slot ? `_${slot}` : ''}-${hash}.${ext}`;
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export interface DecodedUpload {
  bytes: Buffer;
  ext: ImageExt;
}

/** Decodes the `uploads` array of a PUT body: token -> bytes, or a short reason. */
export function decodeUploads(raw: unknown): Map<string, DecodedUpload> | string {
  const out = new Map<string, DecodedUpload>();
  if (raw === undefined) return out;
  if (!Array.isArray(raw) || raw.length > MAX_UPLOADS) return 'uploads';
  let total = 0;
  for (const u of raw) {
    if (!u || typeof u !== 'object' || Array.isArray(u)) return 'uploads';
    const { token, data } = u as { token?: unknown; data?: unknown };
    if (typeof token !== 'string' || !/^u[0-9]{1,4}$/.test(token) || out.has(token)) return 'uploads';
    if (typeof data !== 'string' || !B64_RE.test(data)) return 'image_invalid';
    const bytes = Buffer.from(data, 'base64');
    if (bytes.length === 0) return 'image_invalid';
    if (bytes.length > MAX_IMAGE_BYTES) return 'image_too_large';
    total += bytes.length;
    if (total > MAX_UPLOAD_TOTAL_BYTES) return 'image_too_large';
    const ext = sniffImage(bytes);
    if (!ext) return 'image_invalid';
    out.set(token, { bytes, ext });
  }
  return out;
}
