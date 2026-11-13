import { rgba, rng, smooth } from "../../trails/glow/util.js";
import { TAU, mixRgb, blob, streak } from "../common.js";

// 冰矛, an ice lance: a long, needle-sharp spear of ice with shards set
// along its shaft, fading into its own speed; two ribbons of magic in two of
// the palette's colours spiral round it and trail back along the flight, in a
// haze strewn with star glints. godot/ice.js draws exactly the same.

// The colours all come from the palette (配色): the lance in its light
// colours; the two ribbons in its rim colour and in whichever of its other
// colours (not the near-whites) differs most from the rim, lifted so it
// glows; the haze between its darkest colour and the second ribbon.
const lum = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
export function iceColors(pal) {
  const blue = pal.cols[1] || pal.rim, far = (c) => Math.hypot(c[0] - pal.rim[0], c[1] - pal.rim[1], c[2] - pal.rim[2]);
  let second = pal.cols[0], best = -1;
  for (const c of [...pal.cols, pal.splat]) if (lum(c) <= 215 && far(c) > best) { best = far(c); second = c; }
  const top = Math.max(1, ...second), lift = top < 200 ? 200 / top : 1, ribbon = second.map((v) => Math.min(255, Math.round(v * lift)));
  return {
    core: pal.core, rim: pal.rim, blue, pale: mixRgb(blue, pal.core, 0.55),
    ribbonA: pal.rim, ribbonB: ribbon, haze: mixRgb(pal.cols[0], ribbon, 0.5),
  };
}

// whole turns per loop: about one every 8 frames
export const iceCycles = (n) => Math.max(1, Math.round((n || 8) / 8));

// a path from its oldest point to the head, measured back from the head:
// at(d) → [x, y, nx, ny] (nx, ny: the normal); d < 0 runs on ahead of the
// head, d > len on behind the oldest point, both straight on
export function alongPath(pts) {
  const rev = [...pts].reverse(), ds = [0];
  for (let i = 1; i < rev.length; i++) ds.push(ds[i - 1] + Math.hypot(rev[i][0] - rev[i - 1][0], rev[i][1] - rev[i - 1][1]));
  const len = ds[ds.length - 1];
  const at = (d) => {
    const ahead = Math.min(0, d) + Math.max(0, d - len);
    d = Math.max(0, Math.min(len, d));
    let i = 1;
    while (i < rev.length - 1 && ds[i] < d) i++;
    const a = rev[i - 1], b = rev[i], s = ds[i] - ds[i - 1], k = s > 1e-9 ? (d - ds[i - 1]) / s : 0;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [a[0] + dx * k + dx / l * ahead, a[1] + dy * k + dy / l * ahead, -dy / l, dx / l];
  };
  return { len, at };
}

// the lance, in its own frame (x forward, tip at 2.6 r): its outline (a little
// uneven, like ice), its shaft line, and shards along it
export function iceLance(r, seed) {
  const P = rng(seed * 97 + 5), up = [], dn = [];
  const xs = [1.4, 0.6, -0.4, -1.8, -3.5, -5.0], hw = [0.2, 0.28, 0.32, 0.28, 0.18, 0.06];
  for (let i = 0; i < xs.length; i++) {
    up.push([xs[i] * r, -hw[i] * r * (0.85 + 0.3 * P())]);
    dn.push([xs[i] * r, hw[i] * r * (0.85 + 0.3 * P())]);
  }
  const outline = [[2.6 * r, 0], ...up, [-5.4 * r, 0], ...dn.reverse()];
  const shards = [];
  for (let i = 0; i < 7; i++) {
    const x = r * (1.0 - 5.0 * i / 6 + (P() - 0.5) * 0.4), side = i % 2 ? 1 : -1, len = r * (0.7 + 0.5 * P()) * (1 - 0.08 * i);
    shards.push({ at: [x, side * r * (0.08 + 0.12 * P())], angle: Math.PI + side * (0.25 + 0.25 * P()), len, width: len * 0.2, alpha: 0.95 - 0.1 * i });
  }
  return { outline, tip: [2.6 * r, 0], back: [-5.4 * r, 0], shards };
}

function poly(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }

// a small diamond of ice from `at`, pointing along angle
export function chipPoints(at, angle, len, width) {
  const c = Math.cos(angle), s = Math.sin(angle), pt = (x, y) => [at[0] + x * c - y * s, at[1] + x * s + y * c];
  return [pt(0, 0), pt(len * 0.35, -width), pt(len, 0), pt(len * 0.35, width)];
}

// a star glint: six thin rays and a soft centre
export function star(g, x, y, size, pal, a) {
  if (a <= 0.01) return;
  blob(g, x, y, size * 0.8, [[0, pal.core, 0.8 * a], [1, pal.rim, 0]]);
  for (let k = 0; k < 6; k++) {
    const th = k * Math.PI / 3, l = size * (k % 3 === 0 ? 2 : 1.3);
    streak(g, [x + Math.cos(th) * l, y + Math.sin(th) * l], [x, y], pal.rim, pal.core, 0.8 * a, Math.max(0.4, size * 0.2));
  }
}

