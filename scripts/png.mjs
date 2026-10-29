// Minimal hand-rolled PNG support for the map tooling (SPEC §10.5).
// Zero dependencies: node:zlib for (de)compression, hand-written CRC32.
//
//  - encodePngRgb(width, height, rgb)  → truecolor 8-bit RGB PNG buffer
//  - decodePng(buffer)                 → { width, height, data: RGBA Buffer }
//
// The decoder covers what the map tooling needs: 8-bit, non-interlaced,
// color types 0 (gray), 2 (RGB), 3 (palette, with tRNS), 4 (gray+alpha),
// 6 (RGBA), all five scanline filters. That is enough for Kenney sheets.

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---------------------------------------------------------------- CRC32

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

/** CRC32 as used by PNG chunks (unsigned 32-bit). */
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// ---------------------------------------------------------------- encoder

/**
 * Encode an 8-bit truecolor RGB image as a PNG.
 * @param {number} width
 * @param {number} height
 * @param {Buffer|Uint8Array} rgb Row-major RGB bytes, length width*height*3.
 * @returns {Buffer} PNG file bytes.
 */
export function encodePngRgb(width, height, rgb) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`encodePngRgb: bad dimensions ${width}x${height}`);
  }
  if (rgb.length !== width * height * 3) {
    throw new Error(`encodePngRgb: expected ${width * height * 3} bytes, got ${rgb.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter: adaptive
  ihdr[12] = 0; // interlace: none

  // Filter byte 0 (None) on every scanline.
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    rgb.copy(raw, rowStart + 1, y * width * 3, (y + 1) * width * 3);
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- decoder

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Decode a PNG buffer to RGBA 8-bit.
 * Supports non-interlaced 8-bit color types 0/2/3/4/6 with tRNS.
 * @param {Buffer} buf
 * @returns {{ width: number, height: number, data: Buffer }} data is RGBA.
 */
export function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('decodePng: not a PNG');
  let pos = 8;
  /** @type {{ width: number, height: number, bitDepth: number, colorType: number, interlace: number } | null} */
  let ihdr = null;
  /** @type {Buffer | null} */
  let palette = null;
  /** @type {Buffer | null} */
  let trns = null;
  const idatParts = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const wantCrc = buf.readUInt32BE(pos + 8 + len);
    const gotCrc = crc32(Buffer.concat([Buffer.from(type, 'ascii'), data]));
    if (wantCrc !== gotCrc) throw new Error(`decodePng: CRC mismatch in ${type} chunk`);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idatParts.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('decodePng: missing IHDR');
  const { width, height, bitDepth, colorType, interlace } = ihdr;
  if (interlace !== 0) throw new Error('decodePng: interlaced PNGs are not supported');
  if (bitDepth !== 8) throw new Error(`decodePng: bit depth ${bitDepth} not supported (need 8)`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error(`decodePng: color type ${colorType} not supported`);
  if (colorType === 3 && !palette) throw new Error('decodePng: palette PNG without PLTE');

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride); // channels-wide decoded pixels
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let value;
      switch (filter) {
        case 0:
          value = v;
          break;
        case 1:
          value = v + a;
          break;
        case 2:
          value = v + b;
          break;
        case 3:
          value = v + ((a + b) >> 1);
          break;
        case 4:
          value = v + paeth(a, b, c);
          break;
        default:
          throw new Error(`decodePng: bad filter ${filter} on row ${y}`);
      }
      cur[x] = value & 0xff;
    }
  }

  // Expand to RGBA.
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    let r = 0,
      g = 0,
      b = 0,
      a = 255;
    if (colorType === 0) {
      r = g = b = out[i];
      if (trns && trns.length >= 2) {
        const t = trns.readUInt16BE(0);
        if (out[i] === t) a = 0;
      }
    } else if (colorType === 2) {
      r = out[i * 3];
      g = out[i * 3 + 1];
      b = out[i * 3 + 2];
      if (trns && trns.length >= 6) {
        if (
          out[i * 3] === trns.readUInt16BE(0) &&
          out[i * 3 + 1] === trns.readUInt16BE(2) &&
          out[i * 3 + 2] === trns.readUInt16BE(4)
        )
          a = 0;
      }
    } else if (colorType === 3) {
      const idx = out[i];
      r = palette[idx * 3] ?? 0;
      g = palette[idx * 3 + 1] ?? 0;
      b = palette[idx * 3 + 2] ?? 0;
      if (trns) a = idx < trns.length ? trns[idx] : 255;
    } else if (colorType === 4) {
      r = g = b = out[i * 2];
      a = out[i * 2 + 1];
    } else {
      r = out[i * 4];
      g = out[i * 4 + 1];
      b = out[i * 4 + 2];
      a = out[i * 4 + 3];
    }
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

/** Split a PNG buffer into its chunks (for tests / inspection). */
export function pngChunks(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('pngChunks: not a PNG');
  const chunks = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const crc = buf.readUInt32BE(pos + 8 + len);
    chunks.push({ type, length: len, crcOk: crc === crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), data });
    pos += 12 + len;
  }
  return chunks;
}
