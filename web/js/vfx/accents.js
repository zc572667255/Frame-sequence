// 光效点缀: the attack trails' accents — stars, dust, embers, snow, shards,
// lightning, rays, bubbles, drops, leaves, rocks — laid over any effect, drawn
// with the trails' own shapes (trails/glow/shapes.js) in the effect's palette.
//
// The trails scatter theirs along the swing and draw a new set every frame;
// here each accent has its own place in the effect's area (round the centre,
// the whole of what wraps a figure, or rising off the ground) and moves in
// whole cycles over the sequence, so a loop still closes. A one-shot fades
// them in and out with itself.
//
// How much of each: 按配色 (the default) takes the mix of the trail preset the
// palette comes from — 冰晶 brings snow and shards, 雷光 lightning, 炎爆
// embers, 岩崩 rocks; 无 none; 自定义 the effect's own acc_<id> amounts.
import { rng, rgba, smooth, colorAcross } from "../trails/glow/util.js";
import { star, crystal, rockShape, teardrop } from "../trails/glow/shapes.js";
import { TAU, easeOut, frac, blob, jag, bolt } from "./common.js";

// look: the trail preset's setting the automatic mix reads; scale: to 0..100
export const ACCENTS = [
  { id: "stars", name: "星光", look: "sparkles", scale: 5 },
  { id: "dust", name: "粉尘", look: "dust" },
  { id: "embers", name: "余烬", look: "embers" },
  { id: "snow", name: "雪花", look: "snow" },
  { id: "shards", name: "碎片", look: "shards" },
  { id: "bolts", name: "闪电", look: "bolts" },
  { id: "rays", name: "光芒", look: "rays" },
  { id: "bubbles", name: "气泡", look: "bubbles" },
  { id: "drops", name: "水滴", look: "drops" },
  { id: "leaves", name: "落叶", look: "leaves" },
  { id: "rocks", name: "碎石", look: "rocks" },
];

export const ACC_MODES = [["auto", "按配色（同拖尾）"], ["none", "无"], ["custom", "自定义"]];

// the automatic mix as strong as on the trail it comes from
const AUTO = 1;

// { [id]: 0..1 } of what to draw, or null
export function accentAmounts(s, preset) {
  const mode = s.acc || "auto";
  if (mode === "none") return null;
  const look = (preset && preset.look) || {};
  const out = {};
  for (const a of ACCENTS) {
    const v = mode === "custom" ? +s["acc_" + a.id] || 0 : Math.min(100, (look[a.look] || 0) * (a.scale || 1)) * AUTO;
    if (v > 0) out[a.id] = v / 100;
  }
  return Object.keys(out).length ? out : null;
}

// the automatic amounts as numbers (to start 自定义 from), 0..100
export function autoAccents(preset) {
  const look = (preset && preset.look) || {};
  return Object.fromEntries(ACCENTS.map((a) => ["acc_" + a.id, Math.round(Math.min(100, (look[a.look] || 0) * (a.scale || 1)) * AUTO)]));
}

const WRAPS = new Set(["aura", "burn", "wings", "ribbon"]);
const GROUND = new Set(["heal", "circle", "dust"]);
const BURST = new Set(["hit", "explosion", "charge"]);

// the effect's area for its accents: a centre, radii, where the ground or the
// bottom is and where the top is
function area(c) {
  const wraps = WRAPS.has(c.kind), ground = GROUND.has(c.kind) || (c.kind === "shock" && c.squash < 0.98);
  const rx = wraps ? c.rx : c.R, ry = wraps ? c.ry : ground ? c.R * 0.8 : c.R;
  const y = ground ? c.gy - ry * 0.5 : c.cy;
  return { x: c.cx, y, rx, ry, s: Math.min(rx, ry), bottom: ground ? c.gy : y + ry * 0.8, top: y - ry, burst: BURST.has(c.kind) };
}

const inEllipse = (A, P, k = 1) => { const th = P() * TAU, r = Math.sqrt(P()) * k; return [A.x + Math.cos(th) * A.rx * r, A.y + Math.sin(th) * A.ry * r]; };

