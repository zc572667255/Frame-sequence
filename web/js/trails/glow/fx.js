// The accents around a glow trail: stars, dust, snow, bubbles, shards,
// splatter, embers, rocks, leaves, drops, and the flash and impact bursts.
import { createCanvas } from "../../core/util.js";
import { crystal, rockShape, star, teardrop } from "./shapes.js";
import { clamp01, colorAcross, lerp, onRun, rgba, rng, smooth, widthOf } from "./util.js";

// four-point stars around the front half of the trail, a new set every frame
export function sparkles(og, runs, st, cols, seed, frame, alpha, maxW, at) {
  const K = Math.max(0, Math.min(80, st.sparkles | 0));
  if (!K) return;
  const r = runs[runs.length - 1];
  og.globalCompositeOperation = "lighter";
  const P = rng(seed * 7 + frame * 131);
  const size = Math.max(1, +st.sparkleSize || 6) * Math.max(0.6, maxW / 40);
  for (let k = 0; k < K; k++) {
    const u = 0.35 + 0.65 * Math.pow(P(), 0.7);
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const v = -0.3 + 1.6 * P();
    const p = at(r[i], v);
    const tw = Math.pow(P(), 1.4) * alpha;
    const s = size * (0.4 + 0.9 * P()) * (0.6 + 0.6 * tw);
    if (tw < 0.08) continue;
    star(og, p, s, colorAcross(cols, clamp01(v)), tw, P() * 0.4);
  }
  og.globalCompositeOperation = "source-over";
}

// a starburst where the swing starts: rays, a bright dot and an expanding ring,
// strongest on the first frame and gone after a few
export function flash(og, run, st, coreC, rimC, seed, frame, age, alpha, amount) {
  const f = amount * clamp01(1 - age / 4) * alpha;
  if (f <= 0.01) return;
  const s0 = run[0], L = Math.max(4, widthOf(s0));
  const c = lerp(s0.a, s0.b, 0.8);
  const R = L * (0.7 + 0.15 * age);
  const P = rng(seed * 13 + 5), F = rng(seed * 17 + frame * 59);
  og.globalCompositeOperation = "lighter";
  const gl = og.createRadialGradient(c[0], c[1], 0, c[0], c[1], R * 0.9);
  gl.addColorStop(0, rgba(coreC, 0.9 * f));
  gl.addColorStop(0.15, rgba(rimC, 0.45 * f));
  gl.addColorStop(1, rgba(rimC, 0));
  og.fillStyle = gl;
  og.beginPath(); og.arc(c[0], c[1], R * 0.9, 0, Math.PI * 2); og.fill();
  // rays: a few long bright ones on a diagonal, many short soft ones around
  og.lineCap = "round";
  const main = P() * Math.PI;
  const rays = [];
  for (let k = 0; k < 2; k++) rays.push([main + k * Math.PI + (P() - 0.5) * 0.15, R * (1.0 + 0.4 * P()), 1]);
  for (let k = 0; k < 12; k++) rays.push([P() * Math.PI * 2, R * (0.35 + 0.6 * P()), 0.35 + 0.3 * F()]);
  for (const [th, len, b] of rays) {
    const x1 = c[0] + Math.cos(th) * len, y1 = c[1] + Math.sin(th) * len;
    const g = og.createLinearGradient(c[0], c[1], x1, y1);
    g.addColorStop(0, rgba(coreC, f * b));
    g.addColorStop(0.35, rgba(rimC, 0.7 * f * b));
    g.addColorStop(1, rgba(rimC, 0));
    og.strokeStyle = g;
    og.lineWidth = Math.max(0.8, L / (b === 1 ? 22 : 40));
    og.beginPath(); og.moveTo(c[0], c[1]); og.lineTo(x1, y1); og.stroke();
  }
  // the ring grows as it fades
  og.globalCompositeOperation = "source-over";
  og.strokeStyle = rgba(rimC, 0.7 * f);
  og.lineWidth = Math.max(0.8, L / 50);
  og.beginPath(); og.arc(c[0], c[1], R * (0.25 + 0.12 * age), 0, Math.PI * 2); og.stroke();
  og.fillStyle = `rgba(255,255,255,${f.toFixed(3)})`;
  og.beginPath(); og.arc(c[0], c[1], Math.max(1, L * 0.05), 0, Math.PI * 2); og.fill();
}

