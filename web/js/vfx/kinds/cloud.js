import { rng, smooth } from "../../trails/glow/util.js";
import { TAU, frac, mixRgb, field, fieldScale, loopNoise } from "../common.js";

// 云朵: cumulus as in a photo — heaps of lobes with billows on billows (two
// layers of a noise folded into round heaps, lit like bumps), lit by how much
// cloud lies between a point and the sun (upper left): white on the side
// facing it, a soft grey-blue on the far side, inside and under the base;
// each lobe lit on its own upper left too (the heaps show, one on another);
// edges frayed by noise. Every cloud is
// made up from the seed: a tall tower, a long low bank or a small puff, its
// own outline (a few humps of different height), size and density (thin ones
// let the sky through). As many as the 粒子 and the width ask for — a wide box
// is a whole skyline. Loops close: the lobes swell and settle in whole cycles,
// the edges boil (noise crossfaded round the loop); 横向飘动 sends each cloud
// across the box once a loop, coming in on one side as it leaves the other.
// Painted, not glowing: no bloom (vfx/effects.js). Drawn per pixel (field),
// the same in godot/code.js.

// the cloud's own colours (also what 像素 snaps to): light, body, shade, deep
export function cloudColors(pal) {
  // a real cloud's shadows are a soft grey with the sky in them, not a strong blue
  return {
    light: mixRgb([255, 255, 255], pal.core, 0.05),
    body: mixRgb([241, 244, 249], pal.rim, 0.08),
    shade: mixRgb([203, 212, 226], pal.rim, 0.14),
    deep: mixRgb([150, 164, 188], pal.cols[0] || pal.rim, 0.14),
  };
}

// the clouds, from the seed: at most 10, at most 240 lobes in all
export const CLOUD_MAX_PUFFS = 240;
export function cloudLayout(c) {
  const { w, h } = c, P = rng(c.seed * 97 + 5);
  const size = Math.max(0.2, c.rx * 2 / w);
  const n = Math.max(1, Math.min(10, Math.round(c.amount * (0.7 + 0.85 * w / h))));
  const Hmax = h * 0.8 * size;
  const clouds = [];
  for (let i = 0; i < n; i++) {
    // how big, how wide, how dense
    const big = n === 1 ? 1 : P();
    const H = Math.max(6, Hmax * (0.3 + 0.7 * Math.pow(big, 1.5)));
    const W = Math.min(w * (n === 1 ? 0.95 : 0.75), H * (1.8 + 2.4 * P()));
    // mostly solid; now and then a small thin one the sky shows through (the
    // big ones and one alone: solid — a big thin sheet over others looks like film)
    // (one draw, as ever: the shapes that follow keep their random numbers)
    const roll = P(), dn = n > 1 && big < 0.55 && roll < 0.3 ? 0.3 + roll : 0.85 + 0.15 * roll;
    // where: spread across the width, the base anywhere it fits
    const x0 = n === 1 ? 0.5 : (i + 0.15 + 0.7 * P()) / n;
    const by = n === 1 ? (h + H) / 2 : H + 2 + (h - 4 - H) * P();
    // the outline: humps of all widths and heights, the tallest reaching H —
    // lopsided, ragged — tapering to the sides
    const m = 4 + Math.floor(P() * 4), humps = [];
    for (let j = 0; j < m; j++) humps.push([(P() - 0.5) * 0.85, 0.08 + 0.16 * P(), j === 0 ? 1 : 0.3 + 0.6 * P()]);
    const top = (u) => {
      let v = 0;
      for (const [hu, hw, hh] of humps) v = Math.max(v, hh * Math.exp(-((u - hu) / hw) * ((u - hu) / hw)));
      return H * Math.max(0.22, v) * Math.sqrt(Math.max(0, 1 - Math.pow(2 * u, 4)));
    };
    // lobes, in strips across (overlapping, so no beads), all sizes: one heaped
    // up to the outline, one or two small ones bubbling on its top when it is
    // big enough (the cauliflower), one inside, one filling under it to the base
    const K = Math.max(3, Math.min(Math.round(3 + 4 * W / H), Math.floor((CLOUD_MAX_PUFFS / n - 6) / 5)));
    const gap = W / K, puffs = [];
    for (let k = 0; k < K; k++) {
      const u = ((k + 0.5) / K - 0.5) * 0.9 + (P() - 0.5) * 0.8 / K, tp = Math.max(H * 0.2, top(u));
      const r = Math.max(gap * 0.55, tp * (0.18 + 0.32 * P())), y = Math.min(-r * 0.5, -tp + r);
      puffs.push([u * W, y, r, P(), 1 + Math.floor(P() * 2)]);
      const nb = r > H * 0.15 ? 1 + Math.floor(P() * 2) : 0;
      for (let j = 0; j < nb; j++) {
        const a = -Math.PI / 2 + (P() - 0.5) * 2.2, r2 = r * (0.38 + 0.2 * P());
        puffs.push([u * W + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78, r2, P(), 1 + Math.floor(P() * 2)]);
      }
      const rm = tp * (0.2 + 0.12 * P());
      puffs.push([u * W + (P() - 0.5) * gap * 0.8, Math.min(-rm * 0.6, -tp * (0.35 + 0.35 * P())), rm, P(), 1 + Math.floor(P() * 2)]);
      const rb = Math.max(gap * 0.75, tp * (0.3 + 0.15 * P()));
      const yb = Math.min(-rb * 0.45, -rb * 0.7 - Math.max(0, tp - 2 * rb) * 0.5 * P());
      puffs.push([u * W, yb, rb, P(), 1 + Math.floor(P() * 2)]);
    }
    // now and then a scrap or two torn off beside it: a few small lobes
    const scraps = P() < 0.6 ? 1 + Math.floor(P() * 2) : 0;
    for (let j = 0; j < scraps; j++) {
      const su = (P() < 0.5 ? -1 : 1) * (0.5 + 0.1 * P()), sr = H * (0.1 + 0.1 * P()), sy = -H * (0.15 + 0.35 * P());
      for (let q = 0; q < 3; q++) puffs.push([su * W + (P() - 0.5) * sr * 2.5, sy + (P() - 0.5) * sr * 0.8, sr * (0.6 + 0.5 * P()), P(), 1 + Math.floor(P() * 2)]);
    }
    // how far it reaches either side of its centre
    clouds.push({ i, H, W, E: W * 0.62 + H * 0.5, dn, x0, by, ph: P(), puffs });
  }
  return clouds;
}

