import { rng, smooth } from "../../trails/glow/util.js";
import { TAU, frac, at, sparks, beam, jag, bolt, comet, field, fieldScale, loopNoise, strand } from "../common.js";

// Where the aura sits in a w×h box at size (0..1): its flame tips, the shafts
// and the sparks reach 1.77 ry above the centre and its bottom 1.22 ry below,
// its sides 1.15 rx out — measured — so with these all of it is inside the box
// (the size's share of it, centred).
export function auraLayout(w, h, size) {
  const Hs = h * size, ry = Hs / 3, rx = (w * size) / 2.3;
  return { rx, ry, cx: w / 2, cy: (h - Hs) / 2 + 1.77 * ry };
}

// the figure an aura surrounds, as fractions of its box: the middle (y) and
// size (w, h) of its shell — what a layer it follows is fitted to
export function auraBody(size) {
  const L = auraLayout(1, 1, size);
  return { y: L.cy - 0.085 * L.ry, h: 2 * L.ry, w: 2 * L.rx };
}

// 环绕光 (斗气): flame tongues licking up round the area's ellipse, pointed
// on top, hollow inside so what stands in it shows through; streaks of light
// rising through it, sparks, and lightning if asked for
export function aura(g, c) {
  const { w, h, t, pal } = c;
  const { rx, ry, cx, cy } = auraLayout(w, h, c.rx * 2 / w);
  const k = 4.5 / Math.max(6, rx);
  const bend = loopNoise(c, 57, k * 0.3, 0.4, 1.5);
  const flow = loopNoise(c, 53, k, 0.3, 3);
  const fine = loopNoise(c, 83, k * 2.2, 0.13, 5);
  const x0 = Math.max(0, Math.floor(cx - rx * 1.4)), x1 = Math.min(w, Math.ceil(cx + rx * 1.4));
  const y0 = Math.max(0, Math.floor(cy - ry * 1.75)), y1 = Math.min(h, Math.ceil(cy + ry * 1.2));
  g.globalCompositeOperation = "lighter";
  field(g, x0, y0, x1, y1, fieldScale(c, rx), (x, y, px) => {
    const v = (y + 0.5 - cy) / ry, top = Math.max(0, -v);
    // past the farthest the tongues can reach, whatever the noise (it stays in
    // 0..1) and however far the sway goes: nothing to work out here
    {
      const du = 0.5 * (0.05 + 0.4 * top), um = Math.max(0, Math.abs((x + 0.5 - cx) / rx) - du);
      if (1 - Math.sqrt(um * um * (1 + top * 1.3) + v * v * (v > 0 ? 1.2 : 0.85)) + 0.5 * (0.3 + 1.4 * top) <= -0.16) return false;
    }
    // swaying, more so higher up
    const xs = x + (bend(x, y) - 0.5) * rx * (0.05 + 0.4 * top);
    const u = (xs + 0.5 - cx) / rx;
    const dd = Math.sqrt(u * u * (1 + top * 1.3) + v * v * (v > 0 ? 1.2 : 0.85));
    const n = flow(xs, y);
    // the tongues: the edge pushed out and in by the noise, more so on top
    const e = 1 - dd + (n - 0.5) * (0.3 + 1.4 * top);
    if (e <= -0.16) return false;
    const s = strand(fine(xs + (n - 0.5) * rx * 0.3, y), 4);
    const shell = smooth(-0.02, 0.13, e), hollow = smooth(0.08, 0.4, e);
    // strands carry on past the edge as wisps, mostly off the top
    const wisp = s * smooth(-0.16, 0.02, e) * (1 - shell) * (0.25 + top);
    // the tips thin out before the top of the box rather than being cut there
    const a = (shell * (1 - 0.96 * hollow) * (0.85 + 0.35 * s) + wisp) * (1 - smooth(1.4, 1.75, top));
    if (a <= 0.004) return false;
    const col = at(pal.aura, 0.2 + 0.8 * (1 - hollow) * (0.45 + 0.35 * n + 0.35 * s));
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
  });
  // shafts of light shooting up through it (whole cycles per loop)
  const P = rng(c.seed * 59 + 2), S = Math.round(10 * c.amount);
  for (let k = 0; k < S; k++) {
    const ux = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2), len = ry * (0.3 + 0.4 * P());
    const p = c.loop ? frac(ph + t * sp) : frac(ph + t * sp * 1.5);
    const x = cx + ux * rx * 0.8 * Math.sqrt(1 - p * 0.5), yb = cy + ry * (0.9 - 2.3 * p);
    beam(g, pal, x, yb + len, yb, Math.max(0.8, rx * 0.018), Math.sin(Math.PI * p) * 0.9);
  }
  // sparks shooting up off the top, flaring outward, with trails
  for (let k = 0; k < Math.round(10 * c.amount); k++) {
    const ux = P() * 2 - 1, ph = P(), sp = 1 + Math.floor(P() * 2), big = P();
    const p = frac(ph + t * sp), at = (q) => [cx + ux * rx * (0.9 + 0.35 * q * q), cy - ry * (0.3 + 1.2 * q)];
    comet(g, pal, at, p, 0.2, Math.max(0.7, rx * (0.012 + 0.016 * big)) * (c.pixel ? 1.6 : 1), Math.sin(Math.PI * p));
  }
  // lightning crawling over it, new every frame (超级赛亚人 2)
  if (c.bolts) {
    const B = rng(c.seed * 61 + c.i * 7919);
    for (let k = 0; k < 2; k++) {
      if (B() < 0.25) continue;
      let th = B() * TAU, r = 0.75 + 0.2 * B();
      const pts = [];
      for (let j = 0; j < 7; j++) { pts.push([cx + Math.cos(th) * rx * r, cy + Math.sin(th) * ry * r]); th += 0.18 + 0.12 * B(); r = Math.max(0.5, Math.min(1.05, r + (B() - 0.5) * 0.35)); }
      const main = jag(pts, B, rx * 0.05);
      bolt(g, pal, main, Math.max(0.8, rx * 0.018), 1);
      // a fork or two splitting off
      for (let f = 0; f < 2; f++) {
        if (B() < 0.4) continue;
        const at0 = main[Math.floor(B() * (main.length - 2))], ang = B() * TAU, len = rx * (0.15 + 0.2 * B());
        bolt(g, pal, jag([at0, [at0[0] + Math.cos(ang) * len, at0[1] + Math.sin(ang) * len]], B, rx * 0.04), Math.max(0.6, rx * 0.01), 0.7);
      }
    }
  }
}