// ink-like splatter thrown off the blade: each splat is born on one stick of the
// swing, flies a little way outward and stays there until the trail dissolves
export function splatter(og, run, w, h, st, col, seed, age, alpha, amount) {
  const K = Math.round(amount * 14);
  if (!K || alpha <= 0.01) return;
  const S = createCanvas(w, h), sg = S.getContext("2d");
  const first = age - (run.length - 1);                 // frame (relative to the swing) of run[0]
  let any = false, size = 1;
  for (const s of run) size = Math.max(size, widthOf(s));
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 101 + k * 7919);
    const bi = 1 + Math.floor(R() * Math.max(1, Math.min(run.length, 8) - 1) * 1.6);
    const since = age - (first + bi);
    if (since < 0 || bi >= run.length) continue;
    const s = run[bi];
    const base = lerp(s.a, s.b, 0.6 + 0.6 * R());
    let dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const turn = (R() - 0.5) * 2.2;
    const ux = dx * Math.cos(turn) - dy * Math.sin(turn), uy = dx * Math.sin(turn) + dy * Math.cos(turn);
    const travel = size * (0.05 + 0.3 * R()) * (1 - Math.exp(-(since + 1) / 1.6));
    const p = [base[0] + ux * travel, base[1] + uy * travel];
    const grow = Math.min(1, (since + 1) / 2);
    const r = size * (0.03 + 0.05 * R()) * grow;
    const a = alpha * 0.9;
    sg.fillStyle = rgba(col, a);
    // the blob: a few overlapping circles
    const n = 3 + Math.floor(R() * 4);
    for (let i = 0; i < n; i++) {
      const o = r * 0.7 * R(), th = R() * Math.PI * 2;
      sg.beginPath(); sg.arc(p[0] + Math.cos(th) * o, p[1] + Math.sin(th) * o, r * (0.4 + 0.5 * R()), 0, Math.PI * 2); sg.fill();
    }
    // droplets flung further along its direction, getting smaller
    const m = 2 + Math.floor(R() * 5);
    for (let i = 0; i < m; i++) {
      const sp = (R() - 0.5) * 1.2, d = r * (1.4 + 2.6 * R()) * (0.6 + 0.4 * grow);
      const ex = ux * Math.cos(sp) - uy * Math.sin(sp), ey = ux * Math.sin(sp) + uy * Math.cos(sp);
      sg.beginPath(); sg.arc(p[0] + ex * d, p[1] + ey * d, Math.max(0.5, r * (0.1 + 0.25 * R())), 0, Math.PI * 2); sg.fill();
    }
    any = true;
  }
  if (!any) return;
  og.globalAlpha = 0.55;
  og.filter = `blur(${Math.max(1, size / 30)}px)`;
  og.drawImage(S, 0, 0);
  og.filter = "none";
  og.globalAlpha = 1;
  og.drawImage(S, 0, 0);
}

// fine dust (粒子): lots of tiny specks over the trail and just inside it, fixed
// to the trail so they ride with it, twinkling frame to frame
export function dust(og, runs, cols, seed, frame, alpha, maxW, at, amount) {
  const N = Math.round(amount * 140);
  if (!N) return;
  const r = runs[runs.length - 1];
  const R = rng(seed * 91 + 3), T = rng(seed * 17 + frame * 389);
  const unit = Math.max(0.6, maxW / 90);
  og.globalCompositeOperation = "lighter";
  for (let k = 0; k < N; k++) {
    const u = Math.pow(R(), 0.6), v = 1.05 - Math.pow(R(), 0.8) * 1.35;
    const size = unit * (0.5 + 1.6 * Math.pow(R(), 3));
    const tw = (0.3 + 0.7 * T()) * alpha;
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p = at(r[i], v);
    const c = colorAcross(cols, clamp01(v + 0.3));
    og.fillStyle = rgba([0, 1, 2].map((j) => Math.round(c[j] + (255 - c[j]) * 0.5)), tw * (0.4 + 0.6 * u));
    og.beginPath(); og.arc(p[0], p[1], size, 0, Math.PI * 2); og.fill();
  }
  og.globalCompositeOperation = "source-over";
}