// where each cloud is drawn at t: [centre x, base y] (twice when it wraps)
export function cloudPlaces(c, cl) {
  const { w, t } = c;
  let x;
  if (c.drift && c.loop) x = frac(cl.x0 + t) * (w + 2 * cl.E) - cl.E;
  else if (c.drift) x = cl.x0 * w + w * 0.12 * t;
  else x = Math.max(Math.min(cl.W / 2, w / 2), Math.min(Math.max(w - cl.W / 2, w / 2), cl.x0 * w));
  const y = cl.by + Math.sin(TAU * (t + cl.ph)) * cl.H * 0.025;
  return c.drift && c.loop ? [[x, y], [x - (w + 2 * cl.E), y]] : [[x, y]];
}

// a noise sampled every step over a w × h area from (x0, y0), read back
// bilinearly in between — only where keep(x, y) says it will be read (0.5
// elsewhere: the empty sky round a cloud costs nothing)
function noiseGrid(fn, x0, y0, w, h, step, keep) {
  const nx = Math.ceil(w / step) + 2, ny = Math.ceil(h / step) + 2, v = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, y = y0 + j * step;
    v[j * nx + i] = !keep || keep(x, y) ? fn(x, y) : 0.5;
  }
  return (x, y) => {
    const fx = Math.max(0, (x - x0) / step), fy = Math.max(0, (y - y0) / step);
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), tx = Math.min(1, fx - i), ty = Math.min(1, fy - j), k = j * nx + i;
    return (v[k] * (1 - tx) + v[k + 1] * tx) * (1 - ty) + (v[k + nx] * (1 - tx) + v[k + nx + 1] * tx) * ty;
  };
}

