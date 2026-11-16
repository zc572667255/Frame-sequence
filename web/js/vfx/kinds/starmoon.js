// Line-art circles for 魔法阵's ground auras.
// 星月法阵 (魔法阵's ground aura "arrows", which it replaced): the star-and-moon
// circle — an outer double ring with a ladder band, eight zodiac signs and four
// medallions, the crescent moon on the left and the sun on the right, a
// twelve-pointed star of four triangles, an inner ladder ring and a pentagram
// with a fan of rays between its arms.
//
// Line art only, in groups: { spin, col, w, lines } — lines are polylines of
// [x, y] on a circle of radius 1 (y down, the top at y = -1); spin: how far
// the group turns per loop (radians, each by one of its symmetry steps so a
// loop closes; the frame, the signs, sun and moon stay put); col: "core" (the
// bright colour) or "rim"; w: line width, of the aura's own. auras.js draws
// it, and godot/code.js carries the same data into the exported script.
const TAU = Math.PI * 2;
const circle = (r, cx = 0, cy = 0, n = 96) => Array.from({ length: n + 1 }, (_, i) => { const a = i / n * TAU; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
// a point at radius r, angle a (0 at the top, clockwise)
const polar = (r, a) => [Math.sin(a) * r, -Math.cos(a) * r];
// radial ticks between r0 and r1, n round
const ticks = (r0, r1, n, off = 0) => Array.from({ length: n }, (_, i) => { const a = off + i / n * TAU; return [polar(r0, a), polar(r1, a)]; });

// zodiac signs and medallion marks, as strokes in a box of ±1 (y down)
const SIGNS = [
  // ♍ virgo
  [[[-1, -0.6], [-1, 0.8]], [[-1, -0.4], [-0.65, -0.8], [-0.3, -0.4], [-0.3, 0.8]], [[-0.3, -0.4], [0.05, -0.8], [0.4, -0.4], [0.4, 0.6], [0.75, 0.9]], [[0.4, 0.2], [0.9, 0.05], [0.85, 0.55], [0.4, 0.6]]],
  // ♎ libra
  [[[-1, 0.7], [1, 0.7]], [[-1, 0.3], [-0.4, 0.3], [-0.5, -0.2], [0, -0.6], [0.5, -0.2], [0.4, 0.3], [1, 0.3]]],
  // ♏ scorpio
  [[[-1, -0.6], [-1, 0.8]], [[-1, -0.4], [-0.65, -0.8], [-0.3, -0.4], [-0.3, 0.8]], [[-0.3, -0.4], [0.05, -0.8], [0.4, -0.4], [0.4, 0.6], [0.95, 0.9]], [[0.6, 0.98], [0.95, 0.9], [0.85, 0.55]]],
  // ♐ sagittarius
  [[[-0.9, 0.9], [0.9, -0.9]], [[0.15, -0.9], [0.9, -0.9], [0.9, -0.15]], [[-0.6, -0.1], [0.1, 0.6]]],
  // ♑ capricorn
  [[[-1, -0.6], [-0.6, 0.6], [-0.2, -0.6], [0.2, 0.4], [0.6, 0.6], [0.8, 0.2], [0.5, -0.1], [0.2, 0.4], [-0.1, 0.9]]],
  // ♒ aquarius
  [[[-1, -0.2], [-0.5, -0.6], [0, -0.2], [0.5, -0.6], [1, -0.2]], [[-1, 0.4], [-0.5, 0], [0, 0.4], [0.5, 0], [1, 0.4]]],
  // ♓ pisces
  [[[-0.8, -0.9], [-0.4, -0.45], [-0.4, 0.45], [-0.8, 0.9]], [[0.8, -0.9], [0.4, -0.45], [0.4, 0.45], [0.8, 0.9]], [[-0.7, 0], [0.7, 0]]],
  // ♌ leo
  [[[-0.6, 0.6], [-0.9, 0.3], [-0.6, 0], [-0.3, 0.3], [-0.6, 0.6]], [[-0.3, 0.3], [-0.2, -0.5], [0.3, -0.8], [0.7, -0.4], [0.5, 0.3], [0.7, 0.8], [1, 0.6]]],
];
const MARKS = [
  [[[-0.5, -0.6], [0.5, -0.6]], [[0, -0.6], [0, 0.7]], [[-0.6, 0.1], [0.6, 0.1]], [[-0.5, 0.7], [0.5, 0.7]]],
  [[[-0.6, -0.5], [0.6, -0.5]], [[-0.45, -0.5], [-0.45, 0.7]], [[0.45, -0.5], [0.45, 0.7]], [[-0.45, 0.1], [0.45, 0.1]], [[0, -0.8], [0, 0.7]]],
  [[[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6], [-0.6, -0.6]], [[0, -0.6], [0, 0.6]], [[-0.6, 0], [0.6, 0]]],
  [[[0, -0.8], [0, 0.8]], [[-0.7, -0.3], [0.7, -0.3]], [[-0.6, 0.3], [0, 0], [0.6, 0.3]]],
];
// a glyph at radius r, angle a, size s, standing with its top outward
const glyph = (strokes, r, a, s) => strokes.map((st) => st.map(([x, y]) => {
  const px = x * s, py = y * s - r, c = Math.cos(a), sn = Math.sin(a);
  return [px * c - py * sn, px * sn + py * c];
}));

function build() {
  const frame = [], fine = [];
  // the outer double ring and its ladder band
  frame.push(circle(0.99), circle(0.93));
  fine.push(circle(0.905), ...ticks(0.905, 0.93, 72));
  // a ring for the signs and the twelve-pointed star to sit in
  fine.push(circle(0.86));
  // eight zodiac signs, the quarters left for the medallions, sun and moon
  [1, 2, 4, 5, 7, 8, 10, 11].forEach((n, i) => fine.push(...glyph(SIGNS[i], 0.79, n * TAU / 12, 0.045)));
  // four medallions on the outer ring, each with its mark
  [0, 1, 2, 3].forEach((q) => {
    const a = q * TAU / 4, [x, y] = polar(0.945, a);
    frame.push(circle(0.05, x, y, 32));
    fine.push(...glyph(MARKS[q], 0.945, a, 0.028));
  });
  // the crescent moon on the left: two circles, the inner one off to the right
  frame.push(circle(0.27, -0.72, 0, 64), circle(0.21, -0.665, 0, 64));
  // the sun on the right: a disc, an eight-pointed star of rays, flames between them
  const sx = 0.72, sun = [circle(0.11, sx, 0, 48)];
  const star8 = [];
  for (let i = 0; i <= 16; i++) { const a = i / 16 * TAU, r = i % 2 ? 0.13 : (i % 4 ? 0.19 : 0.26); star8.push([sx + Math.sin(a) * r, -Math.cos(a) * r]); }
  sun.push(star8);
  const flames = [];
  for (let i = 0; i < 8; i++) {
    const a0 = (i + 0.5) / 8 * TAU, pts = [];
    for (let j = 0; j <= 10; j++) { const f = j / 10, r = 0.14 + 0.13 * f, a = a0 + 0.12 * Math.sin(f * Math.PI * 2.5); pts.push([sx + Math.sin(a) * r, -Math.cos(a) * r]); }
    flames.push(pts);
  }
  // the twelve-pointed star: four triangles, a twelfth of a turn apart
  const star12 = [];
  for (let k = 0; k < 4; k++) star12.push([0, 1, 2, 3].map((i) => polar(0.86, k * TAU / 12 + i * TAU / 3)));
  // the inner ladder ring
  const ladder = [circle(0.6), circle(0.565), ...ticks(0.565, 0.6, 48)];
  // the pentagram (its outline) and a fan of rays between its arms
  const ro = 0.555, ri = ro * 0.382, penta = [];
  for (let i = 0; i <= 10; i++) penta.push(polar(i % 2 ? ri : ro, i * TAU / 10));
  const fan = [];
  for (let i = 0; i < 5; i++) {
    const g = (i + 0.5) * TAU / 5, v = polar(ri, g);
    for (const d of [-0.36, 0, 0.36]) fan.push([v, polar(0.565, g + d)]);
    fan.push([polar(0.565, g - 0.36), polar(0.565, g + 0.36)]);
  }
  return [
    { spin: 0, col: "core", w: 1.1, lines: frame },
    { spin: 0, col: "rim", w: 0.6, lines: fine },
    { spin: 0, col: "core", w: 0.9, lines: sun },
    { spin: 0, col: "rim", w: 0.6, lines: flames },
    { spin: TAU / 12, col: "rim", w: 0.75, lines: star12 },
    { spin: -TAU / 48, col: "rim", w: 0.6, lines: ladder },
    { spin: -TAU / 5, col: "core", w: 1.0, lines: [penta] },
    { spin: -TAU / 5, col: "rim", w: 0.55, lines: fan },
  ];
}

export const STARMOON = build();

// an arc of the circle round c (radius r) from angle a0 to a1, the way that
// passes angle mid (angles from +x, y down)
function arcThrough(c, r, a0, a1, mid, n = 48) {
  const norm = (a) => ((a % TAU) + TAU) % TAU;
  let span = norm(a1 - a0);
  if (norm(mid - a0) > span) span -= TAU; // the other way round
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + span * i / n; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]; });
}
// a crescent: the disc round c1 (r1) with the disc round c2 (r2) taken out
// of it — its outline, the outer arc and the inner one, both facing away from c2
function crescent(c1, r1, c2, r2) {
  const dx = c2[0] - c1[0], dy = c2[1] - c1[1], d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const bx = c1[0] + ux * a, by = c1[1] + uy * a, P = [bx - uy * h, by + ux * h], Q = [bx + uy * h, by - ux * h];
  const away = Math.atan2(-uy, -ux), ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  return [arcThrough(c1, r1, ang(c1, P), ang(c1, Q), away), arcThrough(c2, r2, ang(c2, P), ang(c2, Q), away)];
}

