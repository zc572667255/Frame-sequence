import { rgba, rng, smooth } from "../../trails/glow/util.js";
import { TAU, at, blob, field, fieldScale } from "../common.js";
import { pathAt, pathProgress } from "../remote.js";

// 水球, a ball of water, drawn after pixelfx's water orb and splash
// (https://github.com/patch-gg/pixelfx, MIT License, Copyright (c) 2026
// patch-gg; its orb follows Sprite Fusion's energy orb and its drops Sprite
// Fusion's blood, MIT License, Copyright (c) 2026 Hugo Duprez):
// - the body: see-through water whose skin wobbles, a lit rim (white on the
//   side the light comes from, upper left), deeper inside, the light
//   gathering low on the far side; a current of dashes circling inside on
//   tilted rings, bright where they pass in front; bubbles drifting up; a
//   shine up on the left; a bright fleck where the light comes to a point,
//   low on the right; glows; motes of spray on tilted orbits round it;
// - flying, the orb sloshes and wobbles elastically (volume-preserving squash
//   and stretch along its way, trailing half swaying side to side, travelling
//   surface ripples from nose to tail, interior currents and shine flexing
//   with it) while shedding teardrop beads of water that fall, puffs of mist
//   and fine spray, each left where it came off;
// - striking, it splashes: a bright burst flash and expanding shock ripple,
//   layered splash sheets and a smooth organic lip that tears apart, curved
//   tapered liquid tendrils that stretch and snap into flying beads, directional
//   heavy drops with teardrop wakes, fine spray flecks, glints and rolling mist.
// Sizes are in the orb's pixels (its radius is 19 of them, as in pixelfx).
// Everything is a function of time, so any frame can be sought and loops
// close. godot/water.js draws exactly the same.

// the 8-step water ramp (deep → white), along the palette's flame ramp (its
// darkest colour … its core): C[0..7]
export const WATER_V = [0.02, 0.1, 0.25, 0.42, 0.58, 0.7, 0.84, 1];
export const waterRamp = (pal) => WATER_V.map((v) => at(pal.flame, v));

// how many times something that happens k times in pixelfx's 3 s loop (90
// frames at 30 fps; 36 here) happens over a loop of n frames: a whole number
export const waterCycles = (k, n) => Math.max(1, Math.round(k * (n || 36) / 36));

const SQ2 = Math.SQRT2;

// the body's skin: its radius at angle a; while flying (flow), travelling
// ripples run from nose to tail and swell toward the trailing side
export const orbSkin = (a, R, w1, w2, flow = false, ang = 0) => {
  if (!flow) return R * (1 + 0.032 * Math.sin(a * 3 + w1) + 0.018 * Math.sin(a * 5 - w2));
  const aRel = a - ang, rear = 0.65 + 0.325 * (1 - Math.cos(aRel));
  return R * (1 + (0.045 * Math.sin(aRel * 2 - w1) + 0.055 * Math.sin(aRel * 3 - w2) + 0.028 * Math.sin(aRel * 4 + w1 + w2)) * rear);
};

// the body at (ex, ey) from its centre (on screen, unstretched): [ramp step,
// alpha] or null outside. The rim is about 2 orb pixels.
export function orbShade(ex, ey, R, w1, w2, flow = false, ang = 0) {
  const d = Math.hypot(ex, ey), r = orbSkin(Math.atan2(ey, ex), R, w1, w2, flow, ang);
  if (d > r) return null;
  const q = d / r, lit = (-ex - ey) / SQ2 / Math.max(0.5, d);
  if (q > 0.9) return [lit > 0.35 ? 7 : lit > -0.2 ? 5 : 3, 1];
  // a lens of water: dark on the side the light comes from, the light gathering low on the far side inside
  const gather = Math.max(0, (ex + ey) / SQ2 / r) * q;
  return [gather > 0.45 ? 4 : gather > 0.25 ? 3 : q > 0.7 ? 2 : 1, gather > 0.25 ? 0.7 : 0.35 + 0.3 * q];
}

// flying, the orb is drawn out a little along its way: a point on screen
// (from its centre) → where it falls on the round, unstretched orb
export const ORB_STRETCH = [1.07, 0.95];
export function unstretch(dx, dy, ang, k = ORB_STRETCH) {
  const c = Math.cos(ang), s = Math.sin(ang), lx = (dx * c + dy * s) / k[0], ly = (-dx * s + dy * c) / k[1];
  return [lx * c - ly * s, lx * s + ly * c];
}

// dynamic liquid sloshing while flying: volume-preserving squash & stretch
// along the flight axis plus a lateral sway of the trailing half (all whole
// cycles over n frames, so loops close cleanly)
export function waterSlosh(t, n, seed) {
  const T = t * TAU, sd = (seed * 1.17) % TAU;
  const s1 = Math.sin(T * waterCycles(4, n) + sd), s2 = Math.sin(T * waterCycles(6, n) - sd * 1.3);
  const sx = 1.09 + 0.085 * s1 + 0.03 * s2;
  const sway = 0.14 * Math.sin(T * waterCycles(3, n) + sd * 0.7) + 0.045 * Math.sin(T * waterCycles(5, n) - sd);
  return { sx, sy: 1 / sx, sway };
}

