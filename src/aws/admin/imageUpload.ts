// Prepares a picked image file for the question editor: checks the type, shrinks big pictures
// so they fit the server limits (2 MiB per image, ~3.5 MiB per save) and returns base64 + a
// preview URL. The server re-checks everything from the bytes; this only makes the common case work.

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_SAVE_BYTES = 3.5 * 1024 * 1024;
const KEEP_AS_IS_BYTES = 1.5 * 1024 * 1024;
const MAX_SIDE = 2000;

export interface PreparedImage {
  /** base64 of the bytes that will be uploaded. */
  data: string;
  /** object URL for showing it before it is published. */
  preview: string;
  bytes: number;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    for (const scale of [1, 0.7, 0.5]) {
      const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height)) * scale;
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bmp.width * k));
      canvas.height = Math.max(1, Math.round(bmp.height * k));
      const ctx = canvas.getContext('2d');
      if (!ctx) break;
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      for (const q of [0.85, 0.7, 0.55]) {
        const b = await toBlob(canvas, 'image/webp', q); // browsers that cannot encode WebP return PNG
        if (b && b.type === 'image/webp' && b.size <= MAX_IMAGE_BYTES) return b;
      }
    }
  } finally {
    bmp.close();
  }
  throw new Error('Immagine troppo grande: non riesco a ridurla sotto 2 MB.');
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Lettura del file non riuscita.'));
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '');
    r.readAsDataURL(blob);
  });
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error('Formato non supportato: usa PNG, JPEG, GIF o WebP.');
  let blob: Blob = file;
  if (file.size > KEEP_AS_IS_BYTES) {
    if (file.type === 'image/gif') throw new Error('GIF troppo grande: massimo 2 MB.');
    blob = await shrink(file);
  }
  return { data: await toBase64(blob), preview: URL.createObjectURL(blob), bytes: blob.size };
}
