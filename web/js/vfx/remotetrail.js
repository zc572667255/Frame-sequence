// A flight wake is one continuous ribbon, in the same (u,v) coordinates as
// the trail brush and attack trails. u runs from the oldest point to the body.
import { createCanvas } from "../core/util.js";
import { uvMap } from "../trails/uv.js";
import { renderGlow, glowStyle, GLOW_PRESETS } from "../trails/glow.js";
import { bolts } from "../trails/glow/layers.js";
import { fbmNoise, rng, smooth, clamp01, rgba } from "../trails/glow/util.js";
import { at, streak, TAU } from "./common.js";
import { flightTrail, flightTrailWindow, pathAt, pathProgress } from "./remote.js";
import { projectile, projectileBounds } from "./kinds/arrow.js";
import { arrowSections } from "./arrowhead.js";
import { flameUV } from "./ribbonmesh.js";
import { iceTrailProfile } from "./kinds/ice.js";

export function ribbonSections(points, radius, kind, strength = 1, headRadius = radius) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 0.01) pts.push(p);
  if (pts.length < 2) return [];
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = lengths.at(-1), width = kind === "sand" ? 0.48 : kind === "ice" ? 0.85 : kind === "wind" ? 1.45 : kind === "arrow" ? 0.7 : kind === "fireball" ? 1.4 : 1.3;
  const normals = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1];
    if ((kind === "fireball" || kind === "ice") && i > 0 && i < pts.length - 1) {
      const incoming = Math.hypot(p[0] - a[0], p[1] - a[1]), outgoing = Math.hypot(b[0] - p[0], b[1] - p[1]);
      dx = (p[0] - a[0]) / incoming + (b[0] - p[0]) / outgoing;
      dy = (p[1] - a[1]) / incoming + (b[1] - p[1]) / outgoing;
      if (Math.hypot(dx, dy) < 0.000001) { dx = b[0] - p[0]; dy = b[1] - p[1]; }
    }
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len];
  });
  const halves = lengths.map(x => radius * width * Math.pow(x / length, kind === "sand" ? 0.7 : kind === "fireball" ? 0.58 : 0.55) * Math.sqrt(strength) * (kind === "ice" ? 1 : Math.min(1, length / Math.max(1, radius * 2))));
  if (kind === "fireball") for (let i = 0; i < pts.length; i++) {
    const join = smooth(0.6, 1, lengths[i] / length), neck = Math.min(halves[i], headRadius * 0.85 * Math.sqrt(strength));
    halves[i] += (neck - halves[i]) * join;
  }
  if (kind === "fireball" || kind === "ice") for (let i = 1; i < pts.length; i++) {
    const a = normals[i - 1], b = normals[i], dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
    const turn = Math.abs(a[0] * b[1] - a[1] * b[0]), forward = Math.min(dx * a[1] - dy * a[0], dx * b[1] - dy * b[0]);
    // Wide offsets must stay inside the bend's radius. A true reversal closes
    // the strip at its cusp, rather than swapping its two sides.
    const cap = forward <= 0.000001 || a[0] * b[0] + a[1] * b[1] < 0 ? 0 : turn > 0.000001 ? forward / turn * 0.65 : Infinity;
    halves[i - 1] = Math.min(halves[i - 1], cap); halves[i] = Math.min(halves[i], cap);
  }
  return pts.map((p, i) => {
    const n = normals[i], half = halves[i];
    return { a: [p[0] + n[0] * half, p[1] + n[1] * half], b: [p[0] - n[0] * half, p[1] - n[1] * half], u: kind === "fireball" ? i / (pts.length - 1) : lengths[i] / length };
  });
}

export function iceTrailSections(points,r,roll,seed,strength=1){
  const profile=iceTrailProfile(r,roll,seed);
  const shifted=points.map((p,i)=>{
    const a=points[Math.max(0,i-1)],b=points[Math.min(points.length-1,i+1)],len=Math.hypot(b[0]-a[0],b[1]-a[1])||1,dx=(b[0]-a[0])/len,dy=(b[1]-a[1])/len;
    return [p[0]-dx*r*0.65-dy*profile.offset,p[1]-dy*r*0.65+dx*profile.offset];
  });
  return ribbonSections(shifted,profile.half/0.85,"ice",strength,r);
}

// These equations are mirrored by the native ribbon shader in godot/remotetrail.js.
export const flameFlow = (birth, frame) => birth * 0.42 + frame * 0.1;

