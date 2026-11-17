// Type surface for png.mjs, for TypeScript consumers (tests).

/** Encode an 8-bit truecolor RGB image as PNG bytes. rgb is width*height*3. */
export function encodePngRgb(width: number, height: number, rgb: Buffer | Uint8Array): Buffer;

/** Encode an 8-bit truecolor RGBA image as PNG bytes. rgba is width*height*4. */
export function encodePngRgba(width: number, height: number, rgba: Buffer | Uint8Array): Buffer;

export interface DecodedPng {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Buffer;
}

/** Decode PNG bytes (8-bit, non-interlaced, color types 0/2/3/4/6) to RGBA. */
export function decodePng(buf: Buffer | Uint8Array): DecodedPng;

export function pngChunks(
  buf: Buffer | Uint8Array,
): Array<{ type: string; length: number; crcOk: boolean; data: Buffer }>;

export function crc32(buf: Buffer | Uint8Array): number;
