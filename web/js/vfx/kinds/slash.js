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

export const SLASH_SPAN = 170 * Math.PI / 180;
const HALF_SECTIONS = 16;
// where along the trail a whole crescent starts: past the trail's faded tail
export const SLASH_U0 = 0.35;
export const SLASH_SHAPES = [["full", "两头尖"], ["half", "半头"]];

// after it arrives: fading out over the 命中消散 frames (hit 0 → 1)
export const slashFade = (hit) => 1 - smooth(0, 1, hit);

// the flight's own frame on screen: x along the flight, y across it pointing
// down the screen (so "up" stays up whichever way it flies)
export function slashFrame(travel) {
  const x = [Math.cos(travel), Math.sin(travel)];
  let y = [-x[1], x[0]];
  if (y[1] < 0 || (Math.abs(y[1]) < 1e-9 && y[0] < 0)) y = [-y[0], -y[1]];
  return { x, y };
}

// the crescent as one trail run, sections { a (inner edge), b (outer, hot
// edge), u }: 两头尖 runs whole from its upper tip to its lower one — its
// thickness alone makes both tips pointed, and u starts well into the trail
// so neither end fades away; 半头 runs from the upper tip to the flat cut in
// the middle, the trail's thick head. at: its middle; half: half its chord
// (upright); thick: its greatest thickness; ground: its angle to the ground
// the crescent's own frame: place(x, y) puts a point of the upright crescent
// (x forward, y down, its middle at the origin) on screen; its outer edge is
// the circle of radius A round [cx, 0], at angle phi (0 its middle, -SPAN/2
// its upper tip)
// The ground angle, -90 … 90: how far it is laid down is |ground| (90 upright,
// 0 flat, seen from the side squashed), which way the sign: above 0 the lower
// tip trails back (its top leans forward), below 0 the upper tip does (its top
// leans back) — the same crescent upside down.
export function slashTilt(ground) {
  const g = Math.max(-90, Math.min(90, Number(ground) || 0)), th = Math.abs(g) * Math.PI / 180;
  return { squash: 0.3 + 0.7 * Math.sin(th), shear: (g < 0 ? -0.25 : 0.25) * Math.cos(th) };
}

export function slashFrameOf(at, travel, half, ground) {
  const { squash, shear } = slashTilt(ground);
  const { x: X, y: Y } = slashFrame(travel);
  const A = half / Math.sin(SLASH_SPAN / 2), sag = A * (1 - Math.cos(SLASH_SPAN / 2));
  const place = (x, y) => { const px = x - y * shear, py = y * squash; return [at[0] + X[0] * px + Y[0] * py, at[1] + X[1] * px + Y[1] * py]; };
  // and back: a point on screen in the upright crescent's own frame
  const unplace = ([qx, qy]) => { const dx = qx - at[0], dy = qy - at[1], py = dx * Y[0] + dy * Y[1], y = py / squash; return [dx * X[0] + dy * X[1] + y * shear, y]; };
  return { place, unplace, A, sag, cx: -A * Math.cos(SLASH_SPAN / 2) - sag / 2 };
}

// how far each end weakens: the share of its length over which a tip fades out
export const SLASH_END_FADE = 0.3;
// the crescent's ends weakening: for a point on screen, how much of the light
// there is kept (0 past a tip, rising smoothly to 1 in the middle). It goes by
// where along the arc the point lies (its angle round the arc's centre), so
// the glow round it fades with it; 半头 fades at its upper tip only
export function slashEnds(at, travel, half, ground, shape = "full") {
  const { unplace, cx } = slashFrameOf(at, travel, half, ground);
  return (p) => {
    const [x, y] = unplace(p), s = (Math.atan2(y, x - cx) + SLASH_SPAN / 2) / SLASH_SPAN;
    return smooth(0, SLASH_END_FADE, s) * (shape === "half" ? 1 : smooth(0, SLASH_END_FADE, 1 - s));
  };
}

// a glow canvas faded towards the crescent's ends (its alpha scaled per pixel)
function fadeEnds(cv, ends) {
  const b = cv.bbox || { x0: 0, y0: 0, w: cv.width, h: cv.height };
  const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0)), w = Math.min(cv.width - x0, Math.ceil(b.w) + 1), h = Math.min(cv.height - y0, Math.ceil(b.h) + 1);
  if (w <= 0 || h <= 0) return;
  const g = cv.getContext("2d"), img = g.getImageData(x0, y0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3]) d[i + 3] = Math.round(d[i + 3] * ends([x0 + x + 0.5, y0 + y + 0.5]));
  }
  g.putImageData(img, x0, y0);
}