const DRAW = {
  // four-point stars twinkling on and off where they are
  stars(g, c, A, amt, env, P) {
    const cols = c.pal.cols;
    for (let k = Math.round(16 * amt); k > 0; k--) {
      const p = inEllipse(A, P, 1.1), ph = P(), sp = 1 + Math.floor(P() * 2), size = Math.max(1.5, A.s * 0.08 * (0.5 + P())), col = colorAcross(cols, 0.4 + 0.6 * P()), tilt = P() * 0.6;
      const tw = Math.pow(Math.max(0, Math.sin(TAU * frac(ph + c.t * sp))), 2) * env;
      if (tw > 0.05) star(g, p, size, col, tw, tilt);
    }
  },

  // fine motes hanging in the air, drifting to and fro
  dust(g, c, A, amt, env, P) {
    const { cols, core } = c.pal;
    for (let k = Math.round(40 * amt); k > 0; k--) {
      const [x, y] = inEllipse(A, P, 1.15), th = P() * TAU, ph = P(), ph2 = P(), col = colorAcross(cols, 0.45 + 0.55 * P());
      const d = A.s * 0.12 * Math.sin(TAU * frac(ph + c.t));
      const a = (0.35 + 0.65 * Math.pow(Math.sin(TAU * frac(ph2 + c.t)), 2)) * env;
      blob(g, x + Math.cos(th) * d, y + Math.sin(th) * d, Math.max(0.8, A.s * 0.02), [[0, core, a], [0.4, col, 0.7 * a], [1, col, 0]]);
    }
  },

  // sparks rising from the bottom, swaying, burning out
  embers(g, c, A, amt, env, P) {
    const { core, rim } = c.pal;
    const span = A.bottom - (A.top - A.ry * 0.3);
    for (let k = Math.round(20 * amt); k > 0; k--) {
      const ux = (P() * 2 - 1) * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU, sz = 0.8 + P();
      const p = frac(ph + c.t * sp), a = Math.sin(Math.PI * p) * (1 - 0.4 * p) * env;
      const x = A.x + ux * A.rx + Math.sin(sw + p * TAU) * A.rx * 0.1, y = A.bottom - span * p;
      blob(g, x, y, Math.max(1.2, A.s * 0.05 * sz), [[0, core, a], [0.45, rim, 0.6 * a], [1, rim, 0]]);
    }
  },

  // six-armed flakes drifting down, turning
  snow(g, c, A, amt, env, P) {
    const { core, rim } = c.pal;
    const y0 = A.top - A.ry * 0.2, span = A.bottom + A.ry * 0.2 - y0;
    g.lineCap = "round";
    for (let k = Math.round(22 * amt); k > 0; k--) {
      const ux = (P() * 2 - 1) * 1.05, ph = P(), sw = P() * TAU, dir = P() < 0.5 ? 1 : -1, size = Math.max(2, A.s * (0.07 + 0.08 * Math.pow(P(), 2)));
      const p = frac(ph + c.t), a = Math.sin(Math.PI * p) * env;
      if (a < 0.05) continue;
      const x = A.x + ux * A.rx + Math.sin(sw + p * TAU) * A.rx * 0.08, y = y0 + span * p, spin = sw + dir * TAU * p;
      blob(g, x, y, size * 1.2, [[0, rim, 0.35 * a], [1, rim, 0]]);
      g.strokeStyle = rgba(core, 0.9 * a);
      g.lineWidth = Math.max(0.5, size / 9);
      g.beginPath();
      for (let arm = 0; arm < 6; arm++) {
        const th = spin + (arm * Math.PI) / 3, dx = Math.cos(th), dy = Math.sin(th);
        g.moveTo(x, y); g.lineTo(x + dx * size, y + dy * size);
        for (const [at0, bl] of [[0.45, 0.32], [0.7, 0.22]]) {
          const bx = x + dx * size * at0, by = y + dy * size * at0;
          for (const sgn of [1, -1]) { const bt = th + sgn * Math.PI / 3; g.moveTo(bx, by); g.lineTo(bx + Math.cos(bt) * size * bl, by + Math.sin(bt) * size * bl); }
        }
      }
      g.stroke();
    }
  },

  // faceted shards thrown out from the centre, turning as they go
  shards(g, c, A, amt, env, P) {
    const { cols, core } = c.pal;
    g.globalCompositeOperation = "source-over";
    for (let k = Math.round(14 * amt); k > 0; k--) {
      const th = P() * TAU, ph = P(), sp = 1 + Math.floor(P() * 2), len = A.s * (0.16 + 0.14 * P()), turn = (P() - 0.5) * 2;
      const p = frac(ph + c.t * sp), a = (1 - p) * smooth(0, 0.08, p) * env;
      if (a < 0.03) continue;
      const d = A.s * (0.15 + 1.0 * easeOut(p)), sp2 = th + turn * p * Math.PI;
      const along = [Math.cos(sp2), Math.sin(sp2)], out = [-along[1], along[0]];
      crystal(g, [A.x + Math.cos(th) * d * A.rx / A.s, A.y + Math.sin(th) * d * A.ry / A.s], along, out, len, len * 0.42, cols[3] || core, cols[1], core, a);
    }
  },

  // lightning crawling round the area, new every frame
  bolts(g, c, A, amt, env) {
    const B = rng(c.seed * 977 + c.i * 7919 + 3);
    for (let k = Math.max(1, Math.round(3 * amt)); k > 0; k--) {
      if (B() < 0.3) continue;
      let th = B() * TAU, r = 0.75 + 0.25 * B();
      const pts = [];
      for (let j = 0; j < 5; j++) { pts.push([A.x + Math.cos(th) * A.rx * r, A.y + Math.sin(th) * A.ry * r]); th += 0.22 + 0.15 * B(); r = Math.max(0.5, Math.min(1.1, r + (B() - 0.5) * 0.4)); }
      bolt(g, c.pal, jag(pts, B, A.s * 0.06), Math.max(0.8, A.s * 0.018), (0.6 + 0.4 * B()) * env);
    }
  },

  // long rays fanning out from the centre, turning one gap per loop — in a
  // loop each one taking on the next one's slant, width and flicker on the
  // way, so the last frame leads back into the first
  rays(g, c, A, amt, env, P) {
    const { core, rim } = c.pal;
    const N = 8, rot = TAU / N * c.t * (c.loop ? 1 : 0.5), m = c.loop ? c.t : 0;
    const rs = Array.from({ length: N }, () => ({ j: (P() - 0.5) * 0.3, ph: P(), w: 0.05 + 0.06 * P() }));
    const mix = (u, v) => u + (v - u) * m;
    for (let k = 0; k < N; k++) {
      const r0 = rs[k], r1 = rs[(k + 1) % N];
      const th = rot + k * TAU / N + mix(r0.j, r1.j), wid = A.s * mix(r0.w, r1.w);
      const len = A.s * (1.05 + 0.35 * mix(Math.sin(TAU * frac(r0.ph + c.t)), Math.sin(TAU * frac(r1.ph + c.t)))), a = 0.55 * Math.min(1, amt * 1.4) * env;
      const dx = Math.cos(th), dy = Math.sin(th), ex = A.x + dx * len * A.rx / A.s, ey = A.y + dy * len * A.ry / A.s;
      const gr = g.createLinearGradient(A.x, A.y, ex, ey);
      gr.addColorStop(0, rgba(core, a)); gr.addColorStop(0.4, rgba(rim, 0.5 * a)); gr.addColorStop(1, rgba(rim, 0));
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(A.x - dy * wid, A.y + dx * wid); g.lineTo(ex, ey); g.lineTo(A.x + dy * wid, A.y - dx * wid); g.closePath(); g.fill();
    }
  },

  // bubbles rising and wobbling
  bubbles(g, c, A, amt, env, P) {
    const { core, rim } = c.pal;
    const span = A.bottom - (A.top - A.ry * 0.2);
    for (let k = Math.round(20 * amt); k > 0; k--) {
      const ux = (P() * 2 - 1) * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU, size = Math.max(1.5, A.s * (0.04 + 0.05 * Math.pow(P(), 1.5)));
      const p = frac(ph + c.t * sp), a = Math.sin(Math.PI * p) * env;
      if (a < 0.05) continue;
      const x = A.x + ux * A.rx + Math.sin(sw + p * TAU * 2) * size * 0.8, y = A.bottom - span * p;
      g.strokeStyle = rgba(rim, 0.75 * a); g.lineWidth = Math.max(0.6, size / 5);
      g.beginPath(); g.arc(x, y, size, 0, TAU); g.stroke();
      g.fillStyle = rgba(rim, 0.12 * a); g.fill();
      g.fillStyle = rgba(core, 0.9 * a);
      g.beginPath(); g.arc(x - size * 0.35, y - size * 0.35, Math.max(0.5, size * 0.22), 0, TAU); g.fill();
    }
  },

  // drops flung up and out, falling back
  drops(g, c, A, amt, env, P) {
    const { cols, core } = c.pal;
    g.globalCompositeOperation = "source-over";
    for (let k = Math.round(16 * amt); k > 0; k--) {
      const th = -Math.PI * (0.1 + 0.8 * P()), ph = P(), sp = 1 + Math.floor(P() * 2), r = Math.max(1.2, A.s * (0.035 + 0.03 * P())), reach = 0.6 + 0.6 * P();
      const p = frac(ph + c.t * sp), a = Math.sin(Math.PI * p) * env;
      if (a < 0.05) continue;
      const vx = Math.cos(th) * reach, vy = Math.sin(th) * reach;
      const x = A.x + vx * A.s * 1.2 * p, y = A.y + (vy * 1.2 * p + 1.1 * p * p) * A.s;
      const dx = vx, dy = vy + 2.2 * p, dl = Math.hypot(dx, dy) || 1;
      teardrop(g, [x, y], dx / dl, dy / dl, r, r * 3, cols, core, a);
    }
  },

  // leaves blown across, turning over
  leaves(g, c, A, amt, env, P) {
    const cols = c.pal.cols;
    g.globalCompositeOperation = "source-over";
    for (let k = Math.round(14 * amt); k > 0; k--) {
      const dir = P() < 0.5 ? 1 : -1, ph = P(), y0 = A.y + (P() * 2 - 1) * A.ry * 0.8, sw = P() * TAU, size = Math.max(2.5, A.s * (0.07 + 0.06 * P()));
      const p = frac(ph + c.t), a = Math.sin(Math.PI * p) * env;
      if (a < 0.05) continue;
      const cx = A.x + dir * (p * 2.4 - 1.2) * A.rx, cy = y0 + Math.sin(TAU * (p + sw)) * A.ry * 0.2;
      const turn = sw + TAU * p * dir, flip = Math.abs(Math.cos(TAU * p * 2 + sw));
      const ax = Math.cos(turn), ay = Math.sin(turn), nx = -ay * flip, ny = ax * flip;
      const tip = [cx + ax * size, cy + ay * size], tail = [cx - ax * size, cy - ay * size];
      g.beginPath(); g.moveTo(tail[0], tail[1]);
      g.quadraticCurveTo(cx + nx * size * 0.9, cy + ny * size * 0.9, tip[0], tip[1]);
      g.quadraticCurveTo(cx - nx * size * 0.9, cy - ny * size * 0.9, tail[0], tail[1]);
      g.closePath();
      g.fillStyle = rgba(cols[1], 0.9 * a); g.fill();
      g.strokeStyle = rgba(cols[2], 0.9 * a); g.lineWidth = Math.max(0.5, size / 8);
      g.beginPath(); g.moveTo(tail[0], tail[1]); g.lineTo(tip[0], tip[1]); g.stroke();
    }
  },

  // stones: flung out of a burst and falling, or kicked up off the ground
  // (or the bottom of what wraps a figure), tumbling
  rocks(g, c, A, amt, env, P) {
    const cols = c.pal.cols;
    g.globalCompositeOperation = "source-over";
    for (let k = Math.round(12 * amt); k > 0; k--) {
      const ux = (P() * 2 - 1) * 0.7, side = (P() * 2 - 1) * 0.6, up = 0.8 + 0.8 * P(), th = P() * TAU, reach = 0.7 + 0.6 * P(), ph = P(), sp = 1 + Math.floor(P() * 2), size = Math.max(1.5, A.s * (0.05 + 0.06 * P())), shape = Math.floor(P() * 1e6), spin0 = P() * TAU;
      const p = frac(ph + c.t * sp), a = Math.pow(Math.sin(Math.PI * p), 0.5) * env;
      if (a < 0.05) continue;
      let x, y;
      if (A.burst) { const d = A.s * reach * easeOut(p, 1.6); x = A.x + Math.cos(th) * d; y = A.y + Math.sin(th) * d + A.s * 0.7 * p * p; }
      else { x = A.x + ux * A.rx + side * A.s * p; y = A.bottom - (up * p - up * p * p) * A.s * 1.6; }
      rockShape(g, [x, y], size, spin0 + TAU * p, rng(shape), cols, a);
    }
  },
};

// draw the accents over what the kind drew (before turning, glow and pixels)
export function drawAccents(g, c, amounts) {
  if (!amounts) return;
  const A = area(c);
  const env = c.loop ? 1 : smooth(0, 0.1, c.t) * (1 - smooth(0.6, 1, c.t));
  if (env <= 0.01) return;
  ACCENTS.forEach((a, n) => {
    const amt = amounts[a.id];
    if (!amt) return;
    // light adds up; a dark preset (黑炎) paints instead
    g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
    g.globalAlpha = 1;
    DRAW[a.id](g, c, A, amt, env, rng(c.seed * 1009 + n * 7919 + 11));
  });
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}
