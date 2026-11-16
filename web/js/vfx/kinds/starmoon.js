// Line-art circles for 魔法阵's ground auras: 星月法阵 ("arrows", which took
// the place of 箭阵光环) and 月之法阵 ("moon").
//
// Each is { groups, masks }. A group is { spin, col, w, lines, top } — lines are
// polylines of [x, y] on a circle of radius 1 (y down, the top at y = -1); spin:
// how far the group turns per loop (radians, one of its symmetry steps, so a
// loop closes); col: "core" (the bright colour) or "rim"; w: line width, of
// the aura's own; top: one of the emblems (stars, moons, the sun) that lie on
// top. masks: their footprints (closed polygons, unit coordinates): the groups
// under them — everything that turns, and the frame — are cut away inside
// them (clipOut), so the turning lines pass under the stars and moons instead
// of across them. auras.js draws it; godot/code.js carries the same data into
// the exported script and cuts the same way.
const TAU = Math.PI * 2;
const circle = (r, cx = 0, cy = 0, n = 96) => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
// a point at radius r, angle a (0 at the top, clockwise)
const polar = (r, a) => [Math.sin(a) * r, -Math.cos(a) * r];
// radial ticks between r0 and r1, n round
const ticks = (r0, r1, n, off = 0) => Array.from({ length: n }, (_, i) => { const a = off + i / n * TAU; return [polar(r0, a), polar(r1, a)]; });