export function sloshFwd(ex, ey, R, ang, sl) {
  const c = Math.cos(ang), s = Math.sin(ang), lx = ex * c + ey * s, ly = -ex * s + ey * c;
  const back = Math.max(0, -lx / Math.max(0.5, R));
  const slx = lx * sl.sx, sly = ly * sl.sy + sl.sway * R * back * back;
  return [slx * c - sly * s, slx * s + sly * c];
}

export function sloshInv(dx, dy, R, ang, sl) {
  const c = Math.cos(ang), s = Math.sin(ang), slx = dx * c + dy * s, sly = -dx * s + dy * c;
  const lx = slx / sl.sx, back = Math.max(0, -lx / Math.max(0.5, R));
  const ly = (sly - sl.sway * R * back * back) / sl.sy;
  return [lx * c - ly * s, lx * s + ly * c];
}

// everything drawn on top of the body, for radius R at time t (0..1 over
// the loop) of n frames: the current's dashes { pts, tone, w }, bubbles
// { at, r, tone }, the shine, specks, the fleck, glows { at, r, tone, a }
// and the motes { at, front, i }. Points from the centre, on screen.
export function waterOrb(R, t, n, seed) {
  const u = R / 19, T = t * TAU, P = rng(seed * 113 + 9), dashes = [], bubbles = [], motes = [];
  // the current: three streaks circling on tilted planes, in dashes
  for (let k = 0; k < 3; k++) {
    const rr = R * (0.38 + 0.2 * k), tilt = -0.5 + k * 0.35, spin = T * (k % 2 ? -waterCycles(2, n) : waterCycles(3, n)) + k * 2;
    let run = null;
    for (let i = 0; i < 84; i++) {
      const s = i * 0.012, a = spin + s * TAU, x = Math.cos(a) * rr, z = Math.sin(a), dash = (s * 3 + k * 0.3) % 1;
      const tone = dash > 0.62 ? -1 : z > 0 ? (dash < 0.1 ? 7 : dash < 0.4 ? 6 : 5) : 3;
      const p = [x * Math.cos(tilt), x * Math.sin(tilt) * 0.6 + z * rr * 0.62];
      if (run && run.tone === tone) { run.pts.push(p); continue; }
      if (run) { run.pts.push(p); if (run.tone >= 0) dashes.push(run); }
      run = { pts: [p], tone, w: u };
    }
    if (run && run.tone >= 0 && run.pts.length > 1) dashes.push(run);
  }
  // bubbles drift up inside it
  for (let k = 0; k < 8; k++) {
    const life = 1 + 0.8 * P(), m = waterCycles(3 / life, n), ph = P(), x0 = (P() - 0.5) * R, wob = P() * TAU, two = P() < 0.35;
    const f = (t * m + ph) % 1, x = x0 + Math.sin(f * life * 4 + wob) * 1.5 * u, y = R * 0.6 - f * R * 1.2;
    if (Math.hypot(x, y) > R * 0.8) continue;
    bubbles.push({ at: [x, y], r: u * 0.6, tone: f < 0.8 ? 6 : 7 });
    if (two) bubbles.push({ at: [x + u, y], r: u * 0.55, tone: 5 });
  }
  const pulse = 0.8 + 0.2 * Math.sin(T * waterCycles(4, n));
  const glows = [
    { at: [R * 0.36, R * 0.4], r: 9 * u, tone: 5, a: 0.45 * pulse },
    { at: [0, 0], r: R * 1.4, tone: 5, a: 0.22 },
    { at: [-R * 0.4, -R * 0.5], r: 6 * u, tone: 7, a: 0.25 },
  ];
  // motes of spray on tilted orbits round it, behind and in front
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + T * waterCycles(1, n) * (i % 2 ? 1 : -1), r = R + 5 * u + (i % 3) * 3 * u, tilt = (i - 3) * 0.22, x = Math.cos(a) * r, z = Math.sin(a);
    motes.push({ at: [x * Math.cos(tilt), x * Math.sin(tilt) + z * r * 0.28], front: z >= 0, i });
  }
  return {
    u, w1: T * waterCycles(2, n), w2: T * waterCycles(3, n), dashes, bubbles, glows, motes,
    back: { r: R * 3.2, a: 0.3 + 0.05 * Math.sin(T * waterCycles(2, n)) },
    // the shine: a bright crescent up on the left; specks; the fleck where the light comes to a point
    shine: { r: R * 0.74, w: 1.8 * u, a0: Math.PI * 1.12, a1: Math.PI * 1.4 },
    specks: [{ at: [-R * 0.45, -R * 0.62], tone: 7 }, { at: [R * 0.48, R * 0.5], tone: 6 }, { at: [R * 0.48 + u, R * 0.5], tone: 5 }],
    fleck: { at: [R * 0.36, R * 0.4], r: 1.6 * u },
  };
}

// in 像素 (pixel) style the big soft glows (wider than WATER_PIXEL_GLOW orb
// pixels) are left out: snapped to blocks they would turn into flat discs
export const WATER_PIXEL_GLOW = 20;

