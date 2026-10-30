import { createCanvas } from "../core/util.js";

// Mirrored by _remote_mesh in godot/remotetrail.js. Symmetric centre fans avoid
// pulling the two halves of a wide, tapered wake along opposite diagonals.
export const FIRE_LONG_STEPS = 2, FIRE_CROSS_STEPS = 4;
const mix = (a, b, t) => a + (b - a) * t;
const point = (p, q, s, v) => [0, 1].map(k => mix(mix(p.a[k], p.b[k], v), mix(q.a[k], q.b[k], v), s));

export function flameCells(sections) {
  const cells = [];
  for (let i = 1; i < sections.length; i++) {
    const p = sections[i - 1], q = sections[i];
    for (let j = 0; j < FIRE_LONG_STEPS; j++) for (let k = 0; k < FIRE_CROSS_STEPS; k++) {
      const s0 = j / FIRE_LONG_STEPS, s1 = (j + 1) / FIRE_LONG_STEPS, v0 = k / FIRE_CROSS_STEPS, v1 = (k + 1) / FIRE_CROSS_STEPS;
      const u0 = mix(p.u, q.u, s0), u1 = mix(p.u, q.u, s1);
      cells.push({ points: [point(p, q, s0, v0), point(p, q, s0, v1), point(p, q, s1, v1), point(p, q, s1, v0)], uvs: [[u0, v0], [u0, v1], [u1, v1], [u1, v0]] });
    }
  }
  return cells;
}

// Float coordinates preserve fine flame detail when the effect is enlarged.
// Coverage comes from one silhouette; internal tessellation has no AA seams.
export function flameUV(sections, w, h) {
  const cv = createCanvas(w, h), g = cv.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff"; g.beginPath();
  const outline = [...sections.map(q => q.a), ...sections.toReversed().map(q => q.b)];
  outline.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fill();
  const mask = g.getImageData(0, 0, w, h).data, size = w * h;
  const u = new Float32Array(size), v = new Float32Array(size), alpha = new Uint8Array(size), best = new Float32Array(size); best.fill(-Infinity);
  const triangle = (a, b, c, ta, tb, tc) => {
    const bx = b[0] - a[0], by = b[1] - a[1], cx = c[0] - a[0], cy = c[1] - a[1], area = bx * cy - by * cx;
    if (area <= 0.00000001) return;
    const edges = [Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(cx, cy), Math.hypot(bx, by)];
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]) - 1)), x1 = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]) - 1)), y1 = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const pixel = y * w + x;
      if (!mask[pixel * 4 + 3]) continue;
      const px = x + 0.5 - a[0], py = y + 0.5 - a[1], wb = (px * cy - py * cx) / area, wc = (bx * py - by * px) / area, wa = 1 - wb - wc;
      const distance = Math.min(wa * area / edges[0], wb * area / edges[1], wc * area / edges[2]);
      if (distance < -0.75 || (distance < 0 && distance <= best[pixel])) continue;
      best[pixel] = distance;
      u[pixel] = Math.max(0, Math.min(1, ta[0] * wa + tb[0] * wb + tc[0] * wc));
      v[pixel] = Math.max(0, Math.min(1, ta[1] * wa + tb[1] * wb + tc[1] * wc));
      alpha[pixel] = mask[pixel * 4 + 3];
    }
  };
  for (const { points, uvs } of flameCells(sections)) {
    const centre = [0, 1].map(k => points.reduce((sum, p) => sum + p[k], 0) / 4), uv = [0, 1].map(k => uvs.reduce((sum, p) => sum + p[k], 0) / 4);
    for (let j = 0; j < 4; j++) triangle(points[j], points[(j + 1) % 4], centre, uvs[j], uvs[(j + 1) % 4], uv);
  }
  return { u, v, alpha };
}
