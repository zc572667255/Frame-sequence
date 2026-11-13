import { rgba, rng } from "../../trails/glow/util.js";
import { TAU, mixRgb, blob, streak } from "../common.js";

// 冰矛, as a frost bolt: a white-hot core of cold light with a cluster of ice
// crystals turning inside it, a blue halo, and behind it a comet of frost —
// soft mist, three wisps spiralling round the path, a bright streak and
// twinkling motes. godot/ice.js draws exactly the same shapes and timing.

const LILAC = [176, 164, 255];
// the bolt's colours from the palette: icy white core, blue rim, a lilac haze
export function frostColors(pal) {
  const blue = pal.cols[1] || pal.rim;
  return { core: pal.core, rim: pal.rim, blue, mist: mixRgb(pal.rim, LILAC, 0.35), deep: mixRgb(pal.cols[0], [10, 20, 60], 0.3) };
}

// whole turns of the wisps per loop: about one every 8 frames
export const frostCycles = (n) => Math.max(1, Math.round((n || 8) / 8));

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

// what the tail is made of at time t (0..1), for a path of length len:
// mist puffs, wisps (polylines with a width and alpha per point), motes
export function frostTail(len, r, t, n, seed, amount = 1, width = 1) {
  const ph = t * TAU * frostCycles(n), P = rng(seed * 173 + 41), mist = [], wisps = [], motes = [];
  if (len < 1) return { mist, wisps, motes };
  // soft frost mist: dense overlapping puffs, swelling a little then thinning
  // out towards the tail, swaying either side of the path
  const N = Math.max(4, Math.min(64, Math.round(len / (r * 0.3))));
  for (let k = 0; k <= N; k++) {
    const d = len * k / N, f = d / len, sway = Math.sin(d / (r * 1.7) - ph + seed) * r * 0.45 * f * width;
    const size = r * (1.2 + 1.1 * Math.sin(Math.PI * Math.min(1, f * 1.6)) * (1 - f) + 0.4 * (1 - f)) * width;
    mist.push({ d, off: sway, r: size * (0.85 + 0.15 * Math.sin(k * 1.7 + ph)), a: Math.pow(1 - f, 1.3) * 0.11, f });
  }
  // the hot streak just behind the head: a chain of small bright puffs
  const reach = Math.min(len, r * 6), C = Math.max(2, Math.round(reach / (r * 0.18)));
  for (let k = 0; k <= C; k++) {
    const d = reach * k / C, f = d / reach;
    mist.push({ d, off: 0, r: r * 0.6 * (1 - 0.75 * f) * Math.min(1.5, width), a: 0.16 * Math.pow(1 - f, 1.4), f: 0, hot: true });
  }
  const M = Math.max(6, Math.min(120, Math.round(len / (r * 0.25))));
  for (let j = 0; j < 3; j++) {
    const off = j * TAU / 3, pts = [];
    for (let k = 0; k <= M; k++) {
      const d = len * k / M, f = d / len, a = d / (r * 1.4) - ph * 2 + off;
      pts.push({ d, off: Math.sin(a) * r * (0.35 + 1.1 * f) * width, w: Math.max(0.5, r * 0.22 * Math.pow(1 - f, 0.8)), a: Math.pow(1 - f, 1.1) * 0.75 * (0.55 + 0.45 * Math.cos(a)), f });
    }
    wisps.push(pts);
  }
  for (let k = 0, K = Math.round(10 * Math.max(0, amount)); k < K; k++) {
    const d = P() * len, f = d / len, side = (P() - 0.5) * r * 1.6 * (0.3 + f) * width, tw = P() * TAU, size = r * (0.12 + 0.15 * P()) * (1 - 0.6 * f);
    motes.push({ d, off: side, size, a: (0.5 + 0.5 * Math.sin(ph * 2 + tw)) * (1 - f) });
  }
  return { mist, wisps, motes };
}

// a four-pointed twinkle at (x, y)
export function twinkle(g, x, y, size, pal, a) {
  if (a <= 0.01) return;
  blob(g, x, y, size, [[0, pal.core, 0.8 * a], [1, pal.rim, 0]]);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) streak(g, [x + dx * size * 1.8, y + dy * size * 1.8], [x, y], pal.rim, pal.core, 0.75 * a, Math.max(0.4, size * 0.22));
}