// zodiac signs and medallion marks, as strokes in a box of ±1 (y down)
const SIGNS = [
  [[[-1, -0.6], [-1, 0.8]], [[-1, -0.4], [-0.65, -0.8], [-0.3, -0.4], [-0.3, 0.8]], [[-0.3, -0.4], [0.05, -0.8], [0.4, -0.4], [0.4, 0.6], [0.75, 0.9]], [[0.4, 0.2], [0.9, 0.05], [0.85, 0.55], [0.4, 0.6]]],
  [[[-1, 0.7], [1, 0.7]], [[-1, 0.3], [-0.4, 0.3], [-0.5, -0.2], [0, -0.6], [0.5, -0.2], [0.4, 0.3], [1, 0.3]]],
  [[[-1, -0.6], [-1, 0.8]], [[-1, -0.4], [-0.65, -0.8], [-0.3, -0.4], [-0.3, 0.8]], [[-0.3, -0.4], [0.05, -0.8], [0.4, -0.4], [0.4, 0.6], [0.95, 0.9]], [[0.6, 0.98], [0.95, 0.9], [0.85, 0.55]]],
  [[[-0.9, 0.9], [0.9, -0.9]], [[0.15, -0.9], [0.9, -0.9], [0.9, -0.15]], [[-0.6, -0.1], [0.1, 0.6]]],
  [[[-1, -0.6], [-0.6, 0.6], [-0.2, -0.6], [0.2, 0.4], [0.6, 0.6], [0.8, 0.2], [0.5, -0.1], [0.2, 0.4], [-0.1, 0.9]]],
  [[[-1, -0.2], [-0.5, -0.6], [0, -0.2], [0.5, -0.6], [1, -0.2]], [[-1, 0.4], [-0.5, 0], [0, 0.4], [0.5, 0], [1, 0.4]]],
  [[[-0.8, -0.9], [-0.4, -0.45], [-0.4, 0.45], [-0.8, 0.9]], [[0.8, -0.9], [0.4, -0.45], [0.4, 0.45], [0.8, 0.9]], [[-0.7, 0], [0.7, 0]]],
  [[[-0.6, 0.6], [-0.9, 0.3], [-0.6, 0], [-0.3, 0.3], [-0.6, 0.6]], [[-0.3, 0.3], [-0.2, -0.5], [0.3, -0.8], [0.7, -0.4], [0.5, 0.3], [0.7, 0.8], [1, 0.6]]],
];
const MARKS = [
  [[[-0.5, -0.6], [0.5, -0.6]], [[0, -0.6], [0, 0.7]], [[-0.6, 0.1], [0.6, 0.1]], [[-0.5, 0.7], [0.5, 0.7]]],
  [[[-0.6, -0.5], [0.6, -0.5]], [[-0.45, -0.5], [-0.45, 0.7]], [[0.45, -0.5], [0.45, 0.7]], [[-0.45, 0.1], [0.45, 0.1]], [[0, -0.8], [0, 0.7]]],
  [[[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6], [-0.6, -0.6]], [[0, -0.6], [0, 0.6]], [[-0.6, 0], [0.6, 0]]],
  [[[0, -0.8], [0, 0.8]], [[-0.7, -0.3], [0.7, -0.3]], [[-0.6, 0.3], [0, 0], [0.6, 0.3]]],
];
// a few lowercase letters as strokes in a box of 0..1 wide, the x-height 0.3..1
const LETTERS = {
  m: [[[0, 1], [0, 0.35]], [[0, 0.45], [0.25, 0.3], [0.5, 0.45], [0.5, 1]], [[0.5, 0.45], [0.75, 0.3], [1, 0.45], [1, 1]]],
  a: [[[0.8, 0.45], [0.5, 0.3], [0.15, 0.45], [0.1, 0.8], [0.4, 1], [0.8, 0.85]], [[0.8, 0.35], [0.8, 1]]],
  g: [[[0.8, 0.4], [0.45, 0.3], [0.15, 0.5], [0.3, 0.8], [0.8, 0.7]], [[0.8, 0.35], [0.8, 1.2], [0.5, 1.35], [0.15, 1.2]]],
  i: [[[0.4, 0.35], [0.4, 1]], [[0.4, 0.1], [0.4, 0.17]]],
  c: [[[0.8, 0.4], [0.45, 0.3], [0.12, 0.6], [0.45, 1], [0.8, 0.9]]],
  s: [[[0.8, 0.35], [0.4, 0.3], [0.2, 0.5], [0.6, 0.65], [0.8, 0.85], [0.4, 1], [0.15, 0.9]]],
  q: [[[0.8, 0.4], [0.45, 0.3], [0.15, 0.55], [0.35, 0.95], [0.8, 0.8]], [[0.8, 0.35], [0.8, 1.35]]],
  u: [[[0.15, 0.35], [0.15, 0.85], [0.45, 1], [0.8, 0.85]], [[0.8, 0.35], [0.8, 1]]],
  r: [[[0.2, 0.35], [0.2, 1]], [[0.2, 0.55], [0.5, 0.32], [0.8, 0.38]]],
  e: [[[0.15, 0.65], [0.8, 0.65], [0.6, 0.32], [0.25, 0.38], [0.15, 0.7], [0.45, 1], [0.8, 0.9]]],
};
// strokes in a box (x, y), turned to stand at radius r, angle a, top outward
const place = (strokes, r, a, s, ox = 0) => strokes.map((st) => st.map(([x, y]) => {
  const px = (x + ox) * s, py = y * s - r, c = Math.cos(a), sn = Math.sin(a);
  return [px * c - py * sn, px * sn + py * c];
}));
const glyph = (strokes, r, a, s) => place(strokes, r, a, s);
// a short word bent round the circle at radius r, centred on angle a (letters s tall)
function word(text, r, a, s) {
  const out = [], step = 0.95, w = text.length * step;
  [...text].forEach((ch, i) => {
    const off = (i * step - w / 2 + 0.1) * s, la = a + off / r;
    if (LETTERS[ch]) out.push(...place(LETTERS[ch], r, la, s));
  });
  return out;
}

// an arc of the circle round c (radius r) from angle a0 to a1, the way that
// passes angle mid (angles from +x, y down)
function arcThrough(c, r, a0, a1, mid, n = 48) {
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  let span = norm(a1 - a0);
  if (norm(mid - a0) > span) span -= TAU;
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + span * i / n; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]; });
}
// a crescent: the disc round c1 (r1) with the disc round c2 (r2) taken out of
// it — its outline as one closed polygon (the outer arc, then the inner one back)
function crescent(c1, r1, c2, r2) {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const bx = c1[0] + ux * a, by = c1[1] + uy * a, P = [bx - uy * h, by + ux * h], Q = [bx + uy * h, by - ux * h];
  const away = Math.atan2(-uy, -ux), ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const outer = arcThrough(c1, r1, ang(c1, P), ang(c1, Q), away), inner = arcThrough(c2, r2, ang(c2, P), ang(c2, Q), away);
  return [...outer, ...inner.reverse().slice(1)];
}
const closed = (pl) => [...pl, pl[0]];