// Shards (碎片): ice crystals breaking off the blade's edge. Each is born on one
// stick of the swing, near its outer half, lying along the swing; it drifts a
// little back and out and fades over several frames.
export function shards(og, run, cols, coreC, seed, age, alpha, amount) {
  const K = Math.round(amount * 14);
  if (!K || alpha <= 0.01 || run.length < 2) return;
  const first = age - (run.length - 1);
  const light = colorAcross(cols, 0.85), dark = colorAcross(cols, 0.4);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 53 + k * 7907);
    const bi = 1 + Math.floor(R() * Math.max(1, Math.min(run.length, 8) - 1) * 1.5);
    const since = age - (first + bi);
    if (since < 0 || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1], L = widthOf(s);
    const life = alpha * clamp01(1 - since / 8);
    if (life <= 0.02) continue;
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];                 // out of the blade
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];                 // the way the blade moves
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const c0 = lerp(s.a, s.b, 0.55 + 0.5 * R());
    const drift = L * (0.04 + 0.2 * R()) * (1 - Math.exp(-(since + 1) / 2));
    const c = [c0[0] - tx * drift * 1.5 + ox * drift * (R() - 0.3), c0[1] - ty * drift * 1.5 + oy * drift * (R() - 0.3)];
    const tilt = (R() - 0.5) * 0.7, ct = Math.cos(tilt), st = Math.sin(tilt);
    const along = [tx * ct - ty * st, tx * st + ty * ct], out = [-along[1], along[0]];
    const len = L * (0.16 + 0.24 * R()), wid = len * (0.22 + 0.16 * R());
    crystal(og, c, along, out, len, wid, light, dark, coreC, life);
  }
}

// Snow (雪花): six-armed snowflakes with side branches around the trail, turning
// slowly and twinkling, fixed to the trail
export function snow(og, runs, coreC, rimC, seed, frame, alpha, maxW, at, amount) {
  const N = Math.round(amount * 26);
  if (!N) return;
  const r = runs[runs.length - 1];
  const R = rng(seed * 149 + 5), T = rng(seed * 151 + frame * 263);
  og.globalCompositeOperation = "lighter";
  og.lineCap = "round";
  for (let k = 0; k < N; k++) {
    const u = 0.15 + 0.85 * Math.pow(R(), 0.7), v = -0.35 + 1.6 * R();
    const size = maxW * (0.05 + 0.08 * Math.pow(R(), 2));
    const spin = R() * Math.PI + frame * (R() - 0.5) * 0.3;
    const tw = (0.35 + 0.65 * T()) * alpha * (0.4 + 0.6 * u);
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p = at(r[i], v);
    if (tw < 0.06) continue;
    // a soft glow behind it
    const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], size * 1.2);
    halo.addColorStop(0, rgba(rimC, 0.35 * tw));
    halo.addColorStop(1, rgba(rimC, 0));
    og.fillStyle = halo;
    og.beginPath(); og.arc(p[0], p[1], size * 1.2, 0, Math.PI * 2); og.fill();
    og.strokeStyle = rgba(coreC, 0.9 * tw);
    og.lineWidth = Math.max(0.5, size / 9);
    og.beginPath();
    for (let arm = 0; arm < 6; arm++) {
      const th = spin + (arm * Math.PI) / 3, dx = Math.cos(th), dy = Math.sin(th);
      og.moveTo(p[0], p[1]); og.lineTo(p[0] + dx * size, p[1] + dy * size);
      // two pairs of side branches, swept toward the tip
      for (const [at0, bl] of [[0.45, 0.32], [0.7, 0.22]]) {
        const bx = p[0] + dx * size * at0, by = p[1] + dy * size * at0;
        for (const sgn of [1, -1]) {
          const bt = th + sgn * Math.PI / 3;
          og.moveTo(bx, by); og.lineTo(bx + Math.cos(bt) * size * bl, by + Math.sin(bt) * size * bl);
        }
      }
    }
    og.stroke();
  }
  og.globalCompositeOperation = "source-over";
}