// a soft glow (pixelfx: light falling off as (1 - d)²), added
export function glow(g, x, y, r, c, a) {
  if (r < 0.5 || a <= 0.004) return;
  blob(g, x, y, r, [[0, c, a], [0.25, c, a * 0.5625], [0.5, c, a * 0.25], [0.75, c, a * 0.0625], [1, c, 0]]);
}
const dot = (g, x, y, r, c, a = 1) => { g.fillStyle = rgba(c, a); g.beginPath(); g.arc(x, y, Math.max(0.35, r), 0, TAU); g.fill(); };
function polyline(g, pts, c, w, a = 1) {
  if (pts.length < 2 || a <= 0.005) return;
  g.strokeStyle = rgba(c, a); g.lineWidth = Math.max(0.6, w); g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
}
function fillPoly(g, pts, c, a = 1) {
  if (pts.length < 3 || a <= 0.005) return;
  g.fillStyle = rgba(c, a); g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath(); g.fill();
}
function fillStrip(g, secs, c, a = 1) {
  if (secs.length < 2 || a <= 0.005) return;
  g.fillStyle = rgba(c, a);
  g.beginPath();
  secs.forEach((q, i) => (i ? g.lineTo(q.a[0], q.a[1]) : g.moveTo(q.a[0], q.a[1])));
  for (let i = secs.length - 1; i >= 0; i--) g.lineTo(secs[i].b[0], secs[i].b[1]);
  g.closePath(); g.fill();
}
function band(g, r, w, a0, a1, c, a = 1) {
  g.fillStyle = rgba(c, a); g.beginPath(); g.arc(0, 0, r, a0, a1); g.arc(0, 0, Math.max(0, r - w), a1, a0, true); g.closePath(); g.fill();
}
function warpedBand(g, r, w, a0, a1, map, c, a = 1) {
  const pts = [], n = 12, ri = Math.max(0, r - w);
  for (let i = 0; i <= n; i++) { const th = a0 + (a1 - a0) * i / n; pts.push(map([Math.cos(th) * r, Math.sin(th) * r])); }
  for (let i = n; i >= 0; i--) { const th = a0 + (a1 - a0) * i / n; pts.push(map([Math.cos(th) * ri, Math.sin(th) * ri])); }
  fillPoly(g, pts, c, a);
}

// a bead of water at (x, y) moving along v (px a frame), pixelfx's sizes: 1 a
// fleck, 2 a small bead, 3 a round bead with a highlight; a tapered teardrop
// tail trails back along its way, longer the faster it goes. u: px per orb pixel
export function drawBead(g, x, y, v, s, C, u, a = 1, light = "lighter") {
  if (a <= 0.01) return;
  const sp = Math.hypot(v[0], v[1]) || 1, ux = v[0] / sp, uy = v[1] / sp, nx = -uy, ny = ux;
  const hr = s >= 3 ? 1.75 * u : s >= 2 ? 1.15 * u : 0.6 * u;
  const tail = Math.min((s >= 3 ? 7.5 : s >= 2 ? 6.2 : 4.5) * u, sp * 1.25);
  g.globalCompositeOperation = "source-over";
  if (tail >= hr * 0.85) {
    const w0 = hr * 0.88, wm = hr * 0.42, mid = tail * 0.46 + hr * 0.35, tip = tail + hr;
    const pts = [
      [x + nx * w0, y + ny * w0],
      [x - ux * mid + nx * wm, y - uy * mid + ny * wm],
      [x - ux * tip, y - uy * tip],
      [x - ux * mid - nx * wm, y - uy * mid - ny * wm],
      [x - nx * w0, y - ny * w0],
    ];
    fillPoly(g, pts, C[3], a * 0.88);
    const p1 = [x - ux * hr * 0.35, y - uy * hr * 0.35], p0 = [x - ux * (tail * 0.68 + hr * 0.45), y - uy * (tail * 0.68 + hr * 0.45)];
    polyline(g, [p0, p1], s > 1 ? C[5] : C[4], Math.max(0.55, hr * 0.58), a * 0.92);
  }
  if (s >= 3) { dot(g, x, y, 1.75 * u, C[4], a); dot(g, x - 0.25 * u, y - 0.25 * u, 1.15 * u, C[6], a); dot(g, x - 0.68 * u, y - 0.68 * u, 0.52 * u, C[7], a); }
  else if (s >= 2) { dot(g, x, y, 1.15 * u, C[5], a); dot(g, x - 0.35 * u, y - 0.35 * u, 0.5 * u, C[7], a); }
  else dot(g, x, y, 0.6 * u, sp > 2.2 * u ? C[6] : C[5], a);
  g.globalCompositeOperation = light;
  glow(g, x, y, (2.6 + s) * u, C[5], (0.11 + 0.05 * s) * a);
}

// a puff of mist (pixelfx Mist): a soft disc, lit on top, glowing a little
export function drawMist(g, x, y, r, c, a, C, light = "lighter") {
  if (a < 0.01 || r < 0.3) return;
  g.globalCompositeOperation = "source-over";
  blob(g, x, y, r, [[0, c, a * 0.75], [0.5, c, a * 0.56], [1, c, 0]]);
  blob(g, x - r * 0.2, y - r * 0.32, r * 0.55, [[0, C[7], a * 0.25], [1, C[7], 0]]);
  g.globalCompositeOperation = light;
  glow(g, x, y, r * 1.5, C[5], 0.16 * a);
}

// a glint (pixelfx sparkle): a cross of arms n orb pixels long, the tips in
// the lighter colour, diagonals once it is big enough, a white centre, a glow
export function drawSparkle(g, x, y, arm, c, tip, u, a = 1, light = "lighter") {
  const n = Math.round(arm);
  if (n < 1 || a <= 0.01) return;
  g.globalCompositeOperation = "source-over";
  for (let d = 1; d <= n; d++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) dot(g, x + dx * d * u, y + dy * d * u, 0.55 * u, d > n * 0.6 ? tip : c, a);
  if (n >= 3) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) dot(g, x + dx * u, y + dy * u, 0.55 * u, c, a);
  dot(g, x, y, 0.6 * u, [255, 255, 255], a);
  g.globalCompositeOperation = light;
  glow(g, x, y, (4 + n * 2) * u, c, 0.6 * a);
}

