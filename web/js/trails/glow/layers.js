// Layers drawn into the trail itself (its body, edge and surface) and the
// passes that cut it up: flow, flames, lightning, crystals, wind, caustics,
// rocks, tail tint, tearing and erosion.
import { createCanvas } from "../../core/util.js";
import { crystal, rockShape } from "./shapes.js";
import { clamp01, colorAcross, fbmNoise, lerp, noiseGrid, onRun, rgba, rng, smooth, worley } from "./util.js";

// What moves with time and has to close a loop (loop: frames per cycle, 0 =
// none): a noise value worked out at frame f and one whole cycle back, cross-
// faded by how far into the cycle f is and rescaled so it stays as contrasty
// mid-cycle (vfx/common.js loopNoise) — the last frame leads back into the first.
// p, keep: loopMix(f, loop); at(f) gives the value at frame f.
const loopMix = (f, loop) => { const p = loop ? (((f % loop) + loop) % loop) / loop : 0; return [p, 1 / Math.hypot(1 - p, p)]; };
const looped = (at, f, loop, p, keep) => (loop ? clamp01(0.5 + ((at(f) - 0.5) * (1 - p) + (at(f - loop) - 0.5) * p) * keep) : at(f));

export function erode(og, w, h, ox, oy, seed, amount, life, maxW, UV) {
  const t = amount * (0.08 + 0.92 * (1 - clamp01(life)));       // a little always, more while dissolving
  if (t <= 0.02) return;
  // the mask is worked out at half size and laid over with destination-in
  const k = 2, mw = Math.ceil(w / k), mh = Math.ceil(h / k);
  const noise = noiseGrid(seed, mw, mh, ox / k, oy / k, Math.max(2, maxW / 4 / k));
  const img = new ImageData(mw, mh), d = img.data;
  const lo = t - 0.12, span = 0.24;
  // with the uv map, how far a pixel is from the leading edge counts too: the
  // grip side wears away first and the bright edge is the last to go. Pixels off
  // the ribbon (haze, bloom) count as middling.
  const uv = UV && UV.mw === mw && UV.mh === mh ? UV.d : null;
  for (let p = 0, i = 3; p < mw * mh; p++, i += 4) {
    const n = uv ? noise[p] * 0.6 + (uv[i] > 8 ? uv[i - 2] / 255 : 0.5) * 0.4 : noise[p];
    let m = (n - lo) / span;
    m = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
    d[i] = Math.round(m * 255);
  }
  const M = createCanvas(mw, mh);
  M.getContext("2d").putImageData(img, 0, 0);
  og.save();
  og.globalCompositeOperation = "destination-in";
  og.drawImage(M, 0, 0, mw * k, mh * k);
  og.restore();
}

// The flowing body (流体): noise warped by noise, stretched along the swing and
// moving a little every frame — licks of fire, rushing water, swirling energy.
// It hugs the leading edge; toward the grip side it breaks into tongues. Hot
// colours (and the core colour) near the edge, the darker ones inward. loop:
// frames per cycle, for a body that flows on round a loop without a jump.
export function flowLayer(UV, cols, coreC, seed, frame, alpha, tail, amount, loop = 0) {
  const { mw, mh, d } = UV;
  const img = new ImageData(mw, mh), o = img.data;
  const fbm = fbmNoise(seed * 13 + 7), [p, keep] = loopMix(frame, loop);
  let u = 0, v = 0;
  const at = (f) => {
    const t = f * 0.35, wx = fbm(u * 4 - t * 0.4, v * 3), wy = fbm(u * 4 + 9.1, v * 3 + 4.7 - t * 0.3);
    return fbm(u * 13 + (wx - 0.5) * 3 - t, v * 5 + (wy - 0.5) * 2.4);
  };
  for (let i = 0; i < mw * mh * 4; i += 4) {
    const cov = d[i + 3];
    if (cov < 8) continue;
    u = d[i] / 255; v = d[i + 1] / 255;
    const n = looped(at, frame, loop, p, keep);
    const body = v * 1.25 + (n - 0.5) * 1.8 * amount;
    const m = smooth(0.42, 0.58, body) * smooth(0, tail, u);
    if (m <= 0.01) continue;
    const lum = smooth(0.25, 0.75, n);                     // dark folds between the licks
    const heat = clamp01(v * 0.7 + (lum - 0.5) * 0.8 + 0.15);
    let c = colorAcross(cols, heat);
    if (heat > 0.85) { const k = (heat - 0.85) / 0.15; c = [0, 1, 2].map((j) => Math.round(c[j] + (coreC[j] - c[j]) * k)); }
    o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
    o[i + 3] = Math.round(255 * m * (0.3 + 0.7 * lum) * alpha * (0.5 + 0.5 * amount) * (cov / 255));
  }
  const F = createCanvas(mw, mh);
  F.getContext("2d").putImageData(img, 0, 0);
  return F;
}