export function cloud(g, c) {
  const { w, h, t, pal } = c;
  const col = cloudColors(pal), ramp = [col.deep, col.shade, col.body, col.light];
  const env = c.loop ? 1 : smooth(0, 0.15, t) * (1 - smooth(0.75, 1, t));
  if (env <= 0.01) return;
  g.globalCompositeOperation = "source-over";
  for (const cl of cloudLayout(c)) {
    // the lobes rolling and swelling (whole cycles per loop), the edges boiling
    // and, finer, the wisps fraying off them
    const lobes = cl.puffs.map(([dx, dy, r, ph, sp]) => {
      const a = TAU * (t * sp + ph);
      return [dx + Math.cos(a) * r * 0.06, dy + Math.sin(a) * r * 0.04, r * (1 + 0.06 * Math.sin(a))];
    });
    const N = loopNoise(c, 101, 5 / cl.H, 1, 2), F = loopNoise(c, 103, 14 / cl.H, 1, 3);
    // the whole cloud pushed out of shape by a slow noise: torn, uneven, its base too
    const Wp = loopNoise(c, 107, 2.5 / cl.H, 1, 1);
    // the lobes by column, so a pixel only looks at the ones that can reach it
    // (by cell of a grid, each packed flat: x, y, 1 / radius per lobe)
    const cell = Math.max(6, cl.H * 0.2), off = cl.E + cl.H, top = cl.H * 1.8, gw = Math.ceil(2 * off / cell) + 1, gh = Math.ceil(cl.H * 2.4 / cell) + 1;
    const lists = new Array(gw * gh);
    for (const q of lobes) {
      const i0 = Math.max(0, Math.floor((q[0] - q[2] + off) / cell)), i1 = Math.min(gw - 1, Math.floor((q[0] + q[2] + off) / cell));
      const j0 = Math.max(0, Math.floor((q[1] - q[2] + top) / cell)), j1 = Math.min(gh - 1, Math.floor((q[1] + q[2] + top) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) (lists[j * gw + i] = lists[j * gw + i] || []).push(q[0], q[1], 1 / q[2]);
    }
    const cols = Array.from(lists, (l) => (l ? new Float64Array(l) : null));
    // the lobes' density at a point (cloud-relative)
    const densAt = (px, py) => {
      const gi = Math.floor((px + off) / cell), gj = Math.floor((py + top) / cell);
      const col = gi >= 0 && gj >= 0 && gi < gw && gj < gh ? cols[gj * gw + gi] : null;
      let D = 0;
      if (col) for (let i = 0; i < col.length; i += 3) {
        const ir = col[i + 2], u = (px - col[i]) * ir, v = (py - col[i + 1]) * ir, d2 = u * u + v * v;
        if (d2 < 1) D += (1 - d2) * (1 - d2);
      }
      return D;
    };
    const B = loopNoise(c, 109, 4.5 / cl.H, 1, 2), B2 = loopNoise(c, 113, 12 / cl.H, 1, 3);
    // where the cloud can be at all (each lobe, grown by the most the noise can
    // push it): the empty sky round it costs nothing
    const ms = Math.max(3, cl.H * 0.06), moy = cl.H * 1.6, mw = Math.ceil(2 * off / ms) + 1, mh = Math.ceil(cl.H * 2 / ms) + 1;
    const mask = new Uint8Array(mw * mh), mx = cl.H * 0.13, my = cl.H * 0.09;
    for (const [dx, dy, r] of lobes) {
      const i0 = Math.max(0, Math.floor((dx - r - mx + off) / ms)), i1 = Math.min(mw - 1, Math.floor((dx + r + mx + off) / ms));
      const j0 = Math.max(0, Math.floor((dy - r - my + moy) / ms)), j1 = Math.min(mh - 1, Math.floor((dy + r + my + moy) / ms));
      for (let j = j0; j <= j1; j++) mask.fill(1, j * mw + i0, j * mw + i1 + 1);
    }
    // and grown by what the noise grids read round a pixel (a grid step, and
    // the billows a little nearer the sun): where their values are needed
    const grow = Math.ceil((Math.max(1.5, cl.H / 48) + cl.H * 0.06) / ms) + 1, near = new Uint8Array(mw * mh);
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      if (!mask[j * mw + i]) continue;
      for (let jj = Math.max(0, j - grow); jj <= Math.min(mh - 1, j + grow); jj++) near.fill(1, jj * mw + Math.max(0, i - grow), jj * mw + Math.min(mw - 1, i + grow) + 1);
    }
    for (const [X, Y] of cloudPlaces(c, cl)) {
      const x0 = Math.max(0, Math.floor(X - cl.E - cl.H * 0.2)), x1 = Math.min(w, Math.ceil(X + cl.E + cl.H * 0.2));
      const y0 = Math.max(0, Math.floor(Y - cl.H * 1.4)), y1 = Math.min(h, Math.ceil(Y + cl.H * 0.13 + 2));
      if (x1 <= x0 || y1 <= y0) continue;
      // the slow noises (the push, the billows) read off a fine grid: they
      // change too slowly between its points for the difference to show
      const lx0 = x0 - 1 - X + cl.i * 131, step = Math.max(1.5, cl.H / 48);
      const keep = (lx, y) => {
        const i = Math.floor((lx - cl.i * 131 + off) / ms), j = Math.floor((y - Y + moy) / ms);
        return i >= 0 && j >= 0 && i < mw && j < mh && near[j * mw + i] === 1;
      };
      const Ng = noiseGrid(N, lx0, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, step, keep), Wg = noiseGrid(Wp, lx0, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, step, keep);
      const Bg = noiseGrid(B, lx0, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, Math.max(1.5, step * 0.75), keep), B2g = noiseGrid(B2, lx0, y0 - 1, x1 - x0 + 2, y1 - y0 + 2, Math.max(1.5, step * 0.45), keep);
      field(g, x0, y0, x1, y1, fieldScale(c, cl.H * 0.15), (x0_, y0_, out) => {
        const mi = Math.floor((x0_ - X + off) / ms), mj = Math.floor((y0_ - Y + moy) / ms);
        if (mi < 0 || mj < 0 || mi >= mw || mj >= mh || !mask[mj * mw + mi]) return false;
        const lx = x0_ - X + cl.i * 131;
        const n = Ng(lx, y0_), x = x0_ + (Wg(lx, y0_) - 0.5) * cl.H * 0.25, y = y0_ + (n - 0.5) * cl.H * 0.16;
        const px = x - X, py = y - Y;
        // density from the lobes; each lobe lit on its upper left, the one in
        // front (the strongest) taking over: the heaps show, one on another
        let D = 0, Lw = 0, Ls = 0;
        {
          const gi = Math.floor((px + off) / cell), gj = Math.floor((py + top) / cell);
          const col = gi >= 0 && gj >= 0 && gi < gw && gj < gh ? cols[gj * gw + gi] : null;
          if (col) {
            for (let i = 0; i < col.length; i += 3) {
              const ir = col[i + 2], u = (px - col[i]) * ir, v = (py - col[i + 1]) * ir, d2 = u * u + v * v;
              if (d2 >= 1) continue;
              const f = (1 - d2) * (1 - d2), f2 = f * f, q = f2 * f2;
              D += f; Lw += q;
              const l = 0.5 - (v * 0.8 + u * 0.35) * 0.55;
              Ls += q * (l < 0 ? 0 : l > 1 ? 1 : l);
            }
          }
        }
        if (D <= 0.002) return false;
        const body = 1 - Math.exp(-D * 2.5), edge = 1 - smooth(0.25, 0.65, body);
        // billows: puffs within puffs (the cauliflower), a noise folded into
        // round heaps with soft creases between them (squared: no sharp folds); and a little nearer the sun,
        // to light them like bumps (the side towards it bright)
        const e = cl.H * 0.05, b0 = 2 * Bg(lx, y0_) - 1, b1 = 2 * Bg(lx - 0.42 * e, y0_ - 0.91 * e) - 1, b = b0 * b0, bs = b1 * b1;
        // and smaller ones on them
        const e2 = cl.H * 0.02, c0 = 2 * B2g(lx, y0_) - 1, c1 = 2 * B2g(lx - 0.42 * e2, y0_ - 0.91 * e2) - 1, b2 = c0 * c0, b2s = c1 * c1;
        // a thin cloud: see-through, its edges more frayed; out at the edge,
        // finer wisps (only there: inside, nothing to fray)
        // (the billows show in the light, hardly in the outline: the shape is the lobes')
        const dens = body * (0.92 + 0.1 * b + 0.06 * b2) + (n - 0.5) * (0.3 + 0.4 * (1 - cl.dn)) + (edge > 0 ? (F(lx, y0_) - 0.5) * 0.5 * edge : 0);
        // misty: the edge thinning out to nothing over a wide band, a faint
        // haze of vapour round it, the base fading softly under its line
        const a = Math.max(smooth(0.06, 0.52, dens), 0.15 * smooth(0, 0.35, body)) * (0.45 + 0.55 * cl.dn) * smooth(Y + cl.H * 0.03, Y - cl.H * 0.14, y) * env;
        if (a <= 0.004) return false;
        // lit like a real one: how much cloud lies between here and the sun
        // (upper left) — the sides facing it white, the far side and the
        // inside in soft shadow; higher up brighter, grey along the base, the
        // billows catching the light
        const toSun = densAt(px - 0.42 * cl.H * 0.09, py - 0.91 * cl.H * 0.09) * 0.6 + densAt(px - 0.42 * cl.H * 0.24, py - 0.91 * cl.H * 0.24) * 0.4;
        const lit = 1 - 0.85 * (1 - Math.exp(-toSun * 1.5));
        const up = Math.max(0, Math.min(1, (Y - y) / cl.H));
        const bump = (Math.max(-0.18, Math.min(0.18, (b - bs) * 1.6)) + Math.max(-0.1, Math.min(0.1, (b2 - b2s) * 1.2))) * (0.4 + 0.6 * lit);
        const light = Math.max(0, Math.min(1, 0.02 + 0.32 * lit + 0.3 * up + 0.45 * (Ls / Lw) + 0.6 * bump + (b - 0.5) * 0.06 + (n - 0.5) * 0.1 - 0.25 * (1 - smooth(0, 0.35, up))));
        const s = light * 3, j = Math.min(2, Math.floor(s)), k = s - j;
        const cc = ramp[j], cn = ramp[j + 1];
        out[0] = cc[0] + (cn[0] - cc[0]) * k; out[1] = cc[1] + (cn[1] - cc[1]) * k; out[2] = cc[2] + (cn[2] - cc[2]) * k;
        out[3] = a;
      });
    }
  }
}