// the orb at (0, 0) of the current transform, which may be turned to its way
// of flight: it is drawn upright on screen (lit from the upper left), and
// sloshes/wobbles elastically along its way unless it stands still
export function drawWaterBody(g, c, R) {
  const m = g.getTransform(), ang = Math.atan2(m.b, m.a), C = waterRamp(c.pal), o = waterOrb(R, c.t, c.n, c.seed), light = c.pal.dark ? "source-over" : "lighter";
  const flow = !c.still, sl = flow ? waterSlosh(c.t, c.n, c.seed) : { sx: 1, sy: 1, sway: 0 }, u = o.u;
  const map = flow ? (p) => sloshFwd(p[0], p[1], R, ang, sl) : (p) => p;
  g.save(); g.rotate(-ang);
  g.globalCompositeOperation = light;
  if (!c.pixel) glow(g, 0, 0, o.back.r, C[4], o.back.a);
  g.globalCompositeOperation = "source-over";
  for (const q of o.motes) if (!q.front) dot(g, q.at[0], q.at[1], 0.6 * u, C[4]);
  const E = R * (flow ? 1.45 : 1.15);
  field(g, -E, -E, E, E, fieldScale(c, R), (x, y, px) => {
    const [ex, ey] = flow ? sloshInv(x + 0.5, y + 0.5, R, ang, sl) : [x + 0.5, y + 0.5];
    const sh = orbShade(ex, ey, R, o.w1, o.w2, flow, ang);
    if (!sh) return false;
    const col = C[sh[0]];
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = sh[1];
  });
  for (const d of o.dashes) polyline(g, flow ? d.pts.map(map) : d.pts, C[d.tone], d.w);
  for (const b of o.bubbles) { const bp = map(b.at); dot(g, bp[0], bp[1], b.r, C[b.tone]); }
  const s0 = o.shine.a0 + (o.shine.a1 - o.shine.a0) * 0.25, s1 = o.shine.a0 + (o.shine.a1 - o.shine.a0) * 0.75;
  const shOff = flow ? sl.sway * 0.65 : 0;
  if (flow) {
    warpedBand(g, o.shine.r, o.shine.w, o.shine.a0 + shOff, o.shine.a1 + shOff, map, C[6]);
    warpedBand(g, o.shine.r, o.shine.w * 0.6, s0 + shOff, s1 + shOff, map, C[7]);
  } else {
    band(g, o.shine.r, o.shine.w, o.shine.a0, o.shine.a1, C[6]);
    band(g, o.shine.r, o.shine.w * 0.6, s0, s1, C[7]);
  }
  for (const sp of o.specks) { const p = map(sp.at); dot(g, p[0], p[1], 0.6 * u, C[sp.tone]); }
  const fl = map(o.fleck.at);
  dot(g, fl[0], fl[1], o.fleck.r, C[6]);
  dot(g, fl[0], fl[1], 0.6 * u, C[7]);
  g.globalCompositeOperation = light;
  for (const gl of o.glows) if (!c.pixel || gl.r <= WATER_PIXEL_GLOW * u) { const gp = map(gl.at); glow(g, gp[0], gp[1], gl.r, C[gl.tone], gl.a); }
  for (const q of o.motes) if (q.front) {
    g.globalCompositeOperation = "source-over";
    dot(g, q.at[0], q.at[1], 0.6 * u, C[7]);
    dot(g, q.at[0] - (q.i % 2 ? -1 : 1) * u, q.at[1], 0.6 * u, C[5]);
    g.globalCompositeOperation = light;
    glow(g, q.at[0], q.at[1], 4 * u, C[5], 0.35);
  }
  g.globalCompositeOperation = "source-over";
  g.restore();
}