// ---- 星月法阵 ----
function buildStarMoon() {
  const frame = [circle(0.99), circle(0.93)], fine = [circle(0.905), ...ticks(0.905, 0.93, 72), circle(0.86)];
  [1, 2, 4, 5, 7, 8, 10, 11].forEach((n, i) => fine.push(...glyph(SIGNS[i], 0.79, n * TAU / 12, 0.045)));
  [0, 1, 2, 3].forEach((q) => {
    const a = q * TAU / 4, [x, y] = polar(0.945, a);
    frame.push(circle(0.05, x, y, 32));
    fine.push(...glyph(MARKS[q], 0.945, a, 0.028));
  });
  // the crescent moon on the left, open towards the middle
  const moon = crescent([-0.72, 0], 0.27, [-0.63, 0], 0.22);
  // the sun on the right: a disc in an eight-pointed star of rays, flames between them
  const sx = 0.72, star8 = [];
  for (let i = 0; i <= 16; i++) { const a = i / 16 * TAU, r = i % 2 ? 0.13 : (i % 4 ? 0.19 : 0.26); star8.push([sx + Math.sin(a) * r, -Math.cos(a) * r]); }
  const flames = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i + 0.5) / 8 * TAU, pts = [];
    for (let j = 0; j <= 10; j++) { const f = j / 10, r = 0.14 + 0.13 * f, a = a0 + 0.12 * Math.sin(f * Math.PI * 2.5); pts.push([sx + Math.sin(a) * r, -Math.cos(a) * r]); }
    flames.push(pts);
  }
  // the twelve-pointed star: four triangles, a twelfth of a turn apart
  const star12 = [];
  for (let k = 0; k < 4; k++) star12.push([0, 1, 2, 3].map((i) => polar(0.86, k * TAU / 12 + i * TAU / 3)));
  const ladder = [circle(0.6), circle(0.565), ...ticks(0.565, 0.6, 48)];
  // the pentagram and the fan of rays between its arms
  const ro = 0.555, ri = ro * 0.382, penta = [];
  for (let i = 0; i <= 10; i++) penta.push(polar(i % 2 ? ri : ro, i * TAU / 10));
  const fan = [];
  for (let i = 0; i < 5; i++) {
    const g = (i + 0.5) * TAU / 5, v = polar(ri, g);
    for (const d of [-0.36, 0, 0.36]) fan.push([v, polar(0.565, g + d)]);
    fan.push([polar(0.565, g - 0.36), polar(0.565, g + 0.36)]);
  }
  return {
    groups: [
      { spin: 0, col: "core", w: 1.1, lines: frame },
      { spin: 0, col: "rim", w: 0.6, lines: fine },
      { spin: TAU / 12, col: "rim", w: 0.75, lines: star12 },
      { spin: -TAU / 48, col: "rim", w: 0.6, lines: ladder },
      { spin: 0, col: "rim", w: 0.55, lines: fan },
      { spin: 0, col: "core", w: 1.1, lines: [closed(moon)], top: true },
      { spin: 0, col: "core", w: 0.9, lines: [circle(0.11, sx, 0, 48), star8], top: true },
      { spin: 0, col: "rim", w: 0.6, lines: flames, top: true },
      { spin: 0, col: "core", w: 1.0, lines: [penta], top: true },
    ],
    masks: [moon, star8.slice(0, -1), penta.slice(0, -1)],
  };
}