// the impact burst (命中爆点) where the swing ends: a hot flash, rays and debris
// flung out, growing and fading over the frames after the last stick
export function impact(og, run, coreC, rimC, splatC, seed, frame, after, opacity, amount) {
  const f = amount * opacity * clamp01(1 - after / 4);
  if (f <= 0.01) return;
  const last = run[run.length - 1], prev = run[run.length - 2];
  const L = Math.max(4, widthOf(last));
  let c = lerp(last.a, last.b, 0.85);
  if (prev) {
    const dx = last.b[0] - prev.b[0], dy = last.b[1] - prev.b[1], dl = Math.hypot(dx, dy);
    if (dl > 1e-3) c = [c[0] + dx / dl * L * 0.18, c[1] + dy / dl * L * 0.18];
  }
  const R0 = L * (0.55 + 0.3 * after);
  const P = rng(seed * 29 + 11), F = rng(seed * 37 + frame * 71);
  og.globalCompositeOperation = "lighter";
  const gl = og.createRadialGradient(c[0], c[1], 0, c[0], c[1], R0);
  gl.addColorStop(0, rgba(coreC, 0.95 * f));
  gl.addColorStop(0.25, rgba(rimC, 0.6 * f));
  gl.addColorStop(1, rgba(rimC, 0));
  og.fillStyle = gl;
  og.beginPath(); og.arc(c[0], c[1], R0, 0, Math.PI * 2); og.fill();
  // sharp spikes flung out: the pointed burst of 2D impact effects
  for (let k = 0; k < 10; k++) {
    const th = P() * Math.PI * 2, len = R0 * (0.8 + 1.0 * P()) * (0.8 + 0.4 * F()), wid = R0 * (0.06 + 0.1 * P());
    const ex = c[0] + Math.cos(th) * len, ey = c[1] + Math.sin(th) * len, nx = -Math.sin(th) * wid, ny = Math.cos(th) * wid;
    const sg = og.createLinearGradient(c[0], c[1], ex, ey);
    sg.addColorStop(0, rgba(coreC, 0.85 * f));
    sg.addColorStop(0.45, rgba(rimC, 0.5 * f));
    sg.addColorStop(1, rgba(rimC, 0));
    og.fillStyle = sg;
    og.beginPath(); og.moveTo(c[0] + nx, c[1] + ny); og.lineTo(ex, ey); og.lineTo(c[0] - nx, c[1] - ny); og.closePath(); og.fill();
  }
  og.lineCap = "round";
  for (let k = 0; k < 18; k++) {
    const th = P() * Math.PI * 2, len = R0 * (0.6 + 1.1 * P()) * (0.8 + 0.4 * F());
    const x1 = c[0] + Math.cos(th) * len, y1 = c[1] + Math.sin(th) * len;
    const g = og.createLinearGradient(c[0], c[1], x1, y1);
    g.addColorStop(0, rgba(coreC, 0.9 * f));
    g.addColorStop(0.4, rgba(rimC, 0.5 * f));
    g.addColorStop(1, rgba(rimC, 0));
    og.strokeStyle = g;
    og.lineWidth = Math.max(0.7, L / (k < 4 ? 30 : 60));
    og.beginPath(); og.moveTo(c[0], c[1]); og.lineTo(x1, y1); og.stroke();
  }
  // debris: solid bits flying out
  og.globalCompositeOperation = "source-over";
  for (let k = 0; k < 26; k++) {
    const th = P() * Math.PI * 2, dist = R0 * (0.3 + 1.0 * P()) * (0.6 + 0.4 * after);
    const r = L * (0.008 + 0.025 * Math.pow(P(), 2));
    og.fillStyle = rgba(splatC, 0.9 * f);
    og.beginPath(); og.arc(c[0] + Math.cos(th) * dist, c[1] + Math.sin(th) * dist, Math.max(0.6, r), 0, Math.PI * 2); og.fill();
  }
}

// Embers (余烬): glowing sparks thrown off the swing that rise, sway and burn
// out over several frames — they outlive the trail itself a little
export function embers(og, run, coreC, rimC, seed, frame, age, opacity, maxW, amount, dark) {
  const K = Math.round(amount * 34);
  if (!K || run.length < 1) return;
  const first = age - (run.length - 1);
  const hot = dark ? [0, 1, 2].map((j) => Math.round(rimC[j] + (255 - rimC[j]) * 0.45)) : coreC;
  const F = rng(seed * 89 + frame * 313);
  og.globalCompositeOperation = "lighter";
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 83 + k * 6151);
    const bi = Math.floor(R() * run.length);
    const since = age - (first + bi + Math.floor(R() * 2));
    const life = 5 + R() * 7;
    if (since < 0 || since > life) continue;
    const s = run[bi];
    const p0 = lerp(s.a, s.b, 0.3 + 0.7 * R());
    const rise = maxW * (0.05 + 0.08 * R()) * since;
    const sway = Math.sin(since * 0.9 + R() * 6.28) * maxW * 0.05 + (R() - 0.5) * maxW * 0.08 * since;
    const p = [p0[0] + sway, p0[1] - rise];
    const fade = 1 - since / life;
    const size = Math.max(0.6, maxW * (0.01 + 0.018 * R()) * (0.5 + 0.5 * fade));
    const a = opacity * fade * (0.6 + 0.4 * F());
    const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], size * 3.5);
    halo.addColorStop(0, rgba(hot, 0.9 * a));
    halo.addColorStop(0.35, rgba(rimC, 0.45 * a));
    halo.addColorStop(1, rgba(rimC, 0));
    og.fillStyle = halo;
    og.beginPath(); og.arc(p[0], p[1], size * 3.5, 0, Math.PI * 2); og.fill();
  }
  og.globalCompositeOperation = "source-over";
}

