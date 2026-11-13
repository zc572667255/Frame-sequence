import { rgba, rng, smooth } from "../../trails/glow/util.js";
import { TAU, frac, mixRgb, blob, streak } from "../common.js";

// 冰矛, as an ice meteor: a rough, faceted chunk of ice tumbling forward in a
// cold glow, shedding broken ice chips that spin away behind it, with a trail
// of freezing vapour. godot/ice.js draws exactly the same shapes and timing.

// the colours from the palette: deep and blue ice, a bright rim, white light
export function iceColors(pal) {
  const blue = pal.cols[1] || pal.rim;
  return { core: pal.core, rim: pal.rim, blue, deep: mixRgb(pal.cols[0], [8, 18, 48], 0.35), vapor: mixRgb(pal.rim, pal.core, 0.45) };
}

// whole turns per loop: about one every 8 frames
export const iceCycles = (n) => Math.max(1, Math.round((n || 8) / 8));

// where the light comes from (up and forward, in the flight's frame)
const LX = 0.35, LY = -0.94;

// a path from its oldest point to the head, measured back from the head:
// at(d) → [x, y, nx, ny] (nx, ny: the normal), len
export function alongPath(pts) {
  const rev = [...pts].reverse(), ds = [0];
  for (let i = 1; i < rev.length; i++) ds.push(ds[i - 1] + Math.hypot(rev[i][0] - rev[i - 1][0], rev[i][1] - rev[i - 1][1]));
  const len = ds[ds.length - 1];
  const at = (d) => {
    d = Math.max(0, Math.min(len, d));
    let i = 1;
    while (i < rev.length - 1 && ds[i] < d) i++;
    const a = rev[i - 1], b = rev[i], s = ds[i] - ds[i - 1], k = s > 1e-9 ? (d - ds[i - 1]) / s : 0;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [a[0] + dx * k, a[1] + dy * k, -dy / l, dx / l];
  };
  return { len, at };
}

// a faceted lump of ice round `at`: `sides` corners at uneven distances, the
// facets fanning from a point a little off its middle, each lit by how much
// it faces the light. P: the random numbers it is cut from.
export function iceLump(P, at, size, rot, sides, stretch = 1) {
  const corners = [];
  for (let k = 0; k < sides; k++) {
    const a = k * TAU / sides + (P() - 0.5) * (3 / sides), rad = size * (0.58 + 0.52 * P());
    corners.push([Math.cos(a) * rad * stretch, Math.sin(a) * rad]);
  }
  const ox = (P() - 0.5) * 0.3 * size, oy = (P() - 0.5) * 0.3 * size, c = Math.cos(rot), s = Math.sin(rot);
  const place = ([x, y]) => [at[0] + x * c - y * s, at[1] + x * s + y * c];
  const pts = corners.map(place), mid = place([ox, oy]), facets = [];
  for (let k = 0; k < sides; k++) {
    const a = pts[k], b = pts[(k + 1) % sides], mx = (a[0] + b[0]) / 2 - mid[0], my = (a[1] + b[1]) / 2 - mid[1], l = Math.hypot(mx, my) || 1;
    facets.push({ pts: [mid, a, b], light: Math.max(0, Math.min(1, 0.5 + 0.5 * (mx * LX + my * LY) / l)) });
  }
  return { pts, mid, facets };
}

// one lump painted: its facets in ice colours, its lit edges catching the light
export function drawLump(g, lump, col, alpha, lw, dark) {
  if (alpha <= 0.005) return;
  g.globalCompositeOperation = "source-over";
  for (const f of lump.facets) {
    const tone = mixRgb(mixRgb(col.deep, col.blue, 0.25 + 0.5 * f.light), col.core, Math.pow(f.light, 2) * 0.7);
    g.fillStyle = rgba(tone, 0.93 * alpha);
    g.beginPath(); f.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill();
  }
  g.globalCompositeOperation = dark ? "source-over" : "lighter";
  g.lineCap = "round";
  // frosted edges all round, brightest where they face the light
  for (const f of lump.facets) {
    g.strokeStyle = rgba(col.core, (0.18 + Math.max(0, f.light - 0.5) * 1.5) * alpha); g.lineWidth = lw;
    g.beginPath(); g.moveTo(...f.pts[1]); g.lineTo(...f.pts[2]); g.stroke();
  }
  g.globalCompositeOperation = "source-over";
}

// the vapour behind the head, for a path of length len: puffs swelling then
// thinning out, swaying either side, and a bright wake just behind the head
export function iceVapor(len, r, t, n, seed, width = 1) {
  const ph = t * TAU * iceCycles(n), out = [];
  if (len < 1) return out;
  const N = Math.max(4, Math.min(64, Math.round(len / (r * 0.3))));
  for (let k = 0; k <= N; k++) {
    const d = len * k / N, f = d / len, sway = Math.sin(d / (r * 1.7) - ph + seed) * r * 0.4 * f * width;
    const size = r * (1.0 + 0.9 * Math.sin(Math.PI * Math.min(1, f * 1.6)) * (1 - f) + 0.3 * (1 - f)) * width;
    out.push({ d, off: sway, r: size * (0.85 + 0.15 * Math.sin(k * 1.7 + ph)), a: Math.pow(1 - f, 1.3) * 0.09, hot: false });
  }
  const reach = Math.min(len, r * 4), C = Math.max(2, Math.round(reach / (r * 0.2)));
  for (let k = 0; k <= C; k++) {
    const f = k / C;
    out.push({ d: reach * f, off: 0, r: r * 0.75 * (1 - 0.7 * f) * Math.min(1.5, width), a: 0.1 * Math.pow(1 - f, 1.4), hot: true });
  }
  return out;
}