// what comes off the orb as it flies, each left where it came off (like the
// shed motes, remotetrail.js shed): teardrop beads of water shaken off its
// sloshing back that fall, every third with a puff of mist, every other with
// a fleck of spray; 拖尾保留 how long they last, 粒子 how many. → { beads,
// mists, flecks }, in the scene
export function waterTrail(s, w, h, state, index, R, seed, amount) {
  const out = { beads: [], mists: [], flecks: [] };
  if (amount <= 0 || s.trailFrames <= 0) return out;
  const u = R / 19, life = Math.min(14, Math.max(4, s.trailFrames)), rate = Math.max(0.35, Math.min(3.5, amount * 1.8)), G = u * 0.09;
  const postFade = 1 - smooth(0, Math.max(1, Math.min(life, s.impactFrames)), Math.max(0, state.time - s.chargeFrames - s.travelFrames));
  const oldest = Math.max(s.chargeFrames, state.time - life), newest = Math.min(state.time, s.chargeFrames + s.travelFrames);
  for (let j = Math.ceil(oldest * rate); j <= Math.floor(newest * rate); j++) {
    const P = rng(seed * 211 + j * 577 + index * 41), born = j / rate, age = state.time - born, span = life * (0.6 + 0.4 * P());
    if (age < 0 || age >= span) continue;
    const pu = pathProgress(s, (born - s.chargeFrames) / s.travelFrames), p = pathAt(s, w, h, pu, index), q = pathAt(s, w, h, Math.min(1, pu + 0.005), index);
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]), dir = [Math.cos(a), Math.sin(a)], nrm = [-dir[1], dir[0]], side = P() * 2 - 1, f = age / span;
    const at0 = [p[0] - dir[0] * R * 0.72 + nrm[0] * side * R * 0.58, p[1] - dir[1] * R * 0.72 + nrm[1] * side * R * 0.58];
    const back = u * (0.65 + 1.25 * P()), up = u * 1.15 * P(), v0 = [-dir[0] * back + nrm[0] * side * u * 0.85, -dir[1] * back + nrm[1] * side * u * 0.85 - up];
    const sz = P(), size = sz < 0.18 ? 3 : sz < 0.58 ? 2 : 1, fade = Math.min(1, (span - age) / 2) * postFade;
    const vy = v0[1] + G * age, slip = (1 - f) * 1.5 * u;
    out.beads.push({
      at: [at0[0] + v0[0] * age, at0[1] + v0[1] * age + 0.5 * G * age * age],
      v: [v0[0] * 1.4 - dir[0] * slip, vy * 1.35 - dir[1] * slip],
      s: size, a: fade,
    });
    if (j % 3 === 0) {
      const r0 = (2.5 + 1.5 * P()) * u, r1 = (7.2 + 4.2 * P()) * u, e = 1 - Math.pow(1 - f, 2.2);
      out.mists.push({ at: [at0[0] - dir[0] * u * 2 * age * 0.3, at0[1] - dir[1] * u * 2 * age * 0.3 - u * 0.25 * age], r: r0 + (r1 - r0) * e, tone: P() < 0.5 ? 6 : 5, a: 0.26 * Math.min(1, f / 0.12) * Math.pow(1 - f, 1.4) * postFade });
    }
    if (j % 2 === 0) {
      const sx = (P() - 0.5) * u * 3.2 - dir[0] * u * 0.7, sy = -u * (1 + 2.1 * P()) - dir[1] * u * 0.7;
      out.flecks.push({ at: [at0[0] + sx * age, at0[1] + sy * age + 0.5 * G * 0.6 * age * age], tone: P() < 0.5 ? 7 : 6, a: (1 - f) * postFade });
    }
  }
  return out;
}

// the splash, round the point it hit (angle: the way the orb flew), over t
// 0..1 of the hit (about a second of pixelfx's splash); sizes in the hit's
// pixels (its radius is 25 of them). → { glows, flash, rings, sheets, lip,
// fingers, beads, flecks, stars, mists }. Everything is gone by t = 1.
// the lip and its fingers open on the side it flew towards (± SPLASH_ARC), so
// the splash never closes into a ring round the point it hit
export const SPLASH_LANES = 18, SPLASH_FINGERS = 11, SPLASH_TEAR = 0.24, SPLASH_ARC = 1.42;
// how far something thrown at speed 1 has gone after dt, slowed by the air (pixelfx drops: drag)
export const SPLASH_DRAG = 1.45;
const flown = (dt) => (1 - Math.exp(-SPLASH_DRAG * dt)) / SPLASH_DRAG;
const eoc = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3), eiq = (x) => Math.pow(Math.max(0, Math.min(1, x)), 2);

// sample a curved tapered liquid tendril into left/right strip sections
function tendrilSections(from, mid, to, w0, wNeck, tipR) {
  const secs = [], steps = 7;
  const evalP = (s) => {
    const m = 1 - s;
    return [m * m * from[0] + 2 * m * s * mid[0] + s * s * to[0], m * m * from[1] + 2 * m * s * mid[1] + s * s * to[1]];
  };
  const evalT = (s) => {
    const dx = 2 * (1 - s) * (mid[0] - from[0]) + 2 * s * (to[0] - mid[0]);
    const dy = 2 * (1 - s) * (mid[1] - from[1]) + 2 * s * (to[1] - mid[1]);
    const ln = Math.hypot(dx, dy) || 1;
    return [-dy / ln, dx / ln];
  };
  const spine = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps, p = evalP(s), n = evalT(s);
    // wide root -> pinched liquid neck -> swelling tip droplet
    const hw = s < 0.72
      ? w0 * (1 - s / 0.72) + wNeck * (s / 0.72)
      : wNeck + (tipR * 0.82 - wNeck) * smooth(0.72, 1, s);
    secs.push({ a: [p[0] + n[0] * hw, p[1] + n[1] * hw], b: [p[0] - n[0] * hw, p[1] - n[1] * hw] });
    spine.push(p);
  }
  return { secs, spine };
}