// ---- 月之法阵 ----
// a double outer ring with a band of 「magic ✕ square」 written round it and
// four medallions, a double ring inside, a twelve-pointed star of three
// squares in double lines with a sign in each point, an inner ring of blocks with
// eight arrowheads; on top, like a figure 8: a double circle at the top with
// a small crescent in it (thick on the right), and below it the big crescent
// (thick at the lower left, open to the upper right) round a disc set up and
// to the right in its hollow, rays standing out from the disc
function buildMoon() {
  const frame = [circle(0.99), circle(0.965), circle(0.885), circle(0.86)], fine = [];
  [0, 1, 2, 3].forEach((q) => {
    const a = q * TAU / 4, [x, y] = polar(0.925, a);
    frame.push(circle(0.045, x, y, 32));
    fine.push(...glyph(MARKS[q], 0.925, a, 0.026));
  });
  // 「magic ✕ square」 round the band, sixteen times between the medallions
  for (let i = 0; i < 16; i++) {
    const a = (i + 0.5) * TAU / 16, s = 0.022, gap = 0.075;
    fine.push(...word("magic", 0.915, a - gap, s), ...glyph(SIGNS[i % 8], 0.9 + s * 0.6, a, s * 0.5), ...word("square", 0.915, a + gap + 0.02, s));
  }
  // the twelve-pointed star: three squares a twelfth of a turn apart (one
  // with its corners at the medallions), each line doubled into a band, a
  // sign in each of its twelve points
  const star = [];
  for (const off of [0, TAU / 12, TAU / 6]) for (const r of [0.85, 0.775]) star.push(Array.from({ length: 5 }, (_, i) => polar(r, off + i * TAU / 4)));
  for (let i = 0; i < 12; i++) star.push(...glyph(SIGNS[i % 8], 0.71, i * TAU / 12, 0.03));
  // the inner ring of blocks with eight arrowheads on it
  const ring2 = [circle(0.56), circle(0.525), ...ticks(0.525, 0.56, 40)];
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * TAU / 8;
    ring2.push([polar(0.565, a - 0.07), polar(0.64, a), polar(0.565, a + 0.07), polar(0.565, a - 0.07)]);
  }
  // the disc, up and to the right, rays standing out from it to the ring
  const dc = [0.1, -0.03], rays = [];
  for (let i = 0; i < 40; i++) { const a = i / 40 * TAU, c = Math.cos(a), sn = Math.sin(a); rays.push([[dc[0] + c * 0.3, dc[1] + sn * 0.3], [dc[0] + c * 0.4, dc[1] + sn * 0.4]]); }
  const big = crescent([0, 0.1], 0.49, [0.1, -0.03], 0.4);
  const small = crescent([0.02, -0.6], 0.2, [-0.07, -0.63], 0.17);
  return {
    groups: [
      { spin: 0, col: "core", w: 1.1, lines: frame },
      { spin: 0, col: "rim", w: 0.5, lines: fine },
      { spin: TAU / 12, col: "rim", w: 0.75, lines: star },
      { spin: -TAU / 8, col: "rim", w: 0.6, lines: ring2 },
      { spin: 0, col: "rim", w: 0.5, lines: rays, top: true },
      { spin: 0, col: "core", w: 0.85, lines: [circle(0.3, ...dc), circle(0.275, ...dc)], top: true },
      { spin: 0, col: "core", w: 0.9, lines: [circle(0.39, 0, -0.6, 64), circle(0.365, 0, -0.6, 64)], top: true },
      { spin: 0, col: "core", w: 1.15, lines: [closed(big), closed(small)], top: true },
    ],
    masks: [big, small],
  };
}

export const STARMOON = buildStarMoon();
export const MOONCIRCLE = buildMoon();

// a polyline with the parts inside any of the masks cut away: the pieces left
// (each point tested even-odd; a crossing found by halving the step)
const inside = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
export function clipOut(pl, masks) {
  if (!masks.length) return [pl];
  const hid = (p) => masks.some((m) => inside(p, m));
  const pieces = [];
  let cur = hid(pl[0]) ? null : [pl[0]];
  for (let i = 1; i < pl.length; i++) {
    const a = pl[i - 1], b = pl[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01));
    let prev = a, ph = hid(a);
    for (let k = 1; k <= n; k++) {
      const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], qh = hid(q);
      if (qh !== ph) {
        let lo = prev, hi = q;
        for (let s = 0; s < 8; s++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; if (hid(m) === ph) lo = m; else hi = m; }
        const edge = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2];
        if (ph) cur = [edge]; else { cur.push(edge); if (cur.length >= 2) pieces.push(cur); cur = null; }
      }
      if (!qh && k === n) cur.push(b);
      prev = q; ph = qh;
    }
  }
  if (cur && cur.length >= 2) pieces.push(cur);
  return pieces;
}
