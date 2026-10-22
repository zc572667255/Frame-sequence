// The small drawn shapes the glow layers are built from: filaments, stars,
// ice crystals, stones and teardrops.
import { rgba } from "./util.js";

// a pointed filament along a run of sections: zero width where it starts (u0),
// full width at the head; vAt(u) says where across the trail it runs
export function filament(g, r, u0, vAt, width) {
  const lo = [], hi = [];
  for (const q of r) {
    if (q.u < u0) continue;
    const t = (q.u - u0) / Math.max(1e-3, 1 - u0);
    const v = vAt(q.u);
    const c = [q.a[0] + (q.b[0] - q.a[0]) * v, q.a[1] + (q.b[1] - q.a[1]) * v];
    let nx = q.b[0] - q.a[0], ny = q.b[1] - q.a[1];
    const nl = Math.hypot(nx, ny) || 1;
    const half = (width / 2) * Math.pow(t, 0.8);
    nx = nx / nl * half; ny = ny / nl * half;
    lo.push([c[0] - nx, c[1] - ny]); hi.push([c[0] + nx, c[1] + ny]);
  }
  if (lo.length < 2) return;
  g.beginPath();
  for (const p of lo) g.lineTo(p[0], p[1]);
  for (let i = hi.length - 1; i >= 0; i--) g.lineTo(hi[i][0], hi[i][1]);
  g.closePath();
  g.fill();
}

export function star(og, p, s, c, a, tilt) {
  const halo = og.createRadialGradient(p[0], p[1], 0, p[0], p[1], s);
  halo.addColorStop(0, `rgba(255,255,255,${(0.9 * a).toFixed(3)})`);
  halo.addColorStop(0.3, rgba(c, 0.4 * a));
  halo.addColorStop(1, rgba(c, 0));
  og.fillStyle = halo;
  og.beginPath(); og.arc(p[0], p[1], s, 0, Math.PI * 2); og.fill();
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  for (const [dx, dy, len] of [[ca, sa, s * 1.8], [-sa, ca, s * 1.2]]) {
    const x0 = p[0] - dx * len, y0 = p[1] - dy * len, x1 = p[0] + dx * len, y1 = p[1] + dy * len;
    const ray = og.createLinearGradient(x0, y0, x1, y1);
    ray.addColorStop(0, "rgba(255,255,255,0)");
    ray.addColorStop(0.5, `rgba(255,255,255,${(0.95 * a).toFixed(3)})`);
    ray.addColorStop(1, "rgba(255,255,255,0)");
    og.strokeStyle = ray;
    og.lineWidth = Math.max(0.6, s / 6);
    og.beginPath(); og.moveTo(x0, y0); og.lineTo(x1, y1); og.stroke();
  }
  // the lens streak: long and faint, always level
  const fl = s * 4.5, fx = og.createLinearGradient(p[0] - fl, p[1], p[0] + fl, p[1]);
  fx.addColorStop(0, rgba(c, 0));
  fx.addColorStop(0.5, rgba(c, 0.45 * a));
  fx.addColorStop(1, rgba(c, 0));
  og.strokeStyle = fx;
  og.lineWidth = Math.max(0.5, s / 10);
  og.beginPath(); og.moveTo(p[0] - fl, p[1]); og.lineTo(p[0] + fl, p[1]); og.stroke();
}

// one ice crystal: a long kite pointed at both ends, split down its length into
// a light face and a shaded face with a bright ridge between them — the look of
// a faceted shard catching the light. along / out: unit vectors (its length
// runs along `along`); light: the bright colour, dark: the shaded one.
export function crystal(og, c, along, out, len, wid, light, dark, ridge, a) {
  const f = [c[0] + along[0] * len * 0.62, c[1] + along[1] * len * 0.62];
  const bk = [c[0] - along[0] * len * 0.38, c[1] - along[1] * len * 0.38];
  const s1 = [c[0] + out[0] * wid * 0.5 + along[0] * len * 0.06, c[1] + out[1] * wid * 0.5 + along[1] * len * 0.06];
  const s2 = [c[0] - out[0] * wid * 0.42 - along[0] * len * 0.04, c[1] - out[1] * wid * 0.42 - along[1] * len * 0.04];
  const tri = (p, q, r, col) => { og.fillStyle = col; og.beginPath(); og.moveTo(p[0], p[1]); og.lineTo(q[0], q[1]); og.lineTo(r[0], r[1]); og.closePath(); og.fill(); };
  tri(f, s1, bk, rgba(light, 0.8 * a));
  tri(f, bk, s2, rgba(dark, 0.7 * a));
  og.strokeStyle = rgba(ridge, 0.9 * a);
  og.lineWidth = Math.max(0.5, wid / 9);
  og.beginPath(); og.moveTo(f[0], f[1]); og.lineTo(bk[0], bk[1]); og.stroke();
}