export function waterSplash(Rh, amount, seed, t, angle = 0) {
  const P = rng(seed * 229 + 71), u = Rh / 25, q = Math.max(0.25, Math.min(2, amount)), end = 1 - smooth(0.72, 1, t), G = 165 * u;
  const height = (x) => 22 * u * eoc(x / 0.12) * (1 - eiq((x - 0.18) / 0.34));
  const lipR = (x) => (4 + 14.5 * eoc(x / 0.44)) * u + height(x) * 0.38 + 3.5 * u * eoc(x / 0.24);
  const fwd = (a) => 1 + 0.42 * Math.cos(a - angle);
  const out = { glows: [], flash: null, rings: [], sheets: [], lip: [], fingers: [], beads: [], flecks: [], stars: [], mists: [] };
  out.glows.push({ at: [0, -u], r: 56 * u, tone: 5, a: 0.58 * (1 - smooth(0, 0.5, t)) });
  out.glows.push({ at: [0, 0], r: 22 * u, tone: 7, a: 0.7 * (1 - smooth(0, 0.16, t)) });
  out.glows.push({ at: [0, 0], r: 36 * u, tone: 4, a: 0.22 * (1 - smooth(0, 1, t)) });
  if (t < 0.15) {
    const f = t / 0.15;
    out.flash = { r: 9.5 * u * (0.45 + 0.55 * (1 - f)) * (1 - 0.35 * f * f), arm: 6.5 * (1 - f) };
  }
  const white = t < 0.06;

  // 1) expanding impact shockwave water ring (breaks into arcs as it expands)
  if (t > 0 && t < 0.44) {
    const rf = t / 0.44, rRing = (5.5 + 26 * eoc(rf)) * u, ringA = (1 - smooth(0.24, 0.44, t)) * 0.92;
    const segs = 12, segSpan = TAU / segs;
    for (let k = 0; k < segs; k++) {
      const dropAt = 0.16 + 0.22 * P(), keep = 1 - smooth(dropAt, dropAt + 0.12, t);
      if (keep <= 0.02) continue;
      const a0 = angle + k * segSpan + 0.04, a1 = a0 + segSpan * (0.86 - 0.32 * rf), pts = [];
      for (let i = 0; i <= 5; i++) {
        const a = a0 + (a1 - a0) * i / 5, rr = rRing * (1 + 0.24 * Math.cos(a - angle));
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      out.rings.push({ pts, w: (2.2 * (1 - rf * 0.65)) * u * keep, tone: white ? 7 : 6, a: ringA * keep });
    }
  }

  // 2) organic splash sheets / water petals bursting along the impact cone (+ light recoil)
  const petalCount = 7;
  for (let k = 0; k < petalCount; k++) {
    const recoil = k >= 5;
    const a = recoil
      ? angle + Math.PI + (k === 5 ? -0.58 : 0.58) + (P() - 0.5) * 0.32
      : angle - SPLASH_ARC * 0.88 + (k + 0.5) / 5 * 2 * SPLASH_ARC * 0.88 + (P() - 0.5) * 0.2;
    const spread = (recoil ? 0.32 : 0.38) + 0.14 * P(), reach = (recoil ? 0.62 : 0.92 + 0.36 * P()) * fwd(a);
    const delay = 0.015 * P(), life = 0.36 + 0.1 * P(), dt = t - delay;
    if (dt <= 0 || dt >= life) continue;
    const f = dt / life, grow = eoc(f / 0.38), keep = 1 - smooth(0.45, 1, f);
    const rIn = (2.5 + 9 * f) * u * reach, rOut = (7 + 22 * grow) * u * reach;
    const half = spread * (0.65 + 0.45 * grow) * (0.45 + 0.55 * keep);
    const pts = [], rimPts = [];
    // narrow pinched root
    pts.push([Math.cos(a - half * 0.28) * rIn, Math.sin(a - half * 0.28) * rIn]);
    // billowing scalloped outer water crest
    for (let i = 0; i <= 8; i++) {
      const s = i / 8, ang = a - half + s * 2 * half;
      const lobe = 0.84 + 0.18 * Math.sin(s * Math.PI) + 0.11 * Math.sin(s * Math.PI * 3);
      const rr = rIn + (rOut - rIn) * lobe, pt = [Math.cos(ang) * rr, Math.sin(ang) * rr - 2.5 * u * grow * Math.sin(s * Math.PI)];
      pts.push(pt);
      if (i >= 1 && i <= 7) rimPts.push(pt);
    }
    pts.push([Math.cos(a + half * 0.28) * rIn, Math.sin(a + half * 0.28) * rIn]);
    const lit = (-Math.cos(a) - Math.sin(a)) / SQ2;
    out.sheets.push({ pts, rimPts, tone: white ? 6 : lit > 0.2 ? 5 : 4, rimTone: white || lit > -0.1 ? 7 : 6, a: keep * (recoil ? 0.56 : 0.72) });
  }

  // 3) smooth, continuous organic splash lip thrown onward (never a closed ring)
  const rt = lipR(t), span = 2 * SPLASH_ARC / SPLASH_LANES, ph1 = P() * TAU, ph2 = P() * TAU;
  for (let k = 0; k < SPLASH_LANES; k++) {
    const a0 = angle - SPLASH_ARC + k * span, a1 = a0 + span, am = (a0 + a1) / 2, uAng = (k + 0.5) / SPLASH_LANES;
    const thin = Math.sin(Math.PI * uAng), tearStart = 0.18 + 0.14 * P(), keep = 1 - smooth(tearStart, tearStart + 0.14, t);
    if (keep <= 0.02 || t <= 0) continue;
    const wave = 1 + 0.14 * Math.sin(uAng * Math.PI * 5 + ph1) + 0.07 * Math.sin(uAng * Math.PI * 9 + ph2);
    const lit = (-Math.cos(am) - Math.sin(am)) / SQ2;
    out.lip.push({ a0, a1, r: rt * wave * fwd(am), w: 3.1 * u * keep * (0.35 + 0.65 * thin), tone: white ? 7 : lit > 0.3 ? 7 : lit > -0.25 ? 6 : 5, a: keep });
  }

  // 4) curved tapered liquid tendrils stretching off the lip, snapping into flying beads
  for (let k = 0; k < SPLASH_FINGERS; k++) {
    const uAng = (k + 0.5) / SPLASH_FINGERS, a = angle - SPLASH_ARC * 0.96 + uAng * 2 * SPLASH_ARC * 0.96;
    const L = 0.45 + 0.42 * P(), va = a + (P() - 0.5) * 0.2, v = (48 + 78 * P()) * u * fwd(a), vh = (48 + 75 * P()) * u, big = P() < 0.42;
    const bend = (P() - 0.5) * 0.36, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
    const reach = 1 - smooth(SPLASH_TEAR, SPLASH_TEAR + 0.14, t), r0 = rt * fwd(a);
    const len = (9 + 19 * eoc(t / 0.26)) * u * L * reach;
    const from = [d[0] * r0 * 0.92, d[1] * r0 * 0.92];
    const to = [from[0] + d[0] * len, from[1] + d[1] * len - len * 0.22 + 0.18 * G * t * t * 0.4];
    const mid = [(from[0] + to[0]) * 0.5 + n[0] * len * bend, (from[1] + to[1]) * 0.5 + n[1] * len * bend - len * 0.12];
    if (len >= u && t > 0) {
      const w0 = (2.3 + 0.9 * (1 - t / 0.4)) * u * reach, wNeck = (0.55 + 0.35 * (1 - smooth(0.08, SPLASH_TEAR, t))) * u * reach;
      const tipR = (big ? 1.5 : 1.15) * u * Math.min(1, t / 0.06) * reach;
      out.fingers.push({ from, mid, to, w0, wNeck, tipR, tone: white ? 6 : 5, hiTone: white ? 7 : 6, a: Math.min(1, reach * 1.4) });
    }
    if (t >= SPLASH_TEAR) {
      const dt = t - SPLASH_TEAR, h0 = lipR(SPLASH_TEAR) * fwd(a), L0 = (9 + 19 * eoc(SPLASH_TEAR / 0.26)) * u * L;
      const o = [d[0] * (h0 * 0.92 + L0), d[1] * (h0 * 0.92 + L0) - L0 * 0.22];
      const vv = [Math.cos(va) * v, Math.sin(va) * v - vh];
      const spf = Math.exp(-SPLASH_DRAG * dt);
      out.beads.push({
        at: [o[0] + vv[0] * flown(dt), o[1] + vv[1] * flown(dt) + 0.5 * G * dt * dt],
        v: [vv[0] * spf / 16, (vv[1] * spf + G * dt) / 16],
        s: big ? 3 : 2, a: end,
      });
    }
  }

  // 5) primary directional jet of spray & droplets (strongly forward-biased + omni recoil)
  for (let i = 0, n = Math.round(26 * q); i < n; i++) {
    const forward = i < Math.round(18 * q);
    const a = forward ? angle + (P() - 0.5) * 2.5 : P() * TAU;
    const fw = fwd(a), v = (58 + 95 * P()) * u * (forward ? fw : 0.72), vh = (55 + 88 * P()) * u;
    const h = (1 + 4 * P()) * u, sz = P(), s = sz < 0.22 ? 3 : sz < 0.6 ? 2 : 1, delay = 0.035 * P(), dt = t - delay;
    if (dt <= 0) continue;
    const vv = [Math.cos(a) * v, Math.sin(a) * v * 0.72 - vh], spf = Math.exp(-SPLASH_DRAG * dt);
    out.beads.push({
      at: [Math.cos(a) * 3.5 * u + vv[0] * flown(dt), Math.sin(a) * 3.5 * u - h + vv[1] * flown(dt) + 0.5 * G * dt * dt],
      v: [vv[0] * spf / 16, (vv[1] * spf + G * dt) / 16],
      s, a: end,
    });
  }

  // 6) fine high-speed atomized spray flecks & water glints
  for (let i = 0, n = Math.round(24 * q); i < n; i++) {
    const a = P() * TAU, x0 = Math.cos(a) * 8 * u, y0 = Math.sin(a) * 8 * u * 0.65 - (4 + 8 * P()) * u;
    const sp = (35 + 80 * P()) * u * fwd(a), vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * 0.6 - (25 + 65 * P()) * u;
    const life = 0.58 + 0.85 * P(), isWhite = P() < 0.55, dt = t - 0.03;
    if (dt <= 0 || dt >= life) continue;
    const drag = (1 - Math.exp(-1.9 * dt)) / 1.9;
    out.flecks.push({ at: [x0 + vx * drag, y0 + vy * drag + 0.5 * G * 0.38 * dt * dt], tone: isWhite ? 7 : 6, a: (1 - dt / life) * end });
  }
  for (let i = 0; i < 7; i++) {
    const a = angle + (P() - 0.5) * 3.2, rr = (6 + 18 * P()) * u;
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr - (3 + 10 * P()) * u;
    const life = 0.24 + 0.28 * P(), arm = 1.2 + 1.6 * P(), delay = 0.03 + 0.18 * P(), k = (t - delay) / life;
    if (k > 0 && k < 1) out.stars.push({ at: [x, y - 4 * u * k * life], arm: arm * Math.sin(Math.PI * k) * 2, a: end });
  }

  // 7) heavy secondary drops tumbling as the splash crown collapses
  for (let i = 0; i < 10; i++) {
    const a = angle + (P() - 0.5) * 3.0, v = (18 + 32 * P()) * u * fwd(a), vh = (24 + 48 * P()) * u;
    const s = P() < 0.45 ? 3 : 2, dt = t - 0.26, r = lipR(0.26) * fwd(a) * 0.9;
    if (dt <= 0) continue;
    const vv = [Math.cos(a) * v, Math.sin(a) * v * 0.65 - vh], spf = Math.exp(-SPLASH_DRAG * dt);
    out.beads.push({
      at: [Math.cos(a) * r + vv[0] * flown(dt), Math.sin(a) * r * 0.65 + vv[1] * flown(dt) + 0.5 * G * dt * dt],
      v: [vv[0] * spf / 16, (vv[1] * spf + G * dt) / 16],
      s, a: end,
    });
  }

  // 8) rolling splash mist expanding outward along the blast
  for (let i = 0; i < 11; i++) {
    const a = angle + (i - 5) * 0.36 + (P() - 0.5) * 0.25, sp = (26 + 48 * P()) * u * (0.7 + 0.4 * Math.max(0, Math.cos(a - angle)));
    const x = Math.cos(a) * (4 + 7 * P()) * u, y = Math.sin(a) * (3 + 5 * P()) * u - 2 * u;
    const vx = Math.cos(a) * sp, vy = Math.sin(a) * sp * 0.7 - (5 + 12 * P()) * u;
    const r0 = (3 + 1.8 * P()) * u, r1 = (8.5 + 4.5 * P()) * u, life = 0.85 + 0.55 * P(), tone = P() < 0.5 ? 6 : 5, ma = 0.28 + 0.12 * P(), delay = 0.08 * P(), dt = t - delay;
    if (dt <= 0 || dt >= life) continue;
    const e = 1 - Math.pow(1 - dt / life, 2.2), drag = (1 - Math.exp(-2.4 * dt)) / 2.4;
    out.mists.push({ at: [x + vx * drag, y + vy * drag - 3.5 * u * dt * dt], r: r0 + (r1 - r0) * e, tone, a: ma * Math.min(1, dt / life / 0.12) * Math.pow(1 - dt / life, 1.4) * end });
  }
  return out;
}

function drawLot(g, lot, C, u, light) {
  for (const m of lot.mists) drawMist(g, m.at[0], m.at[1], m.r, C[m.tone], m.a, C, light);
  for (const b of lot.beads) drawBead(g, b.at[0], b.at[1], b.v, b.s, C, u, b.a, light);
  g.globalCompositeOperation = "source-over";
  for (const f of lot.flecks) dot(g, f.at[0], f.at[1], 0.55 * u, C[f.tone], f.a);
}

export function drawWaterImpact(g, c, radius, angle = 0) {
  const C = waterRamp(c.pal), o = waterSplash(radius, c.amount, c.seed, c.t, angle), u = radius / 25, light = c.pal.dark ? "source-over" : "lighter";
  g.save(); g.translate(c.cx, c.cy);
  g.globalCompositeOperation = light;
  for (const gl of o.glows) if (!c.pixel || gl.r <= WATER_PIXEL_GLOW * u) glow(g, gl.at[0], gl.at[1], gl.r, C[gl.tone], gl.a);
  g.globalCompositeOperation = "source-over";
  // splash sheets behind the crisp lip & tendrils
  for (const sh of o.sheets) {
    fillPoly(g, sh.pts, C[sh.tone], sh.a * 0.72);
    polyline(g, sh.rimPts, C[sh.rimTone], Math.max(0.7, 1.25 * u), sh.a);
  }
  // expanding shockwave water ring
  for (const rg of o.rings) polyline(g, rg.pts, C[rg.tone], rg.w, rg.a);
  // two-tone layered splash lip
  for (const l of o.lip) {
    band(g, l.r + l.w * 0.75, l.w * 1.45, l.a0, l.a1, C[3], l.a * 0.62);
    band(g, l.r + l.w * 0.5, l.w, l.a0, l.a1, C[l.tone], l.a);
  }
  // curved tapered liquid tendrils with glowing droplet tips
  for (const f of o.fingers) {
    const { secs, spine } = tendrilSections(f.from, f.mid, f.to, f.w0, f.wNeck, f.tipR);
    fillStrip(g, secs, C[f.tone], f.a * 0.92);
    polyline(g, spine, C[f.hiTone], Math.max(0.55, f.wNeck * 0.9), f.a * 0.95);
    if (f.tipR > 0.4) {
      dot(g, f.to[0], f.to[1], f.tipR, C[f.hiTone], f.a);
      dot(g, f.to[0] - 0.3 * u, f.to[1] - 0.3 * u, f.tipR * 0.45, C[7], f.a);
    }
  }
  drawLot(g, o, C, u, light);
  for (const s of o.stars) drawSparkle(g, s.at[0], s.at[1], s.arm, C[6], C[5], u, s.a, light);
  if (o.flash) {
    g.globalCompositeOperation = "source-over";
    dot(g, 0, 0, o.flash.r, C[7]);
    drawSparkle(g, 0, -2.5 * u, o.flash.arm, C[6], C[5], u, 1, light);
  }
  g.globalCompositeOperation = "source-over";
  g.restore();
}

export function drawWaterTrail(g, c, s, state, index, R) {
  const lot = waterTrail(s, c.w, c.h, state, index, R, c.seed, c.amount);
  drawLot(g, lot, waterRamp(c.pal), R / 19, c.pal.dark ? "source-over" : "lighter");
  g.globalCompositeOperation = "source-over";
}
