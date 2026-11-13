import { renderGlow, glowStyle } from "../../trails/glow.js";
import { smooth, rng, rgba } from "../../trails/glow/util.js";
import { pathAt } from "../remote.js";

// 剑气 (2D, side view): a crescent of sword light drawn exactly as an attack
// trail of the palette's name is (trails/glow.js: 烈焰斩 in flames, 冰晶 in
// crystals, 雷光 in lightning …). It flies along the flight path (left to
// right by default), its bulge leading and its tips trailing, and fades out
// at the far end.
//   外形: 两头尖 — the whole crescent, pointed at both tips; 半头 — only its
//         upper half, cut off flat at its thick middle, which rides the path.
//   地面夹角: 90° stands it upright; laying it down towards 0° (parallel to
//         the ground) flattens it into a thin ">" seen from the side, its
//         lower tip trailing a little further back.
// godot/slash.js draws exactly the same.

export const SLASH_SPAN = 140 * Math.PI / 180;
const HALF_SECTIONS = 16;
export const SLASH_SHAPES = [["full", "两头尖"], ["half", "半头"]];

// gone by the far end
export const slashFade = (u) => 1 - smooth(0.7, 1, u);

// the flight's own frame on screen: x along the flight, y across it pointing
// down the screen (so "up" stays up whichever way it flies)
export function slashFrame(travel) {
  const x = [Math.cos(travel), Math.sin(travel)];
  let y = [-x[1], x[0]];
  if (y[1] < 0 || (Math.abs(y[1]) < 1e-9 && y[0] < 0)) y = [-y[0], -y[1]];
  return { x, y };
}

// the crescent as trail runs, each from a tip to the middle (so the tips are
// pointed and the middle is the hot, thick head): sections { a (inner edge),
// b (outer, hot edge), u }. at: its middle; half: half its chord (upright);
// thick: its greatest thickness; ground: its angle to the ground (degrees);
// shape: "full" (two runs, top and bottom) or "half" (the top run only)
// the crescent's own frame: place(x, y) puts a point of the upright crescent
// (x forward, y down, its middle at the origin) on screen; its outer edge is
// the circle of radius A round [cx, 0], at angle phi (0 its middle, -SPAN/2
// its upper tip)
export function slashFrameOf(at, travel, half, ground) {
  const th = Math.max(0, Math.min(90, ground)) * Math.PI / 180, squash = 0.3 + 0.7 * Math.sin(th), shear = 0.25 * Math.cos(th);
  const { x: X, y: Y } = slashFrame(travel);
  const A = half / Math.sin(SLASH_SPAN / 2), sag = A * (1 - Math.cos(SLASH_SPAN / 2));
  const place = (x, y) => { const px = x - y * shear, py = y * squash; return [at[0] + X[0] * px + Y[0] * py, at[1] + X[1] * px + Y[1] * py]; };
  return { place, A, sag, cx: -A * Math.cos(SLASH_SPAN / 2) - sag / 2 };
}

export function slashRuns(at, travel, half, thick, ground, shape = "full") {
  const { place, A, sag } = slashFrameOf(at, travel, half, ground);
  const section = (s, u) => {
    const phi = -SLASH_SPAN / 2 + SLASH_SPAN * s, W = thick * (0.04 + 0.96 * Math.pow(Math.sin(Math.PI * s), 0.8));
    const nx = Math.cos(phi), ny = Math.sin(phi), ox = A * nx - A * Math.cos(SLASH_SPAN / 2) - sag / 2, oy = A * ny;
    return { a: place(ox - nx * W, oy - ny * W), b: place(ox, oy), u };
  };
  const runs = shape === "half" ? [[]] : [[], []];
  for (let k = 0; k <= HALF_SECTIONS; k++) {
    const u = k / HALF_SECTIONS;
    runs[0].push(section(0.5 * u, u));
    if (runs[1]) runs[1].push(section(1 - 0.5 * u, u));
  }
  return runs;
}