// Crystal (结晶): the front of the trail built from packed ice crystals along
// the leading edge, all lying along the swing — the faceted, jagged crescent of
// an ice slash. Fixed to the trail, so they ride with it.
export function crystals(runs, w, h, cols, coreC, seed, alpha, tail, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 46);
  const S = rng(seed * 113 + 9);
  const C = createCanvas(w, h), g = C.getContext("2d");
  const light = colorAcross(cols, 0.9), dark = colorAcross(cols, 0.45);
  for (let k = 0; k < N; k++) {
    const u = 0.35 + 0.65 * Math.pow(S(), 0.6);
    const v = 0.5 + 0.5 * Math.pow(S(), 0.7);
    const { pt, across } = onRun(r, u, v);
    const behind = onRun(r, Math.max(0, u - 0.03), v).pt;
    let tx = pt[0] - behind[0], ty = pt[1] - behind[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const tilt = (S() - 0.5) * 0.5, ct = Math.cos(tilt), st = Math.sin(tilt);
    const along = [tx * ct - ty * st, tx * st + ty * ct], out = [across[0], across[1]];
    const L = maxW * (0.5 + 0.5 * u);
    const len = L * (0.18 + 0.3 * S()), wid = len * (0.25 + 0.2 * S());
    const a = alpha * smooth(0, tail, u) * (0.5 + 0.5 * u);
    if (a <= 0.03) continue;
    crystal(g, pt, along, out, len, wid, light, dark, coreC, a);
  }
  return C;
}

// Speed lines (速度线): long straight streaks left behind the head, running back
// along the swing — straight, not following the curve, as if the air was cut.
// Their length flickers frame to frame.
export function speedLines(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 22);
  const S = rng(seed * 131 + 3), P = rng(seed * 131 + frame * 557 + 1);
  const C = createCanvas(w, h), g = C.getContext("2d");
  g.lineCap = "round";
  for (let k = 0; k < N; k++) {
    const u = 0.55 + 0.45 * Math.pow(S(), 0.5), v = 0.15 + 0.9 * S();
    const { pt } = onRun(r, u, v);
    const behind = onRun(r, Math.max(0, u - 0.04), v).pt;
    let bx = behind[0] - pt[0], by = behind[1] - pt[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;
    const len = maxW * (0.8 + 2.2 * Math.pow(S(), 1.5)) * (0.6 + 0.6 * P());
    const end = [pt[0] + bx * len, pt[1] + by * len];
    const a = alpha * (0.35 + 0.5 * P()) * u;
    const gr = g.createLinearGradient(pt[0], pt[1], end[0], end[1]);
    gr.addColorStop(0, rgba(coreC, 0.85 * a));
    gr.addColorStop(0.3, rgba(rimC, 0.5 * a));
    gr.addColorStop(1, rgba(rimC, 0));
    g.strokeStyle = gr;
    g.lineWidth = Math.max(0.6, maxW / (30 + 50 * S()));
    g.beginPath(); g.moveTo(pt[0], pt[1]); g.lineTo(end[0], end[1]); g.stroke();
  }
  return C;
}