// The same 冰晶 preset used by the trail brush and attack trails. Geometry
// stays icy even when the projectile's colours are changed.
export function iceTrailStyle(pal) {
  return { ...glowStyle(GLOW_PRESETS.find(p => p.id === "frost")),
    glowColors: pal.preset.colors, glowCore: pal.preset.core, glowRim: pal.preset.rim, glowSplat: pal.preset.splat };
}

export function materialAt(kind, u, v, frame, noise, fine, start = 0, span = 8) {
  if (kind === "fireball") {
    // Birth time is fixed on the path. Increasing the phase transports each
    // tongue towards older points, even while the history window grows/shrinks.
    const phase = flameFlow(start + u * span, frame), d = Math.abs(v * 2 - 1);
    // Stretched, independently burning lanes carve tongues out of a wider
    // envelope. Only the material tears and flickers; the path never wriggles.
    const n = noise(phase, v * 4.2), f = fine(phase * 0.85, v * 9 + (n - 0.5) * 0.7);
    const folds = (n - 0.5) * 1.65 + (f - 0.5) * 0.55;
    const density = (1 - d) * (0.72 + u * 0.35) - 0.28 - (1 - u) * 0.16 + folds;
    const heat = clamp01(0.12 + density * 0.7 + (f - 0.5) * 0.22 + u * 0.14);
    const alpha = smooth(-0.06, 0.24, density) * (1 - smooth(0.82, 1, d)) * smooth(0, 0.2, u) * (0.45 + u * 0.55);
    return [heat, alpha];
  }
  const d = Math.abs(v * 2 - 1), t = frame * 0.17;
  const warp = noise(u * 4 - t * 0.35, v * 3);
  const n = noise(u * 9 + t + (warp - 0.5) * 2.4, v * 4 - t * 0.22);
  const f = fine(u * 23 + t * 1.8, v * 9 + warp * 1.5);
  const end = smooth(0, 0.18, u);
  if (kind === "sand") {
    const birth = start + u * span, phase = birth * 1.7 + frame * 0.06;
    const weave = Math.sin(birth * 0.7 + frame * 0.05) * 0.07;
    const lane = Math.exp(-(((v - 0.5 - weave) / 0.075) ** 2))
      + 0.4 * Math.exp(-(((v - 0.28 + weave) / 0.055) ** 2))
      + 0.3 * Math.exp(-(((v - 0.72 + weave) / 0.06) ** 2));
    const grains = smooth(0.54 - u * 0.16, 0.72 - u * 0.12, fine(phase * 8, v * 29));
    const feather = (1 - smooth(0.55, 1, d)) * smooth(0, 0.4, u) ** 1.2 * (0.08 + 0.92 * u);
    return [0.45 + grains * 0.5, (lane * grains * 0.88 + (1 - d) ** 3 * 0.045) * feather];
  }
  if (kind === "thunder") return [0.35 + n * 0.4, Math.pow(1 - d, 3) * end * (0.12 + f * 0.08)];
  const curl = (n - 0.5) * (0.7 + (1 - u) * 0.5);
  const billow = Math.max(0, 1 - Math.abs(v * 2 - 1 + curl));
  const thread = Math.pow(Math.max(0, Math.sin((v * 4 + warp * 0.65 + u * 0.4) * TAU)), 18);
  const mist = Math.pow(billow, 1.8) * smooth(0.2, 0.8, f) * (kind === "wind" ? 0.6 : 0.22);
  return [0.62 + f * 0.35, (mist + thread * billow * (kind === "wind" ? 0.18 : 0.28)) * end * (0.35 + u * 0.65)];
}

