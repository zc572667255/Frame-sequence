// A GIF made off the main thread (nodes/exporters.js exportGif): picking each
// frame's 256 colours is the slow part, shared out over a few of these
// ("quantize": some frames' pixels in, their indices and palettes out); one
// then puts the file together ("encode": the bytes out). The page keeps going.
import { quantizeFrame, encodeGIF } from "./gif.js";

self.onmessage = (e) => {
  const { op, width, height, frames } = e.data;
  try {
    if (op === "quantize") {
      const out = frames.map((f) => {
        const q = quantizeFrame({ data: new Uint8ClampedArray(f.data), width, height });
        return { ...q, delayCs: f.delayCs };
      });
      self.postMessage({ frames: out }, out.map((q) => q.indices.buffer));
      return;
    }
    const bytes = encodeGIF({ width, height, frames, loop: 0 });
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch (err) {
    self.postMessage({ error: String((err && err.message) || err) });
  }
};