// Lightning (闪电): a few jagged bolts running along the blade, each made by
// midpoint displacement (every segment split and its middle knocked sideways,
// less at each level), with forks breaking off it, mostly outward past the
// edge. A fresh set every frame, so it flickers. Each bolt is a band whose width
// changes along it — thick near its root, thinning to a point, swelling and
// pinching on the way — and a fork starts as thick as the bolt where it splits
// off and tapers from there. Drawn as a wide glow in the rim colour under a
// white-hot core of the same shape.
export function bolts(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  if (amount <= 0 || alpha <= 0.01) return null;
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const P = rng(seed * 61 + frame * 1297 + 5);
  // a point at (u, v) on the ribbon, interpolated between sections
  const sample = (u, v) => {
    let i = 1;
    while (i < r.length - 1 && r[i].u < u) i++;
    const p = r[i - 1], q = r[i], t = clamp01((u - p.u) / ((q.u - p.u) || 1));
    const a = lerp(p.a, p.b, v), b = lerp(q.a, q.b, v);
    return { pt: lerp(a, b, t), out: [q.b[0] - q.a[0], q.b[1] - q.a[1]] };
  };
  const jag = (pts, rough, depth) => {
    let cur = pts;
    for (let d = 0; d < depth; d++, rough *= 0.55) {
      const next = [cur[0]];
      for (let i = 1; i < cur.length; i++) {
        const a = cur[i - 1], b = cur[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
        const off = (P() - 0.5) * len * rough;
        next.push([(a[0] + b[0]) / 2 - dy / len * off, (a[1] + b[1]) / 2 + dx / len * off], b);
      }
      cur = next;
    }
    return cur;
  };
  // relative widths along a path: from w0 to w1, with a smoothed random swell
  // and pinch; a bolt (not a fork) also narrows into its very first stretch
  const widths = (n, w0, w1, root) => {
    const out = [];
    let r = 1;
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      r = 0.6 * r + 0.4 * (0.5 + P());
      const start = root ? 0.35 + 0.65 * smooth(0, 0.1, t) : 1;
      out.push(Math.max(0.04, (w0 + (w1 - w0) * t) * r * start));
    }
    return out;
  };
  const paths = [];
  const count = 1 + Math.round(amount * 3);
  for (let k = 0; k < count; k++) {
    const u0 = 0.12 + 0.45 * P(), v0 = 0.45 + 0.5 * P();
    const pts = [];
    for (let s = 0; s <= 6; s++) pts.push(sample(u0 + (1 - u0) * s / 6, Math.max(0.1, Math.min(1.05, v0 + (P() - 0.5) * 0.4))).pt);
    const main = jag(pts, 0.5, 4);
    const mw = widths(main.length, 1, 0.25, true);
    paths.push([main, mw]);
    const forks = 1 + Math.floor(P() * 3 * amount + 0.5);
    for (let f = 0; f < forks; f++) {
      const at = Math.floor(main.length * (0.2 + 0.7 * P()));
      const start = main[Math.min(main.length - 1, at)];
      const { out } = sample(u0 + (1 - u0) * at / main.length, 1);
      const ol = Math.hypot(out[0], out[1]) || 1, side = P() < 0.75 ? 1 : -1, turn = (P() - 0.5) * 1.4;
      let dx = out[0] / ol * side, dy = out[1] / ol * side;
      [dx, dy] = [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
      const len = maxW * (0.25 + 0.55 * P());
      const fork = jag([start, [start[0] + dx * len, start[1] + dy * len]], 0.6, 3);
      paths.push([fork, widths(fork.length, mw[Math.min(mw.length - 1, at)] * 0.7, 0.06, false)]);
    }
  }
  const B = createCanvas(w, h), g = B.getContext("2d");
  const flick = alpha * (0.75 + 0.25 * P());
  // a path as a filled band, ws[i] × scale wide at point i
  const band = (pts, ws, scale) => {
    const L = [], Rt = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const half = (ws[i] * scale) / 2;
      L.push([p[0] - dy * half, p[1] + dx * half]);
      Rt.push([p[0] + dy * half, p[1] - dx * half]);
    }
    g.beginPath();
    L.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
    for (let i = Rt.length - 1; i >= 0; i--) g.lineTo(Rt[i][0], Rt[i][1]);
    g.closePath();
    g.fill();
  };
  const glowW = Math.max(3, maxW / 6), coreW = Math.max(1.4, maxW / 22);
  g.fillStyle = rgba(rimC, 0.4 * flick);
  for (const [pts, ws] of paths) band(pts, ws, glowW);
  g.fillStyle = rgba(coreC, 0.95 * flick);
  for (const [pts, ws] of paths) band(pts, ws, coreW);
  return B;
}