function ribbonMaterial(g, c, sections, strength, clock, frame) {
  const pad = 2, xy = sections.flatMap(q => [q.a, q.b]);
  const x = Math.max(0, Math.floor(Math.min(...xy.map(p => p[0])) - pad)), y = Math.max(0, Math.floor(Math.min(...xy.map(p => p[1])) - pad));
  const w = Math.min(c.w, Math.ceil(Math.max(...xy.map(p => p[0])) + pad)) - x, h = Math.min(c.h, Math.ceil(Math.max(...xy.map(p => p[1])) + pad)) - y;
  if (w <= 0 || h <= 0) return;
  const local = sections.map(q => ({ a: [q.a[0] - x, q.a[1] - y], b: [q.b[0] - x, q.b[1] - y], u: q.u }));
  const preciseKind = ["fireball", "sand"].includes(c.kind), precise = preciseKind ? flameUV(local, w, h) : null;
  const uv = preciseKind ? null : uvMap(local.slice(1).map((q, i) => [local[i], q]), w, h, false);
  const cv = createCanvas(w, h), ctx = cv.getContext("2d"), img = ctx.createImageData(w, h), out = img.data;
  const noise = fbmNoise(c.seed * 13 + 7), fine = fbmNoise(c.seed * 29 + 11);
  for (let k = 0; k < out.length; k += 4) {
    const pixel = k / 4, coverage = preciseKind ? precise.alpha[pixel] : uv[k + 3];
    if (coverage < 8) continue;
    const [heat, alpha] = materialAt(c.kind, preciseKind ? precise.u[pixel] : uv[k] / 255, preciseKind ? precise.v[pixel] : uv[k + 1] / 255, preciseKind ? frame : c.i, noise, fine, clock.oldest, clock.newest - clock.oldest);
    const color = at(c.pal.flame, heat);
    out[k] = color[0]; out[k + 1] = color[1]; out[k + 2] = color[2]; out[k + 3] = Math.round(alpha * strength * coverage);
  }
  ctx.putImageData(img, 0, 0);
  // The flame's saturated folds must survive the glow; the bloom is added by
  // effects.js after the body, wake and particles have been composed.
  g.globalCompositeOperation = "source-over";
  g.drawImage(cv, x, y);
}

const puffs = new Map();
export function puffTexture(seed) {
  const key = Math.abs(seed | 0) % 7;
  if (puffs.has(key)) return puffs.get(key);
  const cv = createCanvas(64, 64), g = cv.getContext("2d"), img = g.createImageData(64, 64), n = fbmNoise(key * 19 + 43);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const px = (x - 31.5) / 30, py = (y - 31.5) / 30, f = n(px * 3, py * 3), fine = n(px * 7 + 7, py * 7);
    const density = 1 - Math.hypot(px, py) + (f - 0.5) * 0.8;
    const i = (y * 64 + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
    img.data[i + 3] = Math.round(smooth(0, 0.5, density) * (0.4 + fine * 0.6) * 255);
  }
  g.putImageData(img, 0, 0); puffs.set(key, cv); return cv;
}

export function drawPuff(g, x, y, r, angle, color, alpha, seed, stretch = 1) {
  const cv = createCanvas(64, 64), ctx = cv.getContext("2d");
  ctx.drawImage(puffTexture(seed), 0, 0); ctx.globalCompositeOperation = "source-in"; ctx.fillStyle = rgba(color, alpha); ctx.fillRect(0, 0, 64, 64);
  g.save(); g.translate(x, y); g.rotate(angle); g.globalCompositeOperation = "source-over"; g.drawImage(cv, -r * stretch, -r, r * 2 * stretch, r * 2); g.restore();
}

// Stable emission times: seeking a frame produces exactly the same wake. Each
// mote leaves the path at birth, then drifts independently instead of riding it.
function shed(g, c, s, state, index, r) {
  if (c.kind === "ice" || c.amount <= 0 || s.trailFrames <= 0 || s.trailWidth <= 0) return;
  const life = Math.min(12, Math.max(4, s.trailFrames)), rate = Math.max(0.25, Math.min(3, c.amount * (c.kind === "sand" ? 2 : 1.5)));
  const postFade = 1 - smooth(0, Math.min(life, s.impactFrames), Math.max(0, state.time - s.chargeFrames - s.travelFrames));
  const oldest = Math.max(s.chargeFrames, state.time - life), newest = Math.min(state.time, s.chargeFrames + s.travelFrames);
  for (let j = Math.ceil(oldest * rate); j <= Math.floor(newest * rate); j++) {
    const P = rng(c.seed * 179 + j * 541 + index * 31), born = j / rate, age = state.time - born, span = life * (0.6 + P() * 0.4);
    if (age < 0 || age >= span) continue;
    const u = pathProgress(s, (born - s.chargeFrames) / s.travelFrames), p = pathAt(s, c.w, c.h, u, index), q = pathAt(s, c.w, c.h, Math.min(1, u + 0.005), index);
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]), side = P() * 2 - 1, f = age / span;
    const vx = -Math.cos(a) * r * 0.06 - Math.sin(a) * side * r * 0.13, vy = -Math.sin(a) * r * 0.06 + Math.cos(a) * side * r * 0.13 - r * 0.035;
    const x = p[0] - Math.sin(a) * side * r * 0.6 + vx * age, y = p[1] + Math.cos(a) * side * r * 0.6 + vy * age;
    if ((c.kind === "fireball" || c.kind === "wind") && j % 3 === 0) {
      const smoke = c.kind === "fireball", color = smoke ? c.pal.smoke : c.pal.rim;
      const angle = P() * TAU + f;
      drawPuff(g, x, y - (smoke ? age * r * 0.04 : 0), r * (0.4 + f * 0.85), angle, color, smooth(0, 0.15, f) * (1 - f) ** 1.5 * (smoke ? 0.28 : 0.2) * postFade, j, 1.3);
    }
    g.globalCompositeOperation = c.pal.dark ? "source-over" : "lighter";
    const alpha = (1 - f) ** 1.6 * (0.3 + P() * 0.6) * postFade, color = at(c.pal.flame, 0.85 - f * 0.4);
    if (c.kind === "fireball" || c.kind === "sand") {
      const size = Math.max(0.5, r * 0.055 * (0.5 + P()));
      streak(g, [x + vx * 1.5, y + vy * 1.5], [x, y], color, color, alpha, size);
    }
  }
}

