// Helpers for the values that flow along edges.
import { imageDataOf, canvasFromImageData } from "../core/util.js";

export function imageValue(canvas) {
  return { kind: "image", canvas };
}

export function framesValue(frames, w, h, extra) {
  return { kind: "frames", w, h, frames, ...extra };
}

// the canvas to show as a still for any value: an image, or a sequence's first frame
export function stillOf(v) {
  if (!v) return null;
  if (v.kind === "image") return v.canvas;
  if (v.kind === "frames") return v.frames[0] ? v.frames[0].canvas : null;
  return null;
}

export function describe(v) {
  if (!v) return "";
  if (v.kind === "image") return v.canvas.width + " × " + v.canvas.height;
  return v.frames.length + " 帧 · " + v.w + " × " + v.h;
}

// Run an ImageData -> ImageData operation over an image or every frame of a
// sequence, keeping the shape of the input. `fn` returns { out, ...stats }; the
// stats of the first call are handed back as the readout.
export function mapRaster(v, fn) {
  if (v.kind === "image") {
    const r = fn(imageDataOf(v.canvas), 0);
    return { value: { kind: "image", canvas: canvasFromImageData(r.out) }, stats: [r] };
  }
  const stats = [];
  const frames = v.frames.map((f, i) => {
    const r = fn(imageDataOf(f.canvas), i);
    stats.push(r);
    return { ...f, canvas: canvasFromImageData(r.out) };
  });
  const w = frames[0] ? frames[0].canvas.width : v.w;
  const h = frames[0] ? frames[0].canvas.height : v.h;
  return { value: { ...v, frames, w, h, ver: undefined }, stats };
}