// Flames (火舌): soft tongues of fire growing out of the body and streaming
// back along the trail, the way flames trail behind something moving fast.
// They root inside the ribbon (mostly its inner half; bright fire also licks a
// little over the leading edge) and lean only slightly away from the blade.
// Where they sit is fixed per trail; their length, lean and sway change every
// frame, so they flicker. Bright fire is added as light and softened a touch.
// Black fire is painted dark, over a blurred halo of the rim colour, so it
// glows at its edges instead of being outlined.
export function flames(runs, w, h, cols, coreC, rimC, seed, frame, alpha, tail, maxW, amount, dark) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 26);
  const S = rng(seed * 71 + 1), P = rng(seed * 71 + frame * 733 + 2);
  const T = createCanvas(w, h), g = T.getContext("2d");
  const G = dark ? createCanvas(w, h) : null, gg = G && G.getContext("2d");
  for (let k = 0; k < N; k++) {
    const u = 0.15 + 0.85 * Math.pow(S(), 0.7);
    const outer = !dark && S() < 0.2;
    const vb = outer ? 0.9 + 0.06 * S() : 0.3 + 0.4 * S();
    const { pt: B, across } = onRun(r, u, vb);
    const back0 = onRun(r, Math.max(0, u - 0.04), vb).pt;
    let bx = back0[0] - B[0], by = back0[1] - B[1];
    const bl = Math.hypot(bx, by) || 1; bx /= bl; by /= bl;          // toward the tail
    const nx = outer ? across[0] : -across[0], ny = outer ? across[1] : -across[1];   // away from the blade
    const len = maxW * (0.2 + 0.4 * S()) * (0.75 + 0.45 * P()) * (0.5 + 0.5 * u);
    const wid = len * (0.3 + 0.2 * S());
    const lean = 0.15 + 0.2 * P();
    const tip = [B[0] + bx * len + nx * len * lean, B[1] + by * len + ny * len * lean];
    // the root lies along the trail, a little ahead of B; the sides bow out
    // and the tip whips to one side (an S-ish lick)
    const b1 = [B[0] - bx * wid * 0.6 + nx * wid * 0.3, B[1] - by * wid * 0.6 + ny * wid * 0.3];
    const b2 = [B[0] - bx * wid * 0.2 - nx * wid * 0.5, B[1] - by * wid * 0.2 - ny * wid * 0.5];
    const px = -(tip[1] - B[1]), py = tip[0] - B[0], pl = Math.hypot(px, py) || 1;
    const whip = (P() - 0.5) * wid * 1.4;
    const c1 = [(b1[0] + tip[0]) / 2 + px / pl * (wid * 0.5 + whip), (b1[1] + tip[1]) / 2 + py / pl * (wid * 0.5 + whip)];
    const c2 = [(b2[0] + tip[0]) / 2 - px / pl * (wid * 0.35 - whip), (b2[1] + tip[1]) / 2 - py / pl * (wid * 0.35 - whip)];
    const a = alpha * smooth(0, tail, u) * (0.55 + 0.45 * u);
    if (a <= 0.02) continue;
    const shape = (c) => { c.beginPath(); c.moveTo(b1[0], b1[1]); c.quadraticCurveTo(c1[0], c1[1], tip[0], tip[1]); c.quadraticCurveTo(c2[0], c2[1], b2[0], b2[1]); c.closePath(); };
    const gr = g.createLinearGradient(B[0], B[1], tip[0], tip[1]);
    gr.addColorStop(0, rgba(cols[dark ? 1 : 3], 0.85 * a));
    gr.addColorStop(0.55, rgba(cols[dark ? 0 : 2], 0.5 * a));
    gr.addColorStop(1, rgba(cols[dark ? 0 : 1], 0));
    g.fillStyle = gr;
    shape(g); g.fill();
    if (dark) {
      // its glow: the same lick in the rim colour, blurred under it later
      const eg = gg.createLinearGradient(B[0], B[1], tip[0], tip[1]);
      eg.addColorStop(0, rgba(rimC, 0.7 * a));
      eg.addColorStop(1, rgba(rimC, 0));
      gg.fillStyle = eg;
      shape(gg); gg.fill();
    } else if (S() < 0.5) {
      // a hot inner lick
      const m = (p, t) => lerp(B, p, t);
      g.fillStyle = rgba(coreC, 0.45 * a);
      g.beginPath(); g.moveTo(...m(b1, 0.5)); g.quadraticCurveTo(...m(c1, 0.5), ...m(tip, 0.55)); g.quadraticCurveTo(...m(c2, 0.5), ...m(b2, 0.5)); g.closePath(); g.fill();
    }
  }
  const out = createCanvas(w, h), og = out.getContext("2d");
  if (dark) {
    og.filter = `blur(${Math.max(1.5, maxW / 30)}px)`;
    og.drawImage(G, 0, 0);
    og.filter = `blur(${Math.max(0.5, maxW / 160)}px)`;
    og.drawImage(T, 0, 0);
  } else {
    og.filter = `blur(${Math.max(0.5, maxW / 90)}px)`;
    og.drawImage(T, 0, 0);
  }
  og.filter = "none";
  return out;
}