// the two ribbons and the glints round the flight, for a path of length len:
// each ribbon a list of { d, off, w, a } running from just ahead of the tip
// back along the path; glints { d, off, size, a }
export function iceSwirl(len, r, t, n, seed, amount = 1, width = 1) {
  const ph = t * TAU * iceCycles(n), P = rng(seed * 173 + 41), ribbons = [], glints = [];
  const reach = Math.max(r * 8, Math.min(len + r * 4, r * 16)), M = Math.max(12, Math.min(140, Math.round(reach / (r * 0.15))));
  for (let j = 0; j < 2; j++) {
    const pts = [];
    for (let k = 0; k <= M; k++) {
      const d = -r * 2.2 + (reach + r * 2.2) * k / M, f = Math.max(0, Math.min(1, (d + r * 2.2) / (reach + r * 2.2)));
      const a = d / (r * 2.4) - ph * 2 + j * Math.PI, grow = smooth(0, 0.15, f), amp = r * (0.3 + 0.55 * Math.min(1, f * 3)) * width;
      const near = 0.5 + 0.5 * Math.cos(a);
      pts.push({ d, off: Math.sin(a) * amp, w: Math.max(0.5, r * 0.36 * (0.35 + 0.65 * near) * Math.pow(1 - f, 0.7) * grow), a: (0.4 + 0.6 * near) * Math.pow(1 - f, 0.9) * grow });
    }
    ribbons.push(pts);
  }
  for (let k = 0, K = Math.round(14 * Math.max(0, amount)); k < K; k++) {
    const d = -r * 1.5 + P() * (reach + r * 1.5), f = Math.max(0, (d + r * 1.5) / (reach + r * 1.5)), off = (P() - 0.5) * r * 1.6 * width, size = r * (0.12 + 0.16 * P()), tw = P() * TAU;
    glints.push({ d, off, size, a: (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ph * 2 + tw))) * (1 - f) });
  }
  return { ribbons, glints, reach };
}

// everything that follows the flight: the haze, the ribbons, the glints
export function drawIceTail(g, c, pts, r, strength = 1, width = 1) {
  const path = alongPath(pts), col = iceColors(c.pal);
  const sw = iceSwirl(path.len, r, c.t, c.n, c.seed, c.amount, width), light = c.pal.dark ? "source-over" : "lighter";
  const place = (d, off) => { const [x, y, nx, ny] = path.at(d); return [x + nx * off, y + ny * off]; };
  g.globalCompositeOperation = light;
  // the haze along the back half
  for (let k = 0, N = Math.max(4, Math.round(sw.reach / (r * 0.4))); k <= N; k++) {
    const d = sw.reach * k / N, f = d / sw.reach, [x, y] = place(d, 0), a = 0.14 * smooth(0, 0.2, f) * Math.pow(1 - f, 0.8) * strength;
    blob(g, x, y, r * (1.2 - 0.6 * f) * width, [[0, col.haze, a], [0.5, col.haze, a * 0.5], [1, col.haze, 0]]);
  }
  // each ribbon a strip of quads (no overlaps to add up into beads): a
  // coloured band with a hot thread inside
  sw.ribbons.forEach((rb, j) => {
    const tone = j ? col.ribbonB : col.ribbonA;
    for (const [k0, tint, mul] of [[1, 0, 0.9], [0.35, 0.6, 0.6]]) for (let k = 1; k < rb.length; k++) {
      const p = rb[k - 1], q = rb[k];
      if (p.a * strength < 0.01) continue;
      g.fillStyle = rgba(mixRgb(tone, col.core, tint), p.a * mul * strength);
      poly(g, [place(p.d, p.off - p.w * k0 / 2), place(q.d, q.off - q.w * k0 / 2), place(q.d, q.off + q.w * k0 / 2), place(p.d, p.off + p.w * k0 / 2)]); g.fill();
    }
  });
  for (const k of sw.glints) { const [x, y] = place(k.d, k.off); star(g, x, y, k.size, c.pal, k.a * strength); }
  g.globalCompositeOperation = "source-over";
}

// the lance at (0, 0), flying along +x
export function drawIceHead(g, c, r) {
  const { pal } = c, col = iceColors(pal), light = pal.dark ? "source-over" : "lighter", L = iceLance(r, c.seed);
  g.globalCompositeOperation = light;
  g.save(); g.translate(-1.2 * r, 0); g.scale(3.2, 0.7);
  blob(g, 0, 0, 1.6 * r, [[0, col.blue, 0.32], [0.5, col.blue, 0.12], [1, col.blue, 0]]);
  g.restore();
  // the ice itself: solid at the tip, fading back into its own speed
  g.globalCompositeOperation = "source-over";
  const gr = g.createLinearGradient(L.back[0], 0, L.tip[0], 0);
  gr.addColorStop(0, rgba(col.blue, 0)); gr.addColorStop(0.5, rgba(col.pale, 0.55)); gr.addColorStop(1, rgba(col.core, 0.95));
  g.fillStyle = gr; poly(g, L.outline); g.fill();
  g.globalCompositeOperation = light;
  for (const s of L.shards) {
    g.fillStyle = rgba(col.blue, 0.55 * s.alpha); poly(g, chipPoints(s.at, s.angle, s.len, s.width)); g.fill();
    g.strokeStyle = rgba(col.core, 0.6 * s.alpha); g.lineWidth = Math.max(0.4, r * 0.03); poly(g, chipPoints(s.at, s.angle, s.len, s.width)); g.stroke();
  }
  streak(g, [L.back[0] * 0.8, 0], L.tip, col.rim, col.core, 0.9, Math.max(0.5, r * 0.12));
  blob(g, L.tip[0], 0, 0.55 * r, [[0, col.core, 0.75], [1, col.rim, 0]]);
  for (const [dx, dy] of [[0.9, 0], [-0.9, 0], [0, 0.45], [0, -0.45]]) streak(g, [L.tip[0] + dx * r, dy * r], L.tip, col.rim, col.core, 0.7, Math.max(0.4, r * 0.06));
  g.globalCompositeOperation = "source-over";
}

export function drawIceBolt(g, c, r, still) {
  // standing still (原地循环): a straight flight behind it carries the ribbons
  if (still) drawIceTail(g, c, Array.from({ length: 9 }, (_, i) => [-r * 12 * (1 - i / 8), 0]), r);
  drawIceHead(g, c, r);
}
