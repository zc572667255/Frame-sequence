import { rng, rgba, clamp01, smooth } from "../../trails/glow/util.js";
import { easeOut, at, streak, comet, volume, drawSoft } from "../common.js";

// 烟尘: puffs rolling out to both sides along the ground, lit from above,
// growing and thinning out, with a few pebbles
export function dust(g, c) {
  const { t, R, cx, pal } = c;
  const gy = c.gy;
  const P = rng(c.seed * 29 + 6);
  const K = Math.round(8 + 8 * c.amount);
  const blobs = [];
  for (let k = 0; k < K; k++) {
    const side = k % 2 ? 1 : -1, reach = 0.2 + 0.75 * P(), s = 0.16 + 0.16 * P(), up = P();
    const e = easeOut(t / (0.55 + 0.4 * P()), 2.2);
    const r = R * s * (0.5 + 1.0 * e);
    blobs.push({ x: cx + side * R * reach * e, y: gy - r * 0.5 - R * 0.35 * up * e * (0.3 + c.squash), r, heat: 0 });
  }
  // light (top) to shadow (bottom) across the palette, soft edges, thinning out
  const cols = pal.cols;
  const v = volume(c, blobs, {
    cell: Math.max(3, R * 0.12), drift: [t * R * 0.15, t * R * 0.25], rough: c.pixel ? 0.6 : 0.5, soft: c.pixel ? 0.55 : 0.75, heat: 0,
    thr: 0.25 + 0.4 * smooth(0.25, 1, t), fade: 0.9 * (1 - 0.8 * smooth(0.4, 1.05, t)),
    color: (_h, light) => at(pal.dust, light),
  });
  g.globalCompositeOperation = "source-over";
  // pebbles kicked out ahead of the cloud (drawn first: the dust rolls over them)
  for (let k = 0; k < Math.round(8 * c.amount); k++) {
    const side = P() < 0.5 ? -1 : 1, sp = 0.6 + 0.5 * P(), lt = clamp01(t / (0.45 + 0.3 * P()));
    if (lt >= 1) continue;
    const at = (q) => [cx + side * R * 1.05 * sp * q, gy - R * 0.45 * sp * Math.sin(Math.PI * q) * (0.4 + c.squash)];
    const [x, y] = at(lt), sz = Math.max(1, Math.round(R * 0.035));
    // a faint dusty streak behind each pebble's arc, then the pebble
    if (!c.pixel) comet(g, { rim: cols[1], core: cols[cols.length - 1] }, at, lt, 0.18, sz * 0.8, 0.45 * (1 - lt));
    g.fillStyle = rgba(cols[1], 1 - lt * 0.4);
    g.fillRect(Math.round(x), Math.round(y), sz, sz);
  }
  if (v.body) drawSoft(g, c, v.body);
}