// the tail along pts (oldest → head), in the canvas' coordinates
export function drawFrostTail(g, c, pts, r, strength = 1, width = 1) {
  const path = alongPath(pts), tail = frostTail(path.len, r, c.t, c.n, c.seed, c.amount, width), col = frostColors(c.pal);
  if (path.len < 1) return;
  const place = (d, off) => { const [x, y, nx, ny] = path.at(d); return [x + nx * off, y + ny * off]; };
  g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
  for (const m of tail.mist) {
    const [x, y] = place(m.d, m.off), tone = m.hot ? col.core : mixRgb(col.rim, col.mist, Math.min(1, m.f * 1.2));
    blob(g, x, y, m.r, [[0, tone, m.a * strength], [0.5, tone, m.a * 0.45 * strength], [1, tone, 0]]);
  }
  for (const wisp of tail.wisps) for (let k = 1; k < wisp.length; k++) {
    const p = wisp[k - 1], q = wisp[k];
    g.strokeStyle = rgba(mixRgb(col.core, col.rim, p.f), p.a * strength); g.lineWidth = p.w; g.lineCap = "butt";
    g.beginPath(); g.moveTo(...place(p.d, p.off)); g.lineTo(...place(q.d, q.off)); g.stroke();
  }
  for (const m of tail.motes) { const [x, y] = place(m.d, m.off); twinkle(g, x, y, m.size, c.pal, m.a * strength); }
  g.globalCompositeOperation = "source-over";
}

// the crystals inside the head, in its own frame (x forward): diamonds from
// the middle, each with a lit side and a shaded side, turning slowly
export function frostCrystals(r, t, seed) {
  const P = rng(seed * 97 + 5), turn = t * TAU, out = [];
  const arms = [[0, 1.0], [Math.PI, 0.85], [1.05, 0.7], [-1.1, 0.75], [2.15, 0.65], [-2.2, 0.6]];
  for (const [a0, l0] of arms) {
    const a = a0 + (P() - 0.5) * 0.3 + Math.sin(turn + a0) * 0.12, len = r * l0 * (0.85 + 0.3 * P()), w = len * 0.2;
    const d = [Math.cos(a), Math.sin(a)], nv = [-d[1] * w, d[0] * w], m = [d[0] * len * 0.35, d[1] * len * 0.35], tip = [d[0] * len, d[1] * len];
    out.push({ lit: [[0, 0], [m[0] + nv[0], m[1] + nv[1]], tip], dark: [[0, 0], tip, [m[0] - nv[0], m[1] - nv[1]]], tip });
  }
  return out;
}

function fill(g, pts, col, a) { g.fillStyle = rgba(col, a); g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); }

// the head at (0, 0), flying along +x
export function drawFrostHead(g, c, r) {
  const { pal, t } = c, col = frostColors(pal), light = pal.dark ? "source-over" : "lighter";
  const tw = 0.85 + 0.15 * Math.sin(t * TAU * frostCycles(c.n) * 3);
  g.globalCompositeOperation = light;
  g.save(); g.scale(1.25, 0.9);
  blob(g, 0, 0, 2.6 * r, [[0, col.rim, 0.35], [0.45, col.mist, 0.14], [1, col.mist, 0]]);
  g.restore();
  blob(g, 0, 0, 1.6 * r, [[0, col.mist, 0.4], [1, col.mist, 0]]);
  g.globalCompositeOperation = "source-over";
  const crystals = frostCrystals(r, t, c.seed);
  for (const k of crystals) { fill(g, k.lit, mixRgb(col.blue, col.core, 0.7), 0.9); fill(g, k.dark, mixRgb(col.deep, col.blue, 0.55), 0.8); }
  g.globalCompositeOperation = light;
  for (const k of crystals) streak(g, [0, 0], k.tip, col.rim, col.core, 0.6, Math.max(0.5, r * 0.06));
  blob(g, 0, 0, 1.05 * r, [[0, col.core, tw], [0.35, col.core, 0.8 * tw], [1, col.rim, 0]]);
  for (const [x, y, s] of [[-1.6, 0, 1], [1.2, 0, 1], [0, -0.7, 0.7], [0, 0.7, 0.7]]) streak(g, [x * r, y * r], [0, 0], col.rim, col.core, 0.8 * tw * s, Math.max(0.5, r * 0.1));
  g.globalCompositeOperation = "source-over";
}

// standing still (原地循环): a short straight tail behind it, then the head
export function drawFrostBolt(g, c, r, withTail) {
  if (withTail) drawFrostTail(g, c, Array.from({ length: 9 }, (_, i) => [-r * 6 * (1 - i / 8), 0]), r);
  drawFrostHead(g, c, r);
}
