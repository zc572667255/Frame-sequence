// Where each pixel sits on a ribbon: u along it (tail 0 -> head 1), v across it
// (inner end 0 -> outer end 1). Shared by the pixel bands (trails/model.js) and
// the glow renderer (trails/glow.js).
import { createCanvas } from "../core/util.js";

// draw the texture triangle (s0,s1,s2 in texture px) onto (d0,d1,d2) with an affine
// map; triangles are grown a hair so neighbours overlap instead of leaving seams
export function texTri(g, tex, s0, s1, s2, d0, d1, d2) {
  const cx = (d0[0] + d1[0] + d2[0]) / 3, cy = (d0[1] + d1[1] + d2[1]) / 3;
  const grow = (p) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; return [p[0] + dx / l * 0.6, p[1] + dy / l * 0.6]; };
  const D = [grow(d0), grow(d1), grow(d2)];
  const den = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(den) < 1e-9) return;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / den;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / den;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / den;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / den;
  const e = d0[0] - a * s0[0] - c * s0[1], f = d0[1] - b * s0[0] - d * s0[1];
  g.save();
  g.beginPath();
  g.moveTo(D[0][0], D[0][1]); g.lineTo(D[1][0], D[1][1]); g.lineTo(D[2][0], D[2][1]);
  g.closePath();
  g.clip();
  g.transform(a, b, c, d, e, f);
  g.drawImage(tex, 0, 0);
  g.restore();
}

// ---------- per-pixel (u, v) ----------
// A 256×256 lookup image (red = u, green = v) mapped onto the ribbon with the
// same affine triangles as the texture: every covered pixel learns where it sits
// along (u) and across (v) the trail. Needed for brush streaks, which run along u
// and change across v.
let uvTex = null;
function uvTexture() {
  if (uvTex) return uvTex;
  uvTex = createCanvas(256, 256);
  const g = uvTex.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const i = (y * 256 + x) * 4;
    img.data[i] = x; img.data[i + 1] = y; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return uvTex;
}

export function uvMap(segs, w, h, flip) {
  const c = createCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
  const T = uvTexture();
  const v0 = flip ? 255 : 0, v1 = flip ? 0 : 255;
  for (const [p, q] of segs) {
    // the head cap's sections all sit at u = 1: give them a 1-texel strip, or the
    // triangles collapse and the cap gets no (u, v) at all
    const u1 = q.u * 255, u0 = Math.min(p.u * 255, u1 - 1);
    texTri(g, T, [u0, v0], [u0, v1], [u1, v1], p.a, p.b, q.b);
    texTri(g, T, [u0, v0], [u1, v1], [u1, v0], p.a, q.b, q.a);
  }
  return g.getImageData(0, 0, w, h).data;
}