// Bubbles (气泡): hollow bubbles around the trail with a glint, rising slowly
// frame by frame and wobbling, fixed to the trail like the dust
export function bubbles(og, runs, coreC, rimC, seed, frame, alpha, maxW, at, amount) {
  const N = Math.round(amount * 30);
  if (!N) return;
  const r = runs[runs.length - 1];
  const R = rng(seed * 167 + 7);
  og.globalCompositeOperation = "lighter";
  for (let k = 0; k < N; k++) {
    const u = 0.2 + 0.8 * Math.pow(R(), 0.7), v = -0.3 + 1.5 * R();
    const size = maxW * (0.02 + 0.045 * Math.pow(R(), 1.5));
    const speed = maxW * (0.03 + 0.05 * R()), phase = R() * 6.28;
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p0 = at(r[i], v);
    const p = [p0[0] + Math.sin(frame * 0.8 + phase) * size * 0.6, p0[1] - speed * (frame % 12) * 0.3];
    const a = alpha * (0.4 + 0.6 * u);
    og.strokeStyle = rgba(rimC, 0.75 * a);
    og.lineWidth = Math.max(0.6, size / 5);
    og.beginPath(); og.arc(p[0], p[1], size, 0, Math.PI * 2); og.stroke();
    og.fillStyle = rgba(rimC, 0.12 * a);
    og.fill();
    og.fillStyle = rgba(coreC, 0.9 * a);
    og.beginPath(); og.arc(p[0] - size * 0.35, p[1] - size * 0.35, Math.max(0.5, size * 0.22), 0, Math.PI * 2); og.fill();
  }
  og.globalCompositeOperation = "source-over";
}

// Flying rocks: a few chunks thrown off anywhere along the blade, flying out
// and on with the swing and dropping under gravity, tumbling
export function rocks(og, run, cols, seed, age, opacity, maxW, amount) {
  const K = Math.round(amount * 20);
  if (!K || run.length < 2) return;
  const first = age - (run.length - 1);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 179 + k * 4391);
    const bi = 1 + Math.floor(R() * (run.length - 1));
    const since = age - (first + bi);
    const life = 6 + R() * 5;
    if (since < 0 || since > life || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1];
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const base = lerp(s.a, s.b, 0.15 + 0.9 * R());
    const sp = maxW * (0.06 + 0.1 * R()), fw = maxW * 0.06 * R(), g = maxW * 0.025;
    if (since < 1) continue;                                      // not on the stick it comes off
    const t = since + 1.6;                                        // already clear of the blade when first seen
    const c = [base[0] + ox * sp * t + tx * fw * t, base[1] + oy * sp * t + ty * fw * t + g * t * t];
    const size = maxW * (0.035 + 0.07 * Math.pow(R(), 1.5));
    const a = opacity * clamp01(1 - (since - life * 0.6) / (life * 0.4));
    rockShape(og, c, size, R() * 6.28 + since * (R() - 0.5) * 0.8, R, cols, a);
  }
}

// Leaves (叶片): small leaves caught up by the swing — each born on one stick,
// thrown out and back, fluttering side to side and turning over as it goes
export function leaves(og, run, cols, seed, age, opacity, maxW, amount) {
  const K = Math.round(amount * 16);
  if (!K || run.length < 2) return;
  const first = age - (run.length - 1);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 197 + k * 5279);
    const bi = 1 + Math.floor(R() * (run.length - 1));
    const since = age - (first + bi);
    const life = 7 + R() * 6;
    if (since < 0 || since > life || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1];
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const base = lerp(s.a, s.b, 0.5 + 0.6 * R());
    const t = since + 0.5, sp = maxW * (0.06 + 0.08 * R());
    const flutter = Math.sin(t * 1.7 + R() * 6) * maxW * 0.08;
    const c = [base[0] + ox * sp * t - tx * sp * 0.6 * t + -oy * flutter, base[1] + oy * sp * t - ty * sp * 0.6 * t + ox * flutter];
    const size = maxW * (0.04 + 0.04 * R());
    const turn = R() * 6.28 + t * (R() - 0.5) * 1.6, flip = Math.abs(Math.cos(t * 1.3 + R() * 6));   // turning over
    const ax = Math.cos(turn), ay = Math.sin(turn), nx = -ay * flip, ny = ax * flip;
    const a = opacity * clamp01(1 - (since - life * 0.6) / (life * 0.4));
    const tip = [c[0] + ax * size, c[1] + ay * size], tail = [c[0] - ax * size, c[1] - ay * size];
    og.beginPath();
    og.moveTo(tail[0], tail[1]);
    og.quadraticCurveTo(c[0] + nx * size * 0.9, c[1] + ny * size * 0.9, tip[0], tip[1]);
    og.quadraticCurveTo(c[0] - nx * size * 0.9, c[1] - ny * size * 0.9, tail[0], tail[1]);
    og.closePath();
    og.fillStyle = rgba(cols[1], 0.9 * a); og.fill();
    og.strokeStyle = rgba(cols[2], 0.9 * a); og.lineWidth = Math.max(0.5, size / 8);
    og.beginPath(); og.moveTo(tail[0], tail[1]); og.lineTo(tip[0], tip[1]); og.stroke();
  }
}

