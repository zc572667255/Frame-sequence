import { rng, clamp01, smooth } from "../../trails/glow/util.js";
import { TAU, frac, at, comet, field, fieldScale, loopNoise, strand } from "../common.js";

// 燃烧: fire standing on the bottom of the area — tongues bent by a slow
// sway and stretched upwards, fine bright strands running through them and
// trailing off past the edge as wisps, white-hot at the root — and embers
export function burn(g, c) {
  const { w, h, t, pal } = c;
  // laid out so all of it is inside the box: measured, the fire reaches 2.31 ry
  // above its base and 1.22 rx to each side
  const size = c.rx * 2 / w, Hs = h * size;
  const rx = (w * size) / 2.5, ry = Hs / 2.4, cx = c.cx, by = (h + Hs) / 2 - 0.06 * ry;
  const k = 4.5 / Math.max(6, rx);
  // a slow sway (gentle enough never to fold the picture over), the tongues,
  // and long strands that follow them
  const bend = loopNoise(c, 73, k * 0.3, 0.4, 1.5);
  const flow = loopNoise(c, 67, k, 0.42, 4);
  const fine = loopNoise(c, 79, k * 2.2, 0.13, 6);
  const x0 = Math.max(0, Math.floor(cx - rx * 1.5)), x1 = Math.min(w, Math.ceil(cx + rx * 1.5));
  const y0 = Math.max(0, Math.floor(by - ry * 2.3)), y1 = Math.min(h, Math.ceil(by + 1));
  g.globalCompositeOperation = pal.dark ? "source-over" : "lighter";
  field(g, x0, y0, x1, y1, fieldScale(c, rx), (x, y, px) => {
    const hgt = (by - y - 0.5) / (2 * ry);
    if (hgt < -0.02) return false;
    // past the farthest the fire can reach, whatever the noise and the sway
    {
      const um = Math.max(0, Math.abs((x + 0.5 - cx) / rx) - 0.5 * (0.1 + 0.6 * hgt));
      if ((1 - hgt) * 1.05 - Math.pow(um, 1.4) * (0.9 + 1.4 * hgt) + 0.5 * (0.8 + 1.1 * hgt) - 0.18 <= -0.14) return false;
    }
    // the whole fire bends sideways, more the higher up
    const xs = x + (bend(x, y) - 0.5) * rx * (0.1 + 0.6 * hgt);
    const u = (xs + 0.5 - cx) / rx, n = flow(xs, y);
    // narrowing upwards, split into tongues by the noise
    const f = (1 - hgt) * 1.05 - Math.pow(Math.abs(u), 1.4) * (0.9 + 1.4 * hgt) + (n - 0.5) * (0.8 + 1.1 * hgt) - 0.18;
    if (f <= -0.14) return false;
    const s = strand(fine(xs + (n - 0.5) * rx * 0.35, y), 4);
    // the top of the fire thins out before the top of the box
    const top = 1 - smooth(0.95, 1.15, hgt);
    const body = smooth(-0.03, 0.22, f) * smooth(-0.02, 0.05, hgt) * top, wisp = s * smooth(-0.14, 0.02, f) * (1 - body) * (0.4 + hgt) * top;
    const heat = clamp01(f * 0.9 + (1 - hgt) * 0.08 + s * 0.3 * body);
    let col, a;
    if (pal.dark) { const [fc, as] = pal.fire(heat, 0.5 + 0.5 * (1 - hgt)); col = fc; a = (body + wisp) * as; }
    else { col = at(pal.flame, heat); a = body * (0.3 + 0.7 * smooth(0, 0.5, heat)) * (0.75 + 0.25 * s) + wisp * 0.8; }
    if (a <= 0.004) return false;
    px[0] = col[0]; px[1] = col[1]; px[2] = col[2]; px[3] = a;
  });
  // embers: rise, sway, burn out (whole cycles per loop)
  const P = rng(c.seed * 71 + 3);
  g.globalCompositeOperation = "lighter";
  for (let k = 0; k < Math.round(18 * c.amount); k++) {
    const ux = (P() * 2 - 1) * 0.9, ph = P(), sp = 1 + Math.floor(P() * 2), sw = P() * TAU, big = P();
    const p = frac(ph + t * sp), at = (q) => [cx + ux * rx * (1 + 0.4 * q) + Math.sin(sw + q * TAU) * rx * 0.12, by - ry * (0.3 + 2 * q)];
    comet(g, pal, at, p, 0.14, Math.max(0.8, rx * (0.012 + 0.018 * big)) * (c.pixel ? 1.6 : 1), Math.sin(Math.PI * p) * (1 - p * 0.4));
  }
}
