// Frost left behind an ice lance (drawn by icemagic.js). The wake width and shard helpers
// stay on the birth time of the path (seeking a frame does not reshuffle them).
import { rng } from "../../trails/glow/util.js";
import { drawIceMagicWake } from "./icemagic.js";

export function iceWakeHalf(r, u, trailWidth = 70, strength = 1) {
  const widen = 0.35 + 0.7 * Math.max(0, Math.min(180, trailWidth)) / 100;
  const along = 0.1 + 0.9 * Math.pow(Math.max(0, Math.min(1, u)), 0.62);
  return Math.max(0, r) * widen * along * Math.sqrt(Math.max(0, strength));
}

function centerline(points) {
  const pts = [];
  for (const p of points) if (!pts.length || Math.hypot(p[0] - pts.at(-1)[0], p[1] - pts.at(-1)[1]) > 0.35) pts.push(p);
  if (pts.length < 2) return null;
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, lengths, total: lengths.at(-1) };
}

function atLength(line, dist) {
  const { pts, lengths } = line;
  let i = 1;
  while (i < pts.length - 1 && lengths[i] < dist) i++;
  const seg = lengths[i] - lengths[i - 1] || 1;
  const f = Math.max(0, Math.min(1, (dist - lengths[i - 1]) / seg));
  const a = pts[i - 1], b = pts[i];
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  return { x: a[0] + dx * f, y: a[1] + dy * f, nx: -dy / len, ny: dx / len, dx: dx / len, dy: dy / len };
}

// Same emission order as _remote_ice_wake in godot/ice.js.
export function iceWakeShards(points, r, strength, seed, oldest, newest, trailWidth = 70, frame = 0) {
  const line = centerline(points);
  if (!line || line.total < 0.5 || strength <= 0.001) return [];
  const span = Math.max(0.001, newest - oldest), step = 0.85;
  const shards = [];
  for (let n = Math.ceil(oldest / step); n <= Math.floor(newest / step + 1e-6); n++) {
    const born = n * step, u = Math.max(0, Math.min(1, (born - oldest) / span));
    const p = atLength(line, u * line.total);
    const P = rng(seed * 503 + n * 97);
    const side = (P() * 2 - 1) * iceWakeHalf(r, u, trailWidth, strength) * 0.72;
    const dir = P() < 0.5 ? -1 : 1;
    const spin = dir * (frame * 0.35 + P() * 6.2);
    const length = r * (0.22 + P() * 0.42) * (0.45 + u * 0.7);
    const width = length * (0.18 + P() * 0.16);
    const alpha = strength * Math.pow(Math.max(0.001, u), 0.35) * (0.45 + P() * 0.5);
    const angle = Math.atan2(p.dy, p.dx) + (P() - 0.5) * 0.9 + spin;
    shards.push({ at: [p.x + p.nx * side, p.y + p.ny * side], angle, length, width, alpha, u });
  }
  return shards;
}

export function drawIceWake(g, pal, points, r, strength, seed, clock, trailWidth, frame, amount = 1) {
  const line = centerline(points);
  if (!line || strength <= 0.001) return;
  drawIceMagicWake(g, pal, points, r, strength, seed, clock, trailWidth, frame, amount);
}
