// 拖尾笔 strokes rendered off the main thread (trails/stroke.js strokePrefetch):
// one frame of a stroke comes back as an ImageBitmap, handed over rather than
// copied. core/util.js createCanvas gives OffscreenCanvases here.
import { strokeImage } from "./stroke.js";
import { workerCanvasesInMemory } from "../core/util.js";

workerCanvasesInMemory();

self.onmessage = async (e) => {
  const { id, stroke, key, w, h, gone } = e.data;
  try {
    const img = strokeImage(stroke, key, w, h, gone);
    if (!img) { self.postMessage({ id, empty: true }); return; }
    const bmp = await createImageBitmap(img);
    self.postMessage({ id, bmp }, [bmp]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
