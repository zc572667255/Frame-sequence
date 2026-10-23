import { createCanvas } from "../../core/util.js";
import { rng, rgba, clamp01, smooth, drawBlurred } from "../../trails/glow/util.js";
import { star } from "../../trails/glow/shapes.js";
import { TAU, easeOut, frac, mixRgb, at, blob, sparks, trail, comet, placed } from "../common.js";

// 翅膀: wings of light, the spirit rather than the form. Each wing has the
// build of a real one — a bright arm bowing up and out from the root to the
// wrist, and feathers growing all along it: hanging down and out by the
// root, longer and turning outward toward the tip, where they end in a high
// point — but every feather is drawn as a wisp of glowing strands, bright
// where it leaves the arm and thinning to a flame-like tip, so the lower
// edge is a ragged fringe of light. The roots meet in a bright glow, a faint
// veil fills the wing, sparks hang about it. 正面: a spread pair; 侧面: the
// near wing swept back with the far one smaller and dimmer behind it.
export function wings(g, c) {
  const { t, R, cx, cy, pal } = c;
  const side = c.view === "side";
  const n = Math.max(18, Math.min(110, Math.round(60 * Math.sqrt(Math.max(0.2, c.amount)))));
  const open = c.loop ? 1 : easeOut(t / 0.35, 2);
  const gone = c.loop ? 0 : smooth(0.62, 1, t);
  // the wingbeat, as birds and butterflies do it: a quick, strong downstroke
  // and a slower recovery. u: +1 wings up, −1 wings down; vel: −1 sweeping
  // down … +1 rising. A loop is one whole beat (it starts and ends up top);
  // a one-shot beats once, gently, while it is held open.
  const cyc = c.loop ? t : clamp01(t / 0.62), down = 0.42, amp = c.loop ? 1 : 0.6;
  const u = amp * (cyc < down ? 1 - 2 * smooth(0, down, cyc) : -1 + 2 * smooth(down, 1, cyc));
  const vel = amp * (cyc < down ? -Math.sin(Math.PI * cyc / down) : Math.sin(Math.PI * (cyc - down) / (1 - down)));
  const P = rng(c.seed * 97 + 11);
  const strands = Array.from({ length: n }, () => [P(), P(), P(), P(), P()]);
  const M = 18, lw = Math.max(0.6, R * 0.012) * (c.pixel ? 1.8 : 1);
  const lower = pal.cols[Math.min(2, pal.cols.length - 1)];
  g.globalCompositeOperation = "lighter";
  // one wing: dir 1 spreads to the right, -1 to the left; at: the root;
  // k: its size; a: its strength
  const wing = (dir, at, k, a) => {
    // its size, as big as the area allows; on the way up it folds in a
    // little at the wrist, the downstroke has it fully spread
    // (sized so the widest spread stays inside the box — measured)
    const S = (side ? Math.min(c.rx * 0.55, c.ry * 0.58) * 0.9 : Math.min(c.rx * 0.48, c.ry * 0.72) * 0.82) * k
      * (0.35 + 0.65 * open) * (1 - (side ? 0.25 : 0.12) * Math.max(0, vel));
    // the stroke turns the wing about its root — far, seen from the side;
    // from the front it also turns back over the body on the way up, so it
    // looks narrower then (a butterfly closing). Drawn in the wing's own
    // frame (x out from the root, y down), then placed:
    const psi = side ? -0.15 - 0.85 * u : -0.5 * u, fx = side ? 1 : 1 - 0.42 * Math.max(0, u);
    const cs = Math.cos(psi), sn = Math.sin(psi);
    const at2 = (x, y) => [at[0] + dir * fx * (x * cs - y * sn), at[1] + x * sn + y * cs];
    // the arm: from the root up and out in a bow to the wrist
    const T = [S * 0.95, -S * 0.38], C = [S * 0.38, -S * 0.55];
    const arm = (s) => { const r = 1 - s; return [2 * r * s * C[0] + s * s * T[0], 2 * r * s * C[1] + s * s * T[1]]; };
    // a feather from arm position s: down and out by the root, out and a
    // little up at the tip, longer outward, curving down along its length.
    // The strands trail the stroke, tips and inner feathers most.
    const feather = (s, j1, j2, ph, sp) => {
      const [x0, y0] = arm(s), phi = 0.95 + (-0.25 - 0.95) * Math.pow(s, 0.9) + (j1 - 0.5) * 0.14;
      const len = S * (0.5 + 0.55 * Math.pow(s, 0.7)) * (0.75 + 0.5 * j2), bend = 0.1 + 0.25 * (1 - s);
      const pts = [];
      let x = x0, y = y0;
      for (let i = 0; i <= M; i++) {
        const e = i / M;
        const wave = S * 0.02 * Math.sin(TAU * t * sp + ph + e * 4) * e;
        const lag = S * (side ? 0.2 : 0.15) * vel * e * e * (0.3 + (1 - s));
        pts.push(at2(x, y + wave + lag));
        const ang = phi + bend * e;
        x += Math.cos(ang) * len / M; y += Math.sin(ang) * len / M;
      }
      return pts;
    };
    const bone = Array.from({ length: M + 1 }, (_, i) => at2(...arm(i / M)));
    // the veil: soft light over the whole wing, the arm down to the tips
    if (!c.pixel) {
      const V = createCanvas(c.w, c.h), vg = V.getContext("2d");
      const [rx0, ry0] = at2(S * 0.3, 0), gr = vg.createRadialGradient(rx0, ry0, 0, rx0, ry0, S * 1.3);
      gr.addColorStop(0, rgba(pal.core, 0.26 * a));
      gr.addColorStop(0.4, rgba(pal.rim, 0.14 * a));
      gr.addColorStop(1, rgba(lower, 0));
      vg.fillStyle = gr;
      vg.beginPath();
      bone.forEach(([x, y], i) => (i ? vg.lineTo(x, y) : vg.moveTo(x, y)));
      for (let i = 12; i >= 0; i--) { const p = feather(i / 12, 0.5, 0.5, 0, 0); vg.lineTo(p[M - 3][0], p[M - 3][1]); }
      vg.closePath(); vg.fill();
      g.globalAlpha = 1 - gone;
      drawBlurred(g, [V], Math.max(2, R * 0.06));
      g.globalAlpha = 1;
    }
    // the feathers: wisps full along their length, thinning out at the tips; they
    // come apart from the arm outward as it fades
    const from = Math.floor(gone * (M - 2)), tips = [];
    for (const [r0, r1, r2, r3, r4] of strands) {
      const s = Math.pow(r0, 0.85), pts = feather(s, r1, r2, r4 * TAU, 1 + Math.floor(r3 * 2));
      tips.push([pts[M], s]);
      const col = { rim: mixRgb(pal.rim, lower, Math.min(1, (1 - s) * 0.8)), core: pal.core };
      trail(g, col, pts.slice(from), lw * (0.9 + 0.7 * s) * (0.7 + 0.6 * r2), a * (0.42 + 0.3 * s) * (1 - 0.7 * gone), false);
    }
    // the arm: the leading edge, brightest
    trail(g, pal, bone.slice(from), lw * 2.4, a * (1 - 0.6 * gone), false);
    // sparks hanging about the wing and drifting off its edge
    for (let m = 0; m < Math.round(26 * c.amount * (1 + 2 * gone)); m++) {
      const [tip, s] = tips[Math.floor(P() * tips.length)], back = P(), out = 0.4 + P(), drop = P(), r = P();
      const ph = P(), sp = 1 + Math.floor(P() * 2), p = frac(ph + t * sp), tw = Math.sin(Math.PI * p);
      // shed from the feather tips: out and down, the fall speeding up
      const at = (q) => [tip[0] + dir * R * 0.2 * (q * out - back * 0.6), tip[1] + R * (0.3 * q * q * (1.3 - s) - 0.15 * back * drop)];
      if (r < 0.25 && !c.pixel) { const [x, y] = at(p); star(g, [x, y], Math.max(1.5, R * 0.03), pal.rim, a * tw, 0); }
      else comet(g, pal, at, p, 0.3, Math.max(0.6, R * (0.006 + 0.008 * r)) * (c.pixel ? 1.8 : 1), a * tw);
    }
    return at2(0, 0);
  };
  if (side) {
    // facing right: both wings swept back to the left, the far one behind
    wing(-1, [cx + R * 0.45, cy - R * 0.02], 0.8, 0.45);
    const root = wing(-1, [cx + R * 0.38, cy + R * 0.08], 1.05, 1);
    blob(g, root[0], root[1], R * 0.26, [[0, pal.core, 0.6 * (1 - gone)], [0.35, pal.rim, 0.3 * (1 - gone)], [1, pal.rim, 0]]);
  } else {
    wing(1, [cx + R * 0.03, cy + R * 0.1], 1, 1);
    wing(-1, [cx - R * 0.03, cy + R * 0.1], 1, 1);
    // where the roots meet: the brightest light
    blob(g, cx, cy + R * 0.1, R * 0.32, [[0, pal.core, 0.75 * (1 - gone)], [0.3, pal.rim, 0.35 * (1 - gone)], [1, pal.rim, 0]]);
  }
}