// 光丝: the trail's speed lines, but curving: each runs from near the middle
// along the crescent's arc towards a tip and a little past it, the way that
// end points, bright at its start and fading out. amount: the palette's
// speed lines (0..1); each line is a polyline of { p, a } and a width
export function slashLines(at, travel, half, thick, ground, shape, amount, seed, frame, alpha) {
  const { place, A, cx } = slashFrameOf(at, travel, half, ground), out = [];
  const S = rng(seed * 131 + 3), P = rng(seed * 131 + frame * 557 + 1), sides = shape === "half" ? [-1] : [-1, 1];
  for (let k = 0, N = Math.round(Math.max(0, amount) * 22); k < N; k++) {
    const dir = sides[k % sides.length], from = (0.05 + 0.3 * S()) * SLASH_SPAN / 2, to = (1 + 0.1 + 0.3 * S()) * SLASH_SPAN / 2;
    const depth = thick * (0.05 + 0.6 * S()), width = Math.max(0.6, thick / (30 + 50 * S())), a = alpha * (0.35 + 0.5 * P()), rad = A - depth, pts = [];
    for (let j = 0; j <= 16; j++) {
      const f = j / 16, phi = dir * (from + (to - from) * f);
      pts.push({ p: place(cx + Math.cos(phi) * rad, Math.sin(phi) * rad), a: a * (f < 0.3 ? 0.85 - 0.35 * f / 0.3 : 0.5 * (1 - (f - 0.3) / 0.7)) });
    }
    out.push({ pts, width });
  }
  return out;
}

// one crescent, painted onto g (canvas coordinates)
export function drawSlashAt(g, c, s, at, travel, r, scale, alpha, k) {
  if (alpha <= 0.01 || scale <= 0) return;
  const half = r * 4 * scale, thick = half * Math.max(10, Math.min(150, s.slashThick ?? 70)) / 100, ground = s.slashAngle ?? 90;
  // (the flowing-blade layer smears past a pointed tip; the straight speed
  // lines are drawn curving instead, below)
  const look = glowStyle(c.pal.preset), style = { ...look, flow: 0, speedLines: 0 };
  slashRuns(at, travel, half, thick, ground, s.slashShape).forEach((run, side) => {
    const cv = renderGlow([run], style, c.w, c.h, { seed: c.seed * 4 + k * 2 + side, frame: c.i, alpha, fade: 0.6, fx: false });
    if (!cv) return;
    g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
    g.drawImage(cv, 0, 0);
  });
  g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
  g.lineCap = "round";
  for (const line of slashLines(at, travel, half, thick, ground, s.slashShape, (+look.speedLines || 0) / 100, c.seed * 4 + k * 2, c.i, alpha)) {
    g.lineWidth = line.width;
    for (let j = 1; j < line.pts.length; j++) {
      const p = line.pts[j - 1], q = line.pts[j], tone = j < 5 ? c.pal.core : c.pal.rim;
      g.strokeStyle = rgba(tone, p.a); g.beginPath(); g.moveTo(...p.p); g.lineTo(...q.p); g.stroke();
    }
  }
  g.globalCompositeOperation = "source-over";
}

// where the crescent and its faint after-image are while it flies:
// [{ at, travel, scale, alpha, k }]
export function slashCopies(s, w, h, state, index) {
  if (!state.body) return [];
  const grow = state.launched ? 1 : 0.15 + 0.85 * state.charge, out = [];
  for (const [lag, fade, k] of [[0.06, 0.22, 1], [0, 1, 0]]) {
    if (lag && (!state.launched || state.u - lag < 0)) continue;
    const u = Math.max(0, state.u - lag), p = pathAt(s, w, h, u, index), a = pathAt(s, w, h, Math.max(0, u - 0.005), index), b = pathAt(s, w, h, Math.min(1, u + 0.005), index);
    out.push({ at: p, travel: Math.atan2(b[1] - a[1], b[0] - a[0]), scale: grow, alpha: slashFade(u) * fade, k });
  }
  return out;
}

export function drawSlashFlight(g, c, s, state, index, r) {
  for (const p of slashCopies(s, c.w, c.h, state, index)) drawSlashAt(g, c, s, p.at, p.travel, r, p.scale, p.alpha, p.k);
}