// Rays (光芒): thin beams of light shining out of the leading edge, longer
// toward the head, fanning a little and flickering frame to frame
export function rays(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 40);
  const S = rng(seed * 97 + 4), P = rng(seed * 97 + frame * 571 + 6);
  const Rc = createCanvas(w, h), g = Rc.getContext("2d");
  g.lineCap = "round";
  for (let k = 0; k < N; k++) {
    const u = 0.25 + 0.75 * Math.pow(S(), 0.6);
    const { pt: B, across } = onRun(r, u, 0.95);
    const spread = (S() - 0.5) * 0.6;
    const dx = across[0] * Math.cos(spread) - across[1] * Math.sin(spread), dy = across[0] * Math.sin(spread) + across[1] * Math.cos(spread);
    const len = maxW * (0.4 + 1.4 * Math.pow(S(), 2)) * (0.7 + 0.5 * P()) * (0.4 + 0.6 * u);
    const a = alpha * (0.35 + 0.65 * P());
    const end = [B[0] + dx * len, B[1] + dy * len];
    const gr = g.createLinearGradient(B[0], B[1], end[0], end[1]);
    gr.addColorStop(0, rgba(coreC, 0.75 * a));
    gr.addColorStop(0.35, rgba(rimC, 0.35 * a));
    gr.addColorStop(1, rgba(rimC, 0));
    g.strokeStyle = gr;
    g.lineWidth = Math.max(0.8, maxW / (35 + 60 * S()));
    g.beginPath(); g.moveTo(B[0], B[1]); g.lineTo(end[0], end[1]); g.stroke();
  }
  return Rc;
}