export function drawIceVapor(g, c, pts, r, strength = 1, width = 1) {
  const path = alongPath(pts), col = iceColors(c.pal);
  if (path.len < 1) return;
  g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
  for (const m of iceVapor(path.len, r, c.t, c.n, c.seed, width)) {
    const [x, y, nx, ny] = path.at(m.d), tone = m.hot ? col.core : col.vapor, a = m.a * strength;
    blob(g, x + nx * m.off, y + ny * m.off, m.r, [[0, tone, a], [0.5, tone, a * 0.45], [1, tone, 0]]);
  }
  g.globalCompositeOperation = "source-over";
}

// standing still (原地循环): chips breaking off and streaming back behind it,
// in its own frame; each comes round once a loop
export function iceStillChips(r, t, n, seed, amount = 1) {
  const P = rng(seed * 61 + 13), cyc = iceCycles(n), out = [];
  for (let k = 0, K = Math.round(14 * Math.max(0, amount)); k < K; k++) {
    const ph = P(), side = P() * 2 - 1, size = r * (0.2 + 0.26 * P()), rot = P() * TAU, spin = (P() < 0.5 ? -1 : 1) * (1 + Math.floor(P() * 2)), sides = 3 + Math.floor(P() * 2);
    const p = frac(ph + t * cyc), shape = rng(seed * 7 + k * 131 + 3);
    out.push({ lump: iceLump(shape, [-r * (0.7 + 6.5 * p), side * r * (0.25 + 1.1 * p) + r * 0.5 * p * p], size * (1 - 0.4 * p), rot + spin * p * TAU, sides),
      alpha: smooth(0, 0.08, p) * Math.pow(1 - p, 1.2) });
  }
  return out;
}

// the chunk at the head, in its own frame (x forward), tumbling a whole turn a loop
export function iceHead(r, t, seed) {
  return iceLump(rng(seed * 97 + 5), [0, 0], r, t * TAU, 9, 1.35);
}

// the head at (0, 0), flying along +x
export function drawIceHead(g, c, r) {
  const { pal, t } = c, col = iceColors(pal), light = pal.dark ? "source-over" : "lighter";
  g.globalCompositeOperation = light;
  g.save(); g.scale(1.3, 1);
  blob(g, 0, 0, 2.2 * r, [[0, col.rim, 0.28], [0.5, col.rim, 0.1], [1, col.rim, 0]]);
  g.restore();
  blob(g, 0.7 * r, 0, 1.1 * r, [[0, col.core, 0.25], [1, col.rim, 0]]);
  const head = iceHead(r, t, c.seed);
  drawLump(g, head, col, 1, Math.max(0.6, r * 0.07), pal.dark);
  g.globalCompositeOperation = light;
  // light inside the ice, cracks, a glint where the light strikes
  g.beginPath(); head.pts.forEach(([x, y], i) => { const px = head.mid[0] + (x - head.mid[0]) * 0.55, py = head.mid[1] + (y - head.mid[1]) * 0.55; i ? g.lineTo(px, py) : g.moveTo(px, py); });
  g.closePath(); g.fillStyle = rgba(col.core, 0.18); g.fill();
  g.strokeStyle = rgba(col.core, 0.35); g.lineWidth = Math.max(0.4, r * 0.035);
  for (const k of [1, 4, 6]) { const v = head.pts[k]; g.beginPath(); g.moveTo(...head.mid); g.lineTo(head.mid[0] + (v[0] - head.mid[0]) * 0.75, head.mid[1] + (v[1] - head.mid[1]) * 0.75); g.stroke(); }
  blob(g, head.mid[0] + LX * r * 0.45, head.mid[1] + LY * r * 0.45, 0.3 * r, [[0, col.core, 0.6], [1, col.core, 0]]);
  g.globalCompositeOperation = "source-over";
}

export function drawIceMeteor(g, c, r, still) {
  if (still) {
    drawIceVapor(g, c, Array.from({ length: 9 }, (_, i) => [-r * 6 * (1 - i / 8), 0]), r);
    const col = iceColors(c.pal), lw = Math.max(0.5, r * 0.04);
    for (const chip of iceStillChips(r, c.t, c.n, c.seed, c.amount)) drawLump(g, chip.lump, col, chip.alpha, lw, c.pal.dark);
  }
  drawIceHead(g, c, r);
}

// glints off the ice: a four-pointed twinkle at (x, y)
export function twinkle(g, x, y, size, pal, a) {
  if (a <= 0.01) return;
  blob(g, x, y, size, [[0, pal.core, 0.8 * a], [1, pal.rim, 0]]);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) streak(g, [x + dx * size * 1.8, y + dy * size * 1.8], [x, y], pal.rim, pal.core, 0.75 * a, Math.max(0.4, size * 0.22));
}