// one stone: an irregular polygon shaded like a solid lit from the upper left —
// a gradient from the light colour to the dark one across it, a lit top facet,
// a shadowed lower facet and a thin dark outline. rnd: the random source that
// shapes it.
export function rockShape(og, c, size, spin, rnd, cols, a) {
  const n = 6 + Math.floor(rnd() * 3), pts = [];
  for (let i = 0; i < n; i++) {
    const th = spin + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.5, rr = size * (0.62 + 0.45 * rnd());
    pts.push([c[0] + Math.cos(th) * rr, c[1] + Math.sin(th) * rr]);
  }
  const poly = (q) => { og.beginPath(); q.forEach((v, i) => (i ? og.lineTo(v[0], v[1]) : og.moveTo(v[0], v[1]))); og.closePath(); };
  const gr = og.createLinearGradient(c[0] - size, c[1] - size, c[0] + size, c[1] + size);
  gr.addColorStop(0, rgba(cols[2], a));
  gr.addColorStop(0.55, rgba(cols[1], a));
  gr.addColorStop(1, rgba(cols[0], a));
  poly(pts);
  og.fillStyle = gr; og.fill();
  og.strokeStyle = rgba(cols[0], 0.9 * a); og.lineWidth = Math.max(0.5, size / 8); og.stroke();
  // the lit top facet: the upper-left vertices pulled toward the centre
  const lit = pts.filter((v) => (v[0] - c[0]) + (v[1] - c[1]) < size * 0.2);
  if (lit.length >= 2) {
    poly([...lit, [c[0] + size * 0.05, c[1] + size * 0.05]]);
    og.fillStyle = rgba(cols[3] || cols[2], 0.75 * a); og.fill();
  }
  // a shadowed facet below-right
  const dark = pts.filter((v) => (v[0] - c[0]) + (v[1] - c[1]) > size * 0.35);
  if (dark.length >= 2) {
    poly([...dark, [c[0] + size * 0.15, c[1] + size * 0.15]]);
    og.fillStyle = rgba(cols[0], 0.55 * a); og.fill();
  }
}

// one teardrop at c heading (dx, dy): round at the front, drawn out to a point
// behind, a light body fading toward the tail and a white glint
export function teardrop(og, c, dx, dy, r, tailLen, cols, coreC, a) {
  const nx = -dy, ny = dx, back = [c[0] - dx * tailLen, c[1] - dy * tailLen];
  og.beginPath();
  og.moveTo(back[0], back[1]);
  og.quadraticCurveTo(c[0] + nx * r * 1.1 - dx * r * 0.6, c[1] + ny * r * 1.1 - dy * r * 0.6, c[0] + dx * r, c[1] + dy * r);
  og.quadraticCurveTo(c[0] - nx * r * 1.1 - dx * r * 0.6, c[1] - ny * r * 1.1 - dy * r * 0.6, back[0], back[1]);
  og.closePath();
  const gr = og.createLinearGradient(back[0], back[1], c[0] + dx * r, c[1] + dy * r);
  gr.addColorStop(0, rgba(cols[1], 0.4 * a));
  gr.addColorStop(1, rgba(cols[2], 0.95 * a));
  og.fillStyle = gr; og.fill();
  og.fillStyle = rgba(coreC, 0.9 * a);
  og.beginPath(); og.arc(c[0] + nx * r * 0.3, c[1] + ny * r * 0.3, Math.max(0.5, r * 0.3), 0, Math.PI * 2); og.fill();
}