// Wind blades (风刃): soft bands of wind wound round the blade, like brush
// strokes. Each winds along the trail like a rope round a stick, swinging out
// past both edges and back, smooth and tapered at both ends. Where it passes
// behind the blade it is drawn into `back`, which goes under everything (and so
// disappears behind the blade); where it comes round the front it goes into
// `front`, over the blade but see-through, wider and with a thin bright core.
// The winding turns on every frame. Returns { back, front } canvases.
export function curls(runs, w, h, coreC, rimC, seed, frame, alpha, maxW, amount, loop = 0) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = 2 + Math.round(amount * 2);
  const S = rng(seed * 191 + 3);
  const back = createCanvas(w, h), front = createCanvas(w, h);
  const gb = back.getContext("2d"), gf = front.getContext("2d");
  const ext = (u, v) => { const i = onRun(r, u, 0).pt, o = onRun(r, u, 1).pt; return [i[0] + (o[0] - i[0]) * v, i[1] + (o[1] - i[1]) * v]; };
  const bandW = Math.max(3, maxW / 6), coreW = Math.max(0.8, maxW / 45);
  for (let k = 0; k < N; k++) {
    const u0 = 0.02 + 0.3 * S(), u1 = Math.min(1, u0 + 0.6 + 0.4 * S());
    const turns = 0.6 + 0.4 * S(), amp = 0.75 + 0.2 * S();
    // round a loop: whole turns per cycle, near the speed it would have
    const ph0 = S() * 6.28, rate = 0.45 + 0.25 * S(), phase = ph0 + frame * (loop ? Math.max(1, Math.round(rate * loop / 6.28)) * 6.28 / loop : rate);
    const fat = 0.7 + 0.5 * S();
    const n = 48;
    const pts = [], ws = [], fr = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = u0 + (u1 - u0) * t, ang = phase + t * turns * Math.PI * 2;
      pts.push(ext(u, 0.5 + amp * Math.sin(ang)));
      const z = Math.cos(ang);
      fr.push(z >= 0);
      ws.push(fat * Math.pow(Math.sin(Math.PI * t), 0.8) * (0.55 + 0.45 * Math.max(0, z)));
    }
    const a = alpha * (0.55 + 0.45 * u1);
    const band = (g, i0, i1, scale) => {
      const lo = [], hi = [];
      for (let i = i0; i <= i1; i++) {
        const p = pts[i], q = pts[Math.min(n, i + 1)], o = pts[Math.max(0, i - 1)];
        let dx = q[0] - o[0], dy = q[1] - o[1];
        const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
        const hw = (ws[i] * scale) / 2;
        lo.push([p[0] - dy * hw, p[1] + dx * hw]); hi.push([p[0] + dy * hw, p[1] - dx * hw]);
      }
      g.beginPath();
      lo.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      for (let i = hi.length - 1; i >= 0; i--) g.lineTo(hi[i][0], hi[i][1]);
      g.closePath();
      g.fill();
    };
    let i0 = 0;
    for (let i = 1; i <= n; i++) {
      if (i < n && fr[i] === fr[i0]) continue;
      if (fr[i0]) {
        gf.fillStyle = rgba(rimC, 0.32 * a); band(gf, i0, i, bandW);
        gf.fillStyle = rgba(coreC, 0.6 * a); band(gf, i0, i, coreW);
      } else {
        gb.fillStyle = rgba(rimC, 0.28 * a); band(gb, i0, i, bandW * 0.8);
      }
      i0 = i;
    }
  }
  // soften both into brushy wind
  const soft = (c) => { const o = createCanvas(w, h), g = o.getContext("2d"); g.filter = `blur(${Math.max(0.6, maxW / 90)}px)`; g.drawImage(c, 0, 0); return o; };
  return { back: soft(back), front: soft(front) };
}

// Serrated edge (锯齿): sharp teeth along the inner side of the blade, pointing
// back toward the tail and in toward the grip — the feathered, saw-toothed
// edge of a wind blade. Fixed to the trail.
export function serrate(runs, w, h, cols, coreC, seed, alpha, tail, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.max(1, Math.round(amount * 11));
  const S = rng(seed * 229 + 7);
  const C = createCanvas(w, h), g = C.getContext("2d");
  for (let k = 0; k < N; k++) {
    // spread over the middle and back of the blade, none at the head
    const u = 0.3 + 0.55 * (k + 0.2 + S() * 0.6) / N, du = 0.045 + 0.04 * S();
    const b1 = onRun(r, Math.min(1, u + du * 0.4), 0.62).pt, b2 = onRun(r, Math.max(0, u - du * 0.6), 0.52).pt;
    const tip = onRun(r, Math.max(0, u - du * (3 + 1.5 * S())), 0.04 + 0.14 * S()).pt;
    const a = alpha * smooth(0, tail, u) * (0.65 + 0.35 * u);
    if (a <= 0.03) continue;
    const gr = g.createLinearGradient(b1[0], b1[1], tip[0], tip[1]);
    gr.addColorStop(0, rgba(cols[2], 0.95 * a));
    gr.addColorStop(0.7, rgba(cols[1], 0.75 * a));
    gr.addColorStop(1, rgba(cols[1], 0.2 * a));
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(b1[0], b1[1]); g.quadraticCurveTo((b1[0] + tip[0]) / 2, (b1[1] + tip[1]) / 2, tip[0], tip[1]); g.lineTo(b2[0], b2[1]); g.closePath(); g.fill();
    // the cutting edge: a bright line down the outer side of the tooth
    const eg = g.createLinearGradient(b1[0], b1[1], tip[0], tip[1]);
    eg.addColorStop(0, rgba(coreC, 0.85 * a));
    eg.addColorStop(1, rgba(coreC, 0));
    g.strokeStyle = eg;
    g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(b1[0], b1[1]); g.lineTo(tip[0], tip[1]); g.stroke();
  }
  return C;
}

