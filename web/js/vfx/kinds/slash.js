import { renderGlow, glowStyle } from "../../trails/glow.js";
import { smooth } from "../../trails/glow/util.js";
import { pathAt } from "../remote.js";

// 剑气: a crescent of sword light, drawn exactly as an attack trail of the
// palette's name is (trails/glow.js: 烈焰斩 in flames, 冰晶 in crystals, 雷光
// in lightning …), flying along the flight path from near the viewer (big)
// to far away (small) and fading out there. Its angle to the ground (地面
// 夹角) turns it from a flat sweep along the ground (0°) through a slanted cut
// to an upright one (90°); lying flatter, it is seen more foreshortened. Its
// bulge always leads the flight. godot/slash.js draws exactly the same.

export const SLASH_SPAN = 140 * Math.PI / 180;
const SLASH_SECTIONS = 32;

// perspective: 1 near, `far` (0..1) at the end of the flight
export const slashScale = (u, far) => 1 / (1 + (1 / Math.max(0.05, far) - 1) * Math.max(0, Math.min(1, u)));
// gone by the far end
export const slashFade = (u) => 1 - smooth(0.7, 1, u);

// the crescent as trail sections { a (inner edge), b (outer, hot edge), u },
// u running from its thin tail tip to its head; at: its middle; travel: the
// flight's direction on screen (radians); half: half its chord; thick: its
// greatest thickness; ground: its angle to the ground (degrees)
export function slashRun(at, travel, half, thick, ground) {
  const th = Math.max(0, Math.min(90, ground)) * Math.PI / 180, c = Math.cos(th), s = Math.sin(th), squash = 0.6 + 0.4 * s;
  const place = ([x, y]) => [x * c + y * s, (-x * s + y * c) * squash];
  // its bulge leads: if the turned shape would point back, mirror it
  const fwd = place([0, -1]), flip = fwd[0] * Math.cos(travel) + fwd[1] * Math.sin(travel) < 0 ? -1 : 1;
  const A = half / Math.sin(SLASH_SPAN / 2), sag = A * (1 - Math.cos(SLASH_SPAN / 2)), out = [];
  for (let k = 0; k <= SLASH_SECTIONS; k++) {
    const u = k / SLASH_SECTIONS, phi = -SLASH_SPAN / 2 + SLASH_SPAN * u, W = thick * (0.04 + 0.96 * Math.pow(Math.sin(Math.PI * u), 0.7) * (0.55 + 0.45 * u));
    const nx = Math.sin(phi), ny = -Math.cos(phi) * flip, ox = A * nx, oy = (A * Math.cos(SLASH_SPAN / 2) - A * Math.cos(phi) + sag / 2) * flip;
    const b = place([ox, oy]), a = place([ox - nx * W, oy - ny * W]);
    out.push({ a: [at[0] + a[0], at[1] + a[1]], b: [at[0] + b[0], at[1] + b[1]], u });
  }
  return out;
}

// one crescent, painted onto g (canvas coordinates)
export function drawSlashAt(g, c, s, at, travel, r, scale, alpha, k) {
  if (alpha <= 0.01 || scale <= 0) return;
  const half = r * 4 * scale, thick = half * 0.5 * Math.max(0.1, (s.trailWidth ?? 70) / 70);
  const run = slashRun(at, travel, half, thick, s.slashAngle ?? 0);
  const cv = renderGlow([run], glowStyle(c.pal.preset), c.w, c.h, { seed: c.seed * 2 + k, frame: c.i, alpha, fade: 0.6, fx: false });
  if (!cv) return;
  g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
  g.drawImage(cv, 0, 0);
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
    out.push({ at: p, travel: Math.atan2(b[1] - a[1], b[0] - a[0]), scale: slashScale(u, (s.slashFar ?? 25) / 100) * grow, alpha: slashFade(u) * fade, k });
  }
  return out;
}

export function drawSlashFlight(g, c, s, state, index, r) {
  for (const p of slashCopies(s, c.w, c.h, state, index)) drawSlashAt(g, c, s, p.at, p.travel, r, p.scale, p.alpha, p.k);
}
