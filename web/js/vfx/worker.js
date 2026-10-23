// 特效 rendered off the main thread. The editor and the cards ask for frames
// here (vfx/layer.js renderVfxAsync); each comes back as an ImageBitmap,
// handed over rather than copied, so the page never waits on the heavy kinds
// (fire, smoke, an aura) while it is being worked in. core/util.js createCanvas
// gives OffscreenCanvases here, which draw the same.
import { renderVfx } from "./effects.js";

self.onmessage = (e) => {
  const { id, p, i } = e.data;
  try {
    const c = renderVfx(p, i);
    const bmp = c.transferToImageBitmap();
    self.postMessage({ id, bmp }, [bmp]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