export function drawRemoteTrail(g, c, s, state, frame, index, r) {
  shed(g, c, s, state, index, r);
  const pts = flightTrail(s, c.w, c.h, frame, index);
  const wrapping = c.kind === "arrow" && state.body;
  if (!wrapping && (pts.length < 2 || s.trailWidth <= 0)) return;
  const strength = 1 - smooth(0, Math.max(1, Math.min(s.trailFrames, s.impactFrames)), Math.max(0, state.time - s.chargeFrames - s.travelFrames));
  let run;
  if (wrapping) {
    const radius = r * (state.launched ? 1 : 0.15 + state.charge * 0.85), R = radius * 2.1;
    const obj = projectile(c.shape, c.spin, c.pal, R, c.core), bounds = projectileBounds(obj);
    bounds[0] += (obj.round ? 0 : obj.L / 2) + R * (c.coreShift || 0);
    run = arrowSections(s.trailWidth > 0 ? pts : [], state.at, state.angle, radius, bounds, s, strength);
  } else {
    run = c.kind === "ice" ? iceTrailSections(pts,r,c.t*TAU+c.seed,c.seed,strength) : ribbonSections(pts,r*s.trailWidth/70,c.kind,strength,r);
  }
  if (run.length < 2) return;
  if (c.kind === "ice") {
    const cv = renderGlow([run], iceTrailStyle(c.pal), c.w, c.h, { seed: c.seed, frame: c.i, alpha: strength, fade: 0.6 });
    if (cv) {
      g.save(); g.beginPath();
      [...run.map(q => q.a), ...run.toReversed().map(q => q.b)].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
      g.closePath(); g.clip();
      g.globalCompositeOperation = "source-over"; g.drawImage(cv, 0, 0); g.restore();
    }
    return;
  }
  if (c.kind === "arrow") {
    const halves = ["a", "b"].map(side => run.map(q => ({ a: q[side], b: [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2], u: q.u })));
    const look = glowStyle(c.pal.preset);
    const style = { ...look, core: 24, haze: 10, glow: 15, strands: Math.min(10, look.strands), flames: Math.min(40, look.flames), flash: 0, impact: 0, dust: 0, embers: 0, snow: 0, shards: 0, leaves: 0, sparkles: 0, splatter: 0 };
    const cv = renderGlow(halves, style, c.w, c.h, { seed: c.seed, frame: c.i, alpha: strength, fade: 0.3, fx: false });
    if (cv) { g.globalCompositeOperation = "source-over"; g.drawImage(cv, 0, 0); }
    return wrapping ? cv : null;
  } else {
    ribbonMaterial(g, c, run, strength, flightTrailWindow(s, frame, index), frame);
    if (c.kind === "thunder") {
      // Reuse attack-trail lightning: whole channels with tapered forks.
      const cv = bolts([run], c.w, c.h, c.pal.core, c.pal.rim, c.seed, Math.floor(c.i / 2), strength, r * 2.6, 0.9);
      if (cv) { g.globalCompositeOperation = "lighter"; g.drawImage(cv, 0, 0); }
    }
  }
}
