import { createCanvas } from "../../core/util.js";
import { fbmNoise, smooth, clamp01 } from "../../trails/glow/util.js";
import { mixRgb } from "../common.js";

// Fixed object-space frost, shared with the negative-UV shard pass in Godot's
// remote ribbon shader. No source art is embedded in an exported effect.
const textures = new Map();
function texture(pal, variant) {
  const key = pal.preset.id + ":" + variant;
  if (textures.has(key)) return textures.get(key);
  const cv = createCanvas(64, 64), g = cv.getContext("2d"), img = g.createImageData(64, 64), noise = fbmNoise(variant * 53 + 211);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const u = (x + 0.5) / 64, v = (y + 0.5) / 64, coarse = noise(u * 6, v * 6), fine = noise(u * 18 + coarse * 2, v * 18);
    const ridge = Math.pow(Math.max(0, 1 - Math.abs(coarse - 0.5) * 6), 8), grain = smooth(0.5, 0.72, fine), frost = clamp01(ridge * 0.75 + grain * 0.4);
    const color = mixRgb(pal.rim, pal.core, 0.15 + frost * 0.7), i = (y * 64 + x) * 4;
    img.data[i] = color[0]; img.data[i + 1] = color[1]; img.data[i + 2] = color[2]; img.data[i + 3] = Math.round((0.06 + frost * 0.6) * 255);
  }
  g.putImageData(img, 0, 0);
  if (textures.size >= 88) textures.delete(textures.keys().next().value);
  textures.set(key, cv); return cv;
}

export function drawIceGrain(g, points, pal, key, alpha) {
  const [a, b, c] = points;
  g.save(); g.globalAlpha *= alpha;
  g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...c); g.closePath(); g.clip();
  g.transform((b[0] - a[0]) / 64, (b[1] - a[1]) / 64, (c[0] - a[0]) / 64, (c[1] - a[1]) / 64, a[0], a[1]);
  g.drawImage(texture(pal, Math.abs(key) % 11), 0, 0); g.restore();
}