// Caustics (水纹): the rippling net of light inside water — bright lines along
// the borders of a cellular pattern (where the nearest two points are about as
// far), stretched along the flow and drifting with it, brightest toward the
// leading edge. Added as light over the body, on the uv map.
export function caustics(UV, lightC, seed, frame, alpha, amount, loop = 0) {
  const { mw, mh, d } = UV;
  const img = new ImageData(mw, mh), o = img.data;
  const [p] = loopMix(frame, loop);
  let u = 0, v = 0;
  const at = (f) => { const c = worley(u * 9 - f * 0.18, v * 3.2 + Math.sin(u * 23 + f * 0.4) * 0.12, seed * 5 + 3); return 1 - smooth(0.02, 0.13, c.f2 - c.f1); };
  for (let i = 0; i < mw * mh * 4; i += 4) {
    if (d[i + 3] < 8) continue;
    u = d[i] / 255; v = d[i + 1] / 255;
    const line = loop ? at(frame) * (1 - p) + at(frame - loop) * p : at(frame);
    const a = 0.7 * line * amount * alpha * (0.35 + 0.65 * v) * (d[i + 3] / 255);
    if (a <= 0.02) continue;
    o[i] = lightC[0]; o[i + 1] = lightC[1]; o[i + 2] = lightC[2]; o[i + 3] = Math.round(255 * Math.min(1, a));
  }
  const C = createCanvas(mw, mh);
  C.getContext("2d").putImageData(img, 0, 0);
  return C;
}

// Rocks set into the blade (岩石): the trail itself made of stones, tail to near
// the head and across its width, riding with it — a few big, many small (sizes
// fall off steeply), smaller and fainter toward the tail, with a scatter of
// grit. The head itself, where the stick is, stays clear.
export function rockBody(runs, w, h, cols, seed, alpha, tail, amount) {
  const r = runs[runs.length - 1];
  if (r.length < 2) return null;
  const N = Math.round(amount * 36);
  const S = rng(seed * 223 + 1);
  const C = createCanvas(w, h), g = C.getContext("2d");
  const width = (u) => { const a = onRun(r, u, 0).pt, b = onRun(r, u, 1).pt; return Math.hypot(b[0] - a[0], b[1] - a[1]); };
  for (let k = 0; k < N; k++) {
    // all along the trail inside the blade, but none at the head, on the stick
    const u = 0.05 + 0.83 * Math.pow(S(), 0.8), v = 0.05 + 0.92 * S();
    const c = onRun(r, u, v).pt;
    const size = width(u) * (0.05 + 0.2 * Math.pow(S(), 3)) * (0.5 + 0.5 * u);
    const a = alpha * smooth(0, tail, u);
    if (a <= 0.03 || size < 0.8) { S(); S(); continue; }
    rockShape(g, c, size, S() * 6.28, S, cols, a);
  }
  // grit: tiny stones in and just around the blade, also clear of the stick
  const G = Math.round(amount * 90);
  for (let k = 0; k < G; k++) {
    const u = 0.08 + 0.82 * Math.pow(S(), 0.7), v = -0.25 + 1.4 * S();
    const { pt: c } = onRun(r, u, Math.max(0, Math.min(1, v)));
    const ac = onRun(r, u, 1).pt, ai = onRun(r, u, 0).pt, off = v < 0 ? v : v > 1 ? v - 1 : 0;
    const p = [c[0] + (ac[0] - ai[0]) * off, c[1] + (ac[1] - ai[1]) * off];
    const size = Math.max(0.6, width(u) * (0.01 + 0.02 * S()));
    const a = alpha * smooth(0, tail, u) * (0.5 + 0.5 * S());
    g.fillStyle = rgba(S() < 0.5 ? cols[1] : cols[2], a);
    g.beginPath(); g.arc(p[0], p[1], size, 0, Math.PI * 2); g.fill();
  }
  return C;
}

