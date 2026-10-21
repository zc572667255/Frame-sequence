// Animated GIF: per-frame quantization + a GIF89a encoder (local colour table per
// frame, LZW).
import { medianCut, nearestIndexIn } from "./color.js";

// Returns { width, height, indices: Uint8Array, palette: [[r,g,b],...], transparentIndex: number|null }
export function quantizeFrame(imageData) {
  const { data, width, height } = imageData;
  const n = width * height;
  const colorCount = new Map(); // packed RGB integer -> count
  let hasTransparent = false;

  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a < 128) { hasTransparent = true; continue; }
    const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
    colorCount.set(key, (colorCount.get(key) || 0) + 1);
  }

  const maxOpaque = hasTransparent ? 255 : 256;
  let paletteColors;
  const colorToIndex = new Map();

  const uniqueKeys = [...colorCount.keys()];
  if (uniqueKeys.length <= maxOpaque) {
    paletteColors = uniqueKeys.map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    uniqueKeys.forEach((k, i) => colorToIndex.set(k, i));
  } else {
    // Median cut over the whole colour set, weighted by pixel counts, then
    // remap every colour to its nearest representative.
    //
    // Do NOT reduce by popularity here. On continuous-tone art (a shaded
    // render rather than flat pixel art) a 256x256 frame easily holds ~12k
    // distinct colours across ~13k opaque pixels, so every count sits at
    // 3-12 and "most popular" is pure noise. The top 255 then covers under
    // 10% of the pixels and is dominated by whichever large smooth region
    // repeats most, wiping entire hues out of the palette — every green
    // could vanish, leaving those pixels to snap to the nearest survivor
    // (a brown), which reads as the whole frame turning red.
    const colors = uniqueKeys.map((k) => [(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    const counts = uniqueKeys.map((k) => colorCount.get(k));
    paletteColors = medianCut(colors, counts, maxOpaque);
    for (let i = 0; i < uniqueKeys.length; i++) {
      colorToIndex.set(uniqueKeys[i], nearestIndexIn(colors[i], paletteColors));
    }
  }

  let transparentIndex = null;
  if (hasTransparent) {
    transparentIndex = paletteColors.length;
    paletteColors.push([0, 0, 0]);
  }

  const indices = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) {
      indices[i] = transparentIndex;
    } else {
      const key = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
      indices[i] = colorToIndex.get(key);
    }
  }
  return { width, height, indices, palette: paletteColors, transparentIndex };
}

function nextPow2AtLeast2(n) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

// frames: quantized frames, each with its own delayCs (centiseconds)
export function encodeGIF({ width, height, frames, loop }) {
  const out = [];
  const pushByte = (b) => out.push(b & 0xff);
  const pushStr = (s) => { for (let i = 0; i < s.length; i++) pushByte(s.charCodeAt(i)); };
  const pushShort = (v) => { pushByte(v & 0xff); pushByte((v >> 8) & 0xff); };

  pushStr("GIF89a");
  pushShort(width);
  pushShort(height);
  pushByte(0x00); // no global color table
  pushByte(0x00); // background color index
  pushByte(0x00); // pixel aspect ratio

  if (frames.length > 1) {
    pushByte(0x21); pushByte(0xff); pushByte(0x0b);
    pushStr("NETSCAPE2.0");
    pushByte(0x03); pushByte(0x01);
    pushShort(loop || 0);
    pushByte(0x00);
  }

  for (const fr of frames) {
    const numColors = fr.palette.length;
    // floor of 4 entries: the LZW minimum code size is 2, so 2-bit indices are
    // in play even for a 1- or 2-colour frame. A 2-entry table would leave
    // indices 2..3 undefined and trips up strict decoders.
    const tableEntries = Math.max(4, nextPow2AtLeast2(numColors));
    const sizeField = Math.log2(tableEntries) - 1;
    const minCodeSize = Math.max(2, sizeField + 1);

    // Graphic Control Extension
    pushByte(0x21); pushByte(0xf9); pushByte(0x04);
    const hasTrans = fr.transparentIndex !== null;
    const packed = (0x02 << 2) | (hasTrans ? 0x01 : 0x00); // disposal=2 (restore to bg)
    pushByte(packed);
    pushShort(Math.max(1, fr.delayCs | 0));
    pushByte(hasTrans ? fr.transparentIndex : 0);
    pushByte(0x00);

    // Image Descriptor
    pushByte(0x2c);
    pushShort(0); pushShort(0);
    pushShort(fr.width); pushShort(fr.height);
    pushByte(0x80 | sizeField); // local color table flag + size

    for (let i = 0; i < tableEntries; i++) {
      const c = fr.palette[i] || [0, 0, 0];
      pushByte(c[0]); pushByte(c[1]); pushByte(c[2]);
    }

    pushByte(minCodeSize);
    const lzwBytes = lzwEncode(minCodeSize, fr.indices);
    for (let i = 0; i < lzwBytes.length; i += 255) {
      const end = Math.min(i + 255, lzwBytes.length);
      pushByte(end - i);
      for (let j = i; j < end; j++) pushByte(lzwBytes[j]);
    }
    pushByte(0x00);
  }

  pushByte(0x3b);
  return new Uint8Array(out);
}

// Dictionary keyed by (prefix code * 256 + next index) — indices are < 256 and
// codes < 4096, so the key is unique and avoids building strings per pixel.
function lzwEncode(minCodeSize, pixels) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  const dict = new Map();
  let codeSize, nextCode;
  const resetDict = () => {
    dict.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoiCode + 1;
  };
  resetDict();

  const bytes = [];
  let bitBuffer = 0, bitCount = 0;
  const emit = (code) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  emit(clearCode);
  if (pixels.length === 0) {
    emit(eoiCode);
    if (bitCount > 0) bytes.push(bitBuffer & 0xff);
    return bytes;
  }

  let w = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i];
    const key = w * 256 + k;
    const hit = dict.get(key);
    if (hit !== undefined) {
      w = hit;
    } else {
      emit(w);
      if (nextCode < 4096) {
        // Widen BEFORE claiming the new code, never after. A GIF decoder builds
        // its table one entry behind the encoder, so it widens one emitted code
        // later than a post-increment test would; bumping after the increment
        // makes the encoder write n+1-bit codes while the decoder still reads n
        // bits, and the whole stream desyncs.
        if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++;
        dict.set(key, nextCode++);
      } else {
        emit(clearCode);
        resetDict();
      }
      w = k;
    }
  }
  emit(w);
  emit(eoiCode);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return bytes;
}