// Drops along the blade (水滴): water shed all along the trail, tail to head —
// mostly just past the leading edge, some past the grip side or over the body —
// riding with it, lying along the swing, smaller and fainter toward the tail,
// and drifting out a little each frame
export function dropsBody(og, runs, cols, coreC, seed, frame, alpha, tail, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return;
  const N = Math.round(amount * 30);
  const S = rng(seed * 239 + 5);
  const ext = (u, v) => { const i = onRun(r, u, 0).pt, o = onRun(r, u, 1).pt; return { p: [i[0] + (o[0] - i[0]) * v, i[1] + (o[1] - i[1]) * v], wd: Math.hypot(o[0] - i[0], o[1] - i[1]) }; };
  for (let k = 0; k < N; k++) {
    const u = 0.08 + 0.92 * Math.pow(S(), 0.85);
    const pick = S(), drift = ((frame * 0.03 + S()) % 1) * 0.25;
    const v = pick < 0.55 ? 1.03 + 0.35 * S() + drift : pick < 0.8 ? -0.03 - 0.35 * S() - drift : 0.15 + 0.7 * S();
    const { p, wd } = ext(u, v);
    const ahead = ext(Math.min(1, u + 0.03), v).p;
    let dx = ahead[0] - p[0], dy = ahead[1] - p[1];
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const r0 = wd * (0.035 + 0.06 * Math.pow(S(), 1.5)) * (0.45 + 0.55 * u);
    const a = alpha * smooth(0, tail, u) * (0.55 + 0.45 * u);
    if (a <= 0.03 || r0 < 0.6) { S(); continue; }
    teardrop(og, p, dx, dy, r0, r0 * (2.2 + 2 * S()), cols, coreC, a);
  }
}

// Flung drops: a few thrown clear of the blade from anywhere along it, flying
// out and on and dropping a little
export function drops(og, run, cols, coreC, seed, age, opacity, maxW, amount) {
  const K = Math.round(amount * 9);
  if (!K || run.length < 2) return;
  const first = age - (run.length - 1);
  for (let k = 0; k < K; k++) {
    const R = rng(seed * 233 + k * 3779);
    const bi = 1 + Math.floor(R() * (run.length - 1));
    const since = age - (first + bi);
    const life = 4 + R() * 5;
    if (since < 0 || since > life || bi >= run.length) continue;
    const s = run[bi], p = run[bi - 1];
    let ox = s.b[0] - s.a[0], oy = s.b[1] - s.a[1];
    const ol = Math.hypot(ox, oy) || 1; ox /= ol; oy /= ol;
    let tx = s.b[0] - p.b[0], ty = s.b[1] - p.b[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const base = lerp(s.a, s.b, 0.2 + 0.9 * R());
    const t = since + 0.6, so = maxW * (0.05 + 0.1 * R()), sf = maxW * (0.03 + 0.08 * R()), g = maxW * 0.012;
    const vx = ox * so + tx * sf, vy = oy * so + ty * sf + g * t * 2;
    const c = [base[0] + (ox * so + tx * sf) * t, base[1] + (oy * so + ty * sf) * t + g * t * t];
    const vl = Math.hypot(vx, vy) || 1;
    const r = maxW * (0.012 + 0.03 * Math.pow(R(), 1.5));
    const a = opacity * clamp01(1 - (since - life * 0.6) / (life * 0.4));
    teardrop(og, c, vx / vl, vy / vl, r, r * (2.5 + 2 * R()), cols, coreC, a);
  }
}
