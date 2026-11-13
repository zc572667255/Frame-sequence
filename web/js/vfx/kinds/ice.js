import { rgba, rng, smooth } from "../../trails/glow/util.js";
import { TAU, frac, mixRgb, blob, streak } from "../common.js";

// 冰矛: a slender crystal lance pointing along +x, r the body radius. Four
// flat facets (a lit bevel and face above the ridge, a shaded face and bevel
// below it) with a broken back end, a bright ridge, a glint on the upper edge,
// a light sweeping along the ridge towards a sparkling tip and a cold halo.
// godot/ice.js draws exactly the same shapes, colours and timing.
//
// roll: how far it has turned about its own axis; it only changes how lit the
// upper face is, so the outline stays steady.

// the shapes, in the body's own frame (x forward, y down)
export function iceSpear(r, seed = 1) {
  const p = (x, y) => [x * r, y * r];
  const T = p(2.7, 0), Su = p(0.3, -0.52), Sd = p(0.3, 0.52), Wu = p(-0.95, -0.4), Wd = p(-0.95, 0.4);
  const Bu = p(-1.45, -0.27), Bn = p(-1.22, -0.03), Bd = p(-1.6, 0.17);
  const Iu1 = p(0.25, -0.35), Iu2 = p(-0.95, -0.25), Id1 = p(0.25, 0.37), Id2 = p(-0.95, 0.28);
  const Rs = [0.3 * r, Bn[1] * (2.7 - 0.3) / (2.7 + 1.22)];
  const P = rng(seed * 97 + 5);
  // a few fractures inside, fixed per seed
  const cracks = [
    [p(-0.7 + P() * 0.4, -0.03), p(-0.25 + P() * 0.5, -0.22)],
    [p(0.5 + P() * 0.5, -0.02), p(0.9 + P() * 0.5, -0.17)],
    [p(-0.5 + P() * 0.5, 0.04), p(-0.1 + P() * 0.5, 0.24)],
  ];
  return {
    tip: T, back: Bn, ridge: [Bn, Rs, T], edge: [Bu, Wu, Su, T], cracks,
    outline: [T, Su, Wu, Bu, Bn, Bd, Wd, Sd],
    faces: [
      { tone: 0, pts: [T, Su, Wu, Bu, Iu2, Iu1] },
      { tone: 1, pts: [T, Iu1, Iu2, Bu, Bn, Rs] },
      { tone: 2, pts: [T, Rs, Bn, Bd, Id2, Id1] },
      { tone: 3, pts: [T, Id1, Id2, Bd, Wd, Sd] },
    ],
    x0: Bd[0], x1: T[0],
  };
}

// each facet's colour at its back and at the tip: [rgb, alpha] pairs
export function iceTones(pal, roll) {
  const deep = mixRgb(pal.cols[0], [6, 14, 40], 0.45), blue = pal.cols[0], cyan = pal.cols[1] || pal.rim, core = pal.core;
  const lit = 0.5 + 0.5 * Math.cos(roll);
  return [
    [[mixRgb(cyan, core, 0.35), 0.85], [core, 0.98]],
    [[mixRgb(blue, cyan, 0.45), 0.7], [mixRgb(cyan, core, 0.2 + 0.25 * lit), 0.92]],
    [[mixRgb(deep, blue, 0.6), 0.75], [mixRgb(blue, cyan, 0.4 + 0.2 * (1 - lit)), 0.9]],
    [[deep, 0.85], [mixRgb(deep, blue, 0.5), 0.9]],
  ];
}

function polygon(g, pts) { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); }
function polyline(g, pts, col, a, w) {
  g.strokeStyle = rgba(col, a); g.lineWidth = w; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
}

// the lance at (0, 0); t: time 0..1 (the sweep runs twice a loop)
export function drawIceSpear(g, c, r) {
  const { pal, t } = c, sp = iceSpear(r, c.seed), tones = iceTones(pal, t * TAU + c.seed);
  const light = pal.dark ? "source-over" : "lighter";
  g.globalCompositeOperation = light;
  g.save(); g.translate(0.4 * r, 0); g.scale(1.7, 0.75);
  blob(g, 0, 0, 1.9 * r, [[0, pal.rim, 0.22], [0.5, pal.rim, 0.08], [1, pal.rim, 0]]);
  g.restore();
  g.globalCompositeOperation = "source-over";
  for (const face of sp.faces) {
    const [[c0, a0], [c1, a1]] = tones[face.tone], gr = g.createLinearGradient(sp.x0, 0, sp.x1, 0);
    gr.addColorStop(0, rgba(c0, a0)); gr.addColorStop(1, rgba(c1, a1));
    g.fillStyle = gr; polygon(g, face.pts); g.fill();
  }
  g.globalCompositeOperation = light;
  const w = Math.max(0.6, r * 0.07);
  for (const [a, b] of sp.cracks) polyline(g, [a, b], pal.core, 0.3, Math.max(0.4, r * 0.03));
  streak(g, sp.ridge[0], sp.tip, pal.rim, pal.core, 0.85, w);
  polyline(g, sp.edge, pal.core, 0.55, Math.max(0.5, r * 0.045));
  // a light running along the ridge to the tip
  const s = frac(t * 2), x = -1.1 * r + 3.4 * r * s, y = sp.back[1] * (sp.tip[0] - x) / (sp.tip[0] - sp.back[0]);
  blob(g, x, y, 0.35 * r, [[0, pal.core, 0.55 * Math.sin(Math.PI * s)], [1, pal.core, 0]]);
  // the tip sparkles
  const tw = 0.7 + 0.3 * Math.sin(t * TAU * 2), [tx, ty] = sp.tip;
  blob(g, tx, ty, 0.55 * r, [[0, pal.core, 0.9 * tw], [0.4, pal.rim, 0.35 * tw], [1, pal.rim, 0]]);
  for (const [dx, dy] of [[-0.6, 0], [0.45, 0], [0, -0.35], [0, 0.35]]) streak(g, [tx + dx * r, ty + dy * r], sp.tip, pal.rim, pal.core, 0.75 * tw, Math.max(0.5, r * 0.05));
  g.globalCompositeOperation = "source-over";
}

// how wide the wake behind it is: inside the back of the body
export function iceTrailProfile(r) { return { half: 0.34 * r, offset: 0 }; }
export const iceTrailHalfWidth = (r) => iceTrailProfile(r).half;
