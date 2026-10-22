// Previews for the trail style pickers: one short swing drawn with the style
// itself, so a preset shows what it looks like rather than a colour swatch.
// Rendered once per style and kind, then copied onto each picker button.
import { STYLE_DEFAULTS, normalizeTrail, trailState, renderTrail, builtinTexture, builtinBrush } from "../trails/model.js";
import { glowStyle } from "../trails/glow.js";
import { BAND_LOOK } from "./trailbrush.js";

const W = 72, H = 40;
const cache = new Map();

// the same little swing for every preview: up from the left, over, down to the right
function sticks() {
  const ids = ["a", "b", "c", "d"], keys = {};
  const hand = [W * 0.5, H * 1.02];
  [-170, -120, -62, -14].forEach((d, i) => {
    const th = (d * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    keys[ids[i]] = { a: [hand[0] + c * 13, hand[1] + s * 13 * 0.9], b: [hand[0] + c * 33, hand[1] + s * 33 * 0.9], z: "front" };
  });
  return { ids, keys };
}

function render(style) {
  const { ids, keys } = sticks();
  const t = normalizeTrail({ id: "thumb", length: 3, dissolve: 2, rotate: true, turn: "cw", smooth: true, keys, style });
  const img = renderTrail(t, trailState(t, ids, 3), W, H, { tex: builtinTexture(), brush: builtinBrush("bristle") }, null);
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  if (img) {
    const g = c.getContext("2d");
    if (img instanceof ImageData) g.putImageData(img, 0, 0); else g.drawImage(img, 0, 0);
  }
  return c;
}

const hex = (rgb) => "#" + rgb.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");

// kind: "hd" (glow) | "pixel" (glow as pixel art) | "band" (classic bands).
// primary: the editor's main colour, for the 主色 band preset.
export function styleThumb(kind, p, primary) {
  const key = kind + ":" + p.id + (kind === "band" && !p.bands ? ":" + hex(primary || [255, 255, 255]) : "");
  if (!cache.has(key)) {
    const style = kind === "band"
      ? { ...STYLE_DEFAULTS, colorMode: "bands", bands: p.bands || [[hex(primary || [255, 255, 255]), 1]], fade: (p.fade ?? 45) / 100, ...BAND_LOOK, ...(p.look || {}) }
      : { ...STYLE_DEFAULTS, colorMode: "glow", pixel: false, fade: 0.7, shape: "crescent", ...glowStyle(p), pixelGlow: kind === "pixel" };
    cache.set(key, render(style));
  }
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  out.className = "trail-thumb" + (kind === "band" || kind === "pixel" ? " px" : "");
  out.getContext("2d").drawImage(cache.get(key), 0, 0);
  return out;
}
