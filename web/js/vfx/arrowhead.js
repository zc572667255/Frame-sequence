// The projectile is rigid even on a curved path. Its envelope joins the path
// behind the whole body, then closes ahead of its tip instead of at its centre.
export const headProfile = (q, curve = 35) => {
  const p = 1 + 3 * Math.max(0, Math.min(100, curve)) / 100;
  return Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, Math.min(1, q)), p)), 1 / p);
};

export function arrowSections(points, at, angle, radius, bounds, settings, strength = 1) {
  const dx = Math.cos(angle), dy = Math.sin(angle), nx = -dy, ny = dx;
  const world = (x, y = 0) => [at[0] + dx * x + nx * y, at[1] + dy * x + ny * y];
  const left = bounds[0], right = left + bounds[2], back = left - radius * 0.4;
  const peak = Math.max(radius * 0.38, Math.max(Math.abs(bounds[1]), Math.abs(bounds[1] + bounds[3])) + radius * 0.12) * (settings.headWidth ?? 100) / 100;
  const tailWidth = radius * 0.35 * (settings.trailWidth ?? 70) / 70;
  const front = right + Math.max(radius * 0.65, peak * 0.65);
  // Keep the last historical point behind the rigid body, avoiding a kink
  // through the arrow when its flight path bends sharply.
  let cut = -1;
  points.forEach((p, i) => { if ((p[0] - at[0]) * dx + (p[1] - at[1]) * dy < back) cut = i; });
  const history = cut < 0 ? [] : points.slice(0, cut + 1);
  if (!history.length) history.push(world(back - radius * 2));
  history.push(world(back));
  const sections = [], centres = [], add = (p, vx, vy, half) => {
    centres.push(p); sections.push({ a: [p[0] + vx * half, p[1] + vy * half], b: [p[0] - vx * half, p[1] - vy * half], u: 0 });
  };
  const joinWidth = peak * 0.95;
  for (let i = 0; i < history.length; i++) {
    const a = history[Math.max(0, i - 1)], b = history[Math.min(history.length - 1, i + 1)];
    const vx = b[0] - a[0], vy = b[1] - a[1], len = Math.hypot(vx, vy) || 1;
    const t = i / (history.length - 1), blend = Math.max(0, Math.min(1, (t - 0.6) / 0.4));
    const k = blend * blend * (3 - 2 * blend);
    const half = (tailWidth * Math.pow(t, 0.65) * (1 - k) + joinWidth * k) * Math.sqrt(strength);
    add(history[i], i === history.length - 1 ? nx : -vy / len, i === history.length - 1 ? ny : vx / len, half);
  }
  for (let i = 1; i <= 32; i++) {
    const k = i <= 16 ? i / 16 : (i - 16) / 16;
    const x = i <= 16 ? back + (right - back) * k : right + (front - right) * k;
    const half = i <= 16 ? joinWidth + (peak - joinWidth) * k * k * (3 - 2 * k) : peak * headProfile(k, settings.headCurve);
    add(world(x), nx, ny, half * Math.sqrt(strength));
  }
  let length = 0;
  for (let i = 1; i < sections.length; i++) { length += Math.hypot(centres[i][0] - centres[i - 1][0], centres[i][1] - centres[i - 1][1]); sections[i].u = length; }
  return sections.map(q => ({ ...q, u: q.u / Math.max(0.001, length) }));
}
