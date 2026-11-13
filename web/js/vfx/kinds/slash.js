import { renderGlow, glowStyle } from "../../trails/glow.js";
import { smooth } from "../../trails/glow/util.js";
import { pathAt } from "../remote.js";

// 剑气 (2D, side view): a crescent of sword light, pointed at both tips and
// thickest in the middle, drawn exactly as an attack trail of the palette's
// name is (trails/glow.js: 烈焰斩 in flames, 冰晶 in crystals, 雷光 in
// lightning …). It flies along the flight path (left to right by default),
// its bulge leading, and fades out at the far end. Its angle to the ground
// (地面夹角) leans it forwards or back: 90° stands it upright, less leans its
// top forwards (the way it flies), more leans it back. godot/slash.js draws
// exactly the same.

export const SLASH_SPAN = 140 * Math.PI / 180;
const HALF_SECTIONS = 16;

// gone by the far end
export const slashFade = (u) => 1 - smooth(0.7, 1, u);

// which way along its chord and which way its bulge points, on screen, for
// an angle to the ground (degrees) and a flight going `travel` (radians):
// { chord (bottom tip → top tip), bulge }
export function slashAxes(travel, ground) {
  const th = Math.max(0, Math.min(180, ground)) * Math.PI / 180, fwd = Math.cos(travel) < -1e-9 ? -1 : 1;
  const chord = [fwd * Math.cos(th), -Math.sin(th)];
  let bulge = [-chord[1], chord[0]];
  const lead = bulge[0] * fwd;
  if (lead < -1e-9 || (Math.abs(lead) <= 1e-9 && bulge[1] > 0)) bulge = [-bulge[0], -bulge[1]];
  return { chord, bulge };
}

// the crescent as two trail runs, one from each tip to the middle (so both
// tips are pointed and the middle is the hot, thick head): sections
// { a (inner edge), b (outer, hot edge), u }. at: its middle; half: half its
// chord; thick: its greatest thickness
export function slashRuns(at, travel, half, thick, ground) {
  const { chord, bulge } = slashAxes(travel, ground);
  const A = half / Math.sin(SLASH_SPAN / 2), sag = A * (1 - Math.cos(SLASH_SPAN / 2));
  const place = (x, y) => [at[0] + bulge[0] * x + chord[0] * y, at[1] + bulge[1] * x + chord[1] * y];
  const section = (s, u) => {
    const phi = -SLASH_SPAN / 2 + SLASH_SPAN * s, W = thick * (0.04 + 0.96 * Math.pow(Math.sin(Math.PI * s), 0.8));
    const nx = Math.cos(phi), ny = Math.sin(phi), ox = A * nx - A * Math.cos(SLASH_SPAN / 2) - sag / 2, oy = A * ny;
    return { a: place(ox - nx * W, oy - ny * W), b: place(ox, oy), u };
  };
  const runs = [[], []];
  for (let k = 0; k <= HALF_SECTIONS; k++) {
    const u = k / HALF_SECTIONS;
    runs[0].push(section(0.5 * u, u));
    runs[1].push(section(1 - 0.5 * u, u));
  }
  return runs;
}

// one crescent, painted onto g (canvas coordinates)
export function drawSlashAt(g, c, s, at, travel, r, scale, alpha, k) {
  if (alpha <= 0.01 || scale <= 0) return;
  const half = r * 4 * scale, thick = half * 0.5 * Math.max(0.1, (s.trailWidth ?? 70) / 70), style = { ...glowStyle(c.pal.preset), flow: 0 }; // (the flowing-blade layer smears past a pointed tip)
  slashRuns(at, travel, half, thick, s.slashAngle ?? 90).forEach((run, side) => {
    const cv = renderGlow([run], style, c.w, c.h, { seed: c.seed * 4 + k * 2 + side, frame: c.i, alpha, fade: 0.6, fx: false });
    if (!cv) return;
    g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
    g.drawImage(cv, 0, 0);
  });
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