// how deep the crescent is (its outer arc's middle ahead of the line between
// its tips), for half its chord: thickness is a share of this
export const slashDepth = (half) => half / Math.sin(SLASH_SPAN / 2) * (1 - Math.cos(SLASH_SPAN / 2));

// The inner edge is an arc too — the circle through both tips whose middle is
// `thick` inside the outer arc's — so the hollow is always hollow: thick is
// kept under the crescent's depth. Its distance in from the outer arc along
// the ray from the outer arc's centre at angle phi.
export function slashInset(A, thick, phi) {
  const a = A * Math.cos(SLASH_SPAN / 2), m = A - Math.min(thick, 0.95 * (A - a)), d = (m * m - A * A) / (2 * (m - a)), B = m - d;
  const t = d * Math.cos(phi) + Math.sqrt(Math.max(0, d * d * Math.cos(phi) ** 2 - d * d + B * B));
  return Math.max(A - t, thick * 0.02);
}

export function slashRuns(at, travel, half, thick, ground, shape = "full") {
  const { place, A, sag } = slashFrameOf(at, travel, half, ground);
  const section = (s, u) => {
    const phi = -SLASH_SPAN / 2 + SLASH_SPAN * s, W = slashInset(A, thick, phi);
    const nx = Math.cos(phi), ny = Math.sin(phi), ox = A * nx - A * Math.cos(SLASH_SPAN / 2) - sag / 2, oy = A * ny;
    return { a: place(ox - nx * W, oy - ny * W), b: place(ox, oy), u };
  };
  const run = [];
  if (shape === "half") for (let k = 0; k <= HALF_SECTIONS; k++) run.push(section(0.5 * k / HALF_SECTIONS, k / HALF_SECTIONS));
  else for (let k = 0, n = 2 * HALF_SECTIONS; k <= n; k++) run.push(section(k / n, SLASH_U0 + (1 - SLASH_U0) * k / n));
  return [run];
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
  const half = r * 4 * scale, thick = slashDepth(half) * Math.max(10, Math.min(90, s.slashThick ?? 60)) / 100, ground = s.slashAngle ?? 90;
  // (the flowing-blade layer smears past a pointed tip; the straight speed
  // lines are drawn curving instead, below)
  const look = glowStyle(c.pal.preset), style = { ...look, flow: 0, speedLines: 0 }, ends = slashEnds(at, travel, half, ground, s.slashShape);
  slashRuns(at, travel, half, thick, ground, s.slashShape).forEach((run, side) => {
    const cv = renderGlow([run], style, c.w, c.h, { seed: c.seed * 4 + k * 2 + side, frame: c.i, alpha, fade: 0.3, fx: false });
    if (!cv) return;
    // both ends weaken and fade out, not just thin
    fadeEnds(cv, ends);
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

// where the crescent (and, while it flies, its faint after-image) is:
// [{ at, travel, scale, alpha, k }]. It flies whole all the way to the end
// point, then over the 命中消散 frames drifts on a little, swells and fades
// out there — the whole of its frames, from appearing to gone.
export function slashCopies(s, w, h, state, index, r = 0) {
  const dirAt = (u) => { const a = pathAt(s, w, h, Math.max(0, u - 0.005), index), b = pathAt(s, w, h, Math.min(1, u + 0.005), index); return Math.atan2(b[1] - a[1], b[0] - a[0]); };
  if (!state.body) {
    if (!(state.hit >= 0 && state.hit < 1)) return [];
    const end = pathAt(s, w, h, 1, index), travel = dirAt(1), drift = r * 0.8 * state.hit;
    return [{ at: [end[0] + Math.cos(travel) * drift, end[1] + Math.sin(travel) * drift], travel, scale: 1 + 0.15 * state.hit, alpha: slashFade(state.hit), k: 0 }];
  }
  const grow = state.launched ? 1 : 0.15 + 0.85 * state.charge, out = [];
  for (const [lag, fade, k] of [[0.06, 0.22, 1], [0, 1, 0]]) {
    if (lag && (!state.launched || state.u - lag < 0)) continue;
    const u = Math.max(0, state.u - lag);
    out.push({ at: pathAt(s, w, h, u, index), travel: dirAt(u), scale: grow, alpha: fade, k });
  }
  return out;
}

export function drawSlashFlight(g, c, s, state, index, r) {
  for (const p of slashCopies(s, c.w, c.h, state, index, r)) drawSlashAt(g, c, s, p.at, p.travel, r, p.scale, p.alpha, p.k);
}
