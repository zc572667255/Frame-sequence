// 远程特效的大小 (特效大小, remoteSize %): how big the flying body is, as a
// share of the most the canvas holds. At 100% the body's box — as wide and as
// tall as it is drawn flying right — just touches the canvas's width or its
// height, whichever it reaches first, keeping its proportions; less is that
// much smaller. So the same setting fits a wide canvas and a tall one alike.
//
// Each kind's box is its half-width × half-height in units of its radius r
// (measured from what it draws flying, glow left out): the radius at 100% is
// min(w / 2 / ex, h / 2 / ey). 剑气 is worked out from its crescent itself
// (外形, 地面夹角, 左右倾斜, 厚度, 弧度 all change it).
//
// Layers made before this (no remoteSize) keep their old size: the radius was
// min(w, h) × 弹体大小 % × 特效大小 / 90 — remoteSizeOf gives the same body as a
// remoteSize, which is what the panel shows and what Godot gets.
import { shapeOf } from "./catalog.js";
import { slashRuns, slashDepth, slashSpan, SLASH_END_FADE } from "./kinds/slash.js";
import { smooth } from "../trails/glow/util.js";

export const REMOTE_SIZE_RANGE = [5, 100];

const BOX = {
  fireball: [1.8, 1.05], thunder: [1.35, 1.35], ice: [4.7, 0.45], wind: [1.35, 1.2], sand: [1.5, 0.6],
};
const ARROW_BOX = { arrow: 3, dagger: 2.8, spear: 3.05, club: 2.95, axe: 2.9, shuriken: 2.65, ball: 2.5, core: 2.3 };
// 剑气's glow round the crescent, in units of r; and how faded a tip may be
// and still count (its ends fade out, slashEnds)
const SLASH_GLOW = 0.15, SLASH_SEEN = 0.2;

// the crescent at r = 1 (half its chord is 4 r), as it is set: what shows of
// it, its faded-out tips left out
export function slashBox(s) {
  const span = slashSpan(s), half = 4, thick = slashDepth(half, span) * Math.max(10, Math.min(90, s.slashThick ?? 60)) / 100;
  const run = slashRuns([0, 0], 0, half, thick, s.slashAngle ?? 90, s.slashShape, span, s.slashLean ?? 0)[0], n = run.length - 1, halfShape = s.slashShape === "half";
  let ex = 0, ey = 0;
  run.forEach((q, k) => {
    const at = halfShape ? 0.5 * k / n : k / n;
    if (smooth(0, SLASH_END_FADE, at) * (halfShape ? 1 : smooth(0, SLASH_END_FADE, 1 - at)) < SLASH_SEEN) return;
    for (const p of [q.a, q.b]) { ex = Math.max(ex, Math.abs(p[0])); ey = Math.max(ey, Math.abs(p[1])); }
  });
  return [ex + SLASH_GLOW, ey + SLASH_GLOW];
}

// [half-width, half-height] of the body in units of its radius
export function remoteBox(s) {
  if (s.kind === "slash") return slashBox(s);
  if (s.kind === "arrow") return [ARROW_BOX[shapeOf(s.shape)] ?? 3, 1.17];
  return BOX[s.kind] || [1.5, 1.5];
}

// the radius at 100%: the body's box just touching the canvas's width or height
export function remoteFullRadius(s, w, h) {
  const [ex, ey] = remoteBox(s);
  return Math.max(0.01, Math.min(w / 2 / ex, h / 2 / ey));
}

const legacyRadius = (s, w, h) => Math.min(w, h) * Math.max(2, Math.min(16, s.bodySize ?? 7)) / 100 * (s.size ?? 90) / 90;

// the body's radius on a w × h canvas
export function remoteRadius(s, w, h) {
  return s.remoteSize == null ? legacyRadius(s, w, h) : remoteFullRadius(s, w, h) * Math.max(0, +s.remoteSize || 0) / 100;
}

// its 特效大小 % (an old layer's size given as one)
export function remoteSizeOf(s, w, h) {
  return s.remoteSize != null ? +s.remoteSize : legacyRadius(s, w, h) / remoteFullRadius(s, w, h) * 100;
}
