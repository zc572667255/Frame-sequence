// Animated WebP: each frame is encoded by the browser (canvas.toBlob, which at
// quality 1 is true lossless VP8L in Chromium), then the frames' bitstreams are
// muxed into one RIFF/WEBP file with VP8X + ANIM + ANMF chunks.
//
// Spec: https://developers.google.com/speed/webp/docs/riff_container

function readChunks(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (o) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("不是 WebP 数据");
  const chunks = [];
  let o = 12;
  while (o + 8 <= buf.length) {
    const size = dv.getUint32(o + 4, true);
    chunks.push({ tag: tag(o), data: buf.subarray(o + 8, o + 8 + size) });
    o += 8 + size + (size & 1);
  }
  return chunks;
}

function chunk(tag, data) {
  const pad = data.length & 1;
  const out = new Uint8Array(8 + data.length + pad);
  for (let i = 0; i < 4; i++) out[i] = tag.charCodeAt(i);
  new DataView(out.buffer).setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

function u24(arr, o, v) { arr[o] = v & 255; arr[o + 1] = (v >> 8) & 255; arr[o + 2] = (v >> 16) & 255; }

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function encodeFrameWebP(canvas, quality) {
  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", quality));
  if (!blob || blob.type !== "image/webp") {
    throw new Error("当前浏览器不支持 WebP 编码，请用 Chrome 或 Edge 导出。");
  }
  return new Uint8Array(await blob.arrayBuffer());
}

// frames: [{ canvas, duration }] all the same size; quality: 1 = lossless
export async function encodeAnimatedWebP(frames, { width, height, quality = 1, loop = 0 }) {
  const anmf = [];
  let hasAlpha = false;
  for (const f of frames) {
    const file = await encodeFrameWebP(f.canvas, quality);
    // keep only the image bitstream chunks; VP8X/ICCP/EXIF/XMP describe a single image
    const data = readChunks(file).filter((c) => c.tag === "ALPH" || c.tag === "VP8 " || c.tag === "VP8L");
    if (!data.length) throw new Error("WebP 帧编码结果里没有图像数据");
    if (data.some((c) => c.tag === "ALPH" || c.tag === "VP8L")) hasAlpha = true;
    const head = new Uint8Array(16);
    // x/y offset 0; canvas-sized frame
    u24(head, 6, f.canvas.width - 1);
    u24(head, 9, f.canvas.height - 1);
    u24(head, 12, Math.max(1, Math.min(0xffffff, Math.round(f.duration))));
    // bit 1: do not blend — each frame fully replaces the previous one, so
    // transparent pixels stay transparent instead of showing the frame before
    head[15] = 0x02;
    anmf.push(chunk("ANMF", concat([head, ...data.map((c) => chunk(c.tag, c.data))])));
  }

  const vp8x = new Uint8Array(10);
  vp8x[0] = 0x02 | (hasAlpha ? 0x10 : 0); // animation | alpha
  u24(vp8x, 4, width - 1);
  u24(vp8x, 7, height - 1);
  const anim = new Uint8Array(6); // background colour 0 (transparent), loop count
  anim[4] = loop & 255; anim[5] = (loop >> 8) & 255;

  const body = concat([new TextEncoder().encode("WEBP"), chunk("VP8X", vp8x), chunk("ANIM", anim), ...anmf]);
  const riff = new Uint8Array(8);
  riff.set(new TextEncoder().encode("RIFF"));
  new DataView(riff.buffer).setUint32(4, body.length, true);
  return new Blob([riff, body], { type: "image/webp" });
}