// 月之法阵 (ground aura "moon"): a triple outer ring with a band of blocks and
// four medallions, an eight-pointed star of double lines ({8/3}) with a sign
// in each point, an inner ring of blocks with eight arrowheads, rays round a
// disc in the middle, the big crescent over it, and on the right a double
// circle holding a small crescent. Line art only: no colours filled in.
function buildMoon() {
  const frame = [circle(0.99), circle(0.955), circle(0.935), circle(0.885)], fine = [...ticks(0.885, 0.935, 64)];
  [0, 1, 2, 3].forEach((q) => {
    const a = q * TAU / 4, [x, y] = polar(0.91, a);
    frame.push(circle(0.05, x, y, 32));
    fine.push(...glyph(MARKS[q], 0.91, a, 0.028));
  });
  // the eight-pointed star, each line doubled into a band
  const star = [];
  for (const r of [0.865, 0.74]) star.push(Array.from({ length: 9 }, (_, i) => polar(r, (i * 3 % 8) * TAU / 8)));
  // a sign in each of its points
  SIGNS.forEach((s, i) => fine.push(...glyph(s, 0.69, i * TAU / 8, 0.036)));
  // the inner ring of blocks, and eight arrowheads pointing out from it
  const ring2 = [circle(0.58), circle(0.535), ...ticks(0.535, 0.58, 40)];
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) * TAU / 8;
    ring2.push([polar(0.585, a - 0.07), polar(0.66, a), polar(0.585, a + 0.07), polar(0.585, a - 0.07)]);
  }
  // rays round the disc in the middle
  const rays = ticks(0.3, 0.53, 36);
  const disc = [circle(0.3), circle(0.27)];
  // the big crescent, thick to the upper right, open to the lower left
  const moon = crescent([0.03, -0.04], 0.4, [-0.08, 0.06], 0.34);
  // the double circle on the right with the small crescent in it
  const side = [circle(0.27, 0.52, -0.03, 64), circle(0.25, 0.52, -0.03, 64), ...crescent([0.56, 0.0], 0.17, [0.47, -0.08], 0.15)];
  return [
    { spin: 0, col: "core", w: 1.1, lines: frame },
    { spin: 0, col: "rim", w: 0.6, lines: fine },
    { spin: TAU / 8, col: "rim", w: 0.75, lines: star },
    { spin: -TAU / 8, col: "rim", w: 0.6, lines: ring2 },
    { spin: TAU / 36, col: "rim", w: 0.5, lines: rays },
    { spin: 0, col: "rim", w: 0.75, lines: disc },
    { spin: 0, col: "core", w: 1.15, lines: moon },
    { spin: 0, col: "core", w: 0.9, lines: side },
  ];
}

export const MOONCIRCLE = buildMoon();