// Tail tint (尾部变色): the trail shifts toward a second colour as it goes back
// from the head — a blue tail behind a red head. A wash of that colour, strongest
// at the tail and spread over the glow around it, is laid on with the "color"
// blend: hue and saturation change, brightness doesn't, so the white-hot core
// stays white. Kept to where something was already drawn.
export function tintTail(og, w, h, runs, tint, amount, maxW) {
  const M = createCanvas(w, h), mg = M.getContext("2d");
  const at = (q, v) => lerp(q.a, q.b, v);
  for (const r of runs) for (let i = 1; i < r.length; i++) {
    const p = r[i - 1], q = r[i];
    // the front quarter keeps its own colours; from there back it turns
    const back = clamp01((0.75 - (p.u + q.u) / 2) / 0.75);
    mg.fillStyle = rgba(tint, Math.min(1, amount * 1.15 * Math.pow(back, 0.8)));
    mg.beginPath();
    for (const [x, y] of [at(p, -0.6), at(p, 1.6), at(q, 1.6), at(q, -0.6)]) mg.lineTo(x, y);
    mg.fill();
  }
  const S = createCanvas(w, h), sg = S.getContext("2d");
  sg.filter = `blur(${Math.max(2, maxW / 5)}px)`;
  sg.drawImage(M, 0, 0);
  const C2 = createCanvas(w, h), cg = C2.getContext("2d");
  cg.drawImage(og.canvas, 0, 0);
  cg.globalCompositeOperation = "color";
  cg.drawImage(S, 0, 0);
  cg.globalCompositeOperation = "destination-in";
  cg.drawImage(og.canvas, 0, 0);
  og.save();
  og.globalCompositeOperation = "copy";
  og.drawImage(C2, 0, 0);
  og.restore();
}

// Tearing (撕裂): the body pulled apart into streaming strands and gaps, like
// falling water — noise stretched along the flow, moving along it every frame,
// tearing most at the tail and on the grip side so the leading edge holds.
// Works on the uv map; pixels off the ribbon (the glow around) are kept.
export function tear(og, UV, seed, frame, amount, loop = 0) {
  const { k, mw, mh, d } = UV;
  const fbm = fbmNoise(seed * 211 + 5);
  const img = new ImageData(mw, mh), o = img.data;
  const [p, keep] = loopMix(frame, loop);
  let u = 0, v = 0;
  const at = (f) => fbm(u * 2.6 - f * 0.15, v * 34);
  const holes = (f) => { const c = worley(u * 7 - f * 0.1, v * 2.6, seed * 7 + 1); return c.h < 0.35 * amount ? smooth(0.14, 0.24, c.f1) : 1; };
  for (let i = 0; i < mw * mh * 4; i += 4) {
    if (d[i + 3] < 8) { o[i + 3] = 255; continue; }
    u = d[i] / 255; v = d[i + 1] / 255;
    const n = looped(at, frame, loop, p, keep);
    const t = amount * (0.25 + 0.5 * (1 - u) + 0.4 * (1 - v));
    let m = (n - t + 0.06) / 0.12;
    m = m <= 0 ? 0 : m >= 1 ? 1 : m * m * (3 - 2 * m);
    // round holes punched through the body, in some of the cells of a cellular
    // noise, drifting with the flow; none on the leading edge
    if (v < 0.85) m *= loop ? holes(frame) * (1 - p) + holes(frame - loop) * p : holes(frame);
    o[i + 3] = Math.round(m * 255);
  }
  const M = createCanvas(mw, mh);
  M.getContext("2d").putImageData(img, 0, 0);
  og.save();
  og.globalCompositeOperation = "destination-in";
  og.drawImage(M, 0, 0, mw * k, mh * k);
  og.restore();
}
