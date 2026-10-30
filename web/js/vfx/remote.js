import { isRemoteKind } from "./catalog.js";

export const FLIGHT_PATHS = [["sprite", "原地循环（由游戏移动）"], ["straight", "直线"], ["arc", "弧线"], ["wave", "波浪"], ["spiral", "螺旋"], ["custom", "自定义曲线"]];
export const FLIGHT_EASES = [["linear", "匀速"], ["in", "加速"], ["out", "减速"], ["smooth", "先慢后快再慢"]];
export const FLIGHT_IMPACTS = [["auto", "随属性"], ["none", "无"], ["explosion", "爆炸"], ["shock", "冲击波"], ["hit", "命中火花"]];
export const REMOTE_DEFAULTS = {
  flightPath: "arc", startX: 18, startY: 65, endX: 78, endY: 60,
  controlX: 48, controlY: 20, pathBend: 28, pathWave: 14, pathTurns: 2,
  flightEase: "linear", chargeFrames: 4, travelFrames: 20, impactFrames: 12,
  flightCount: 1, flightInterval: 3, flightSpread: 12,
  bodySize: 7, trailFrames: 8, trailWidth: 70, impactKind: "auto", impactSize: 22,
  headWidth: 100, headCurve: 35,
};
export const FLIGHT_FIELDS = [
  { label: "移动路径", key: "flightPath", options: FLIGHT_PATHS, always: true },
  { label: "起点 X", key: "startX", min: 0, max: 100, unit: "%" },
  { label: "起点 Y", key: "startY", min: 0, max: 100, unit: "%" },
  { label: "终点 X", key: "endX", min: 0, max: 100, unit: "%" },
  { label: "终点 Y", key: "endY", min: 0, max: 100, unit: "%" },
  { label: "曲线控制 X", key: "controlX", min: 0, max: 100, unit: "%", path: ["custom"] },
  { label: "曲线控制 Y", key: "controlY", min: 0, max: 100, unit: "%", path: ["custom"] },
  { label: "弧线弯曲", key: "pathBend", min: -60, max: 60, unit: "%", path: ["arc"] },
  { label: "摆动幅度", key: "pathWave", min: 0, max: 40, unit: "%", path: ["wave", "spiral"] },
  { label: "摆动圈数", key: "pathTurns", min: 1, max: 5, unit: " 圈", path: ["wave", "spiral"] },
  { label: "飞行速度", key: "flightEase", options: FLIGHT_EASES },
  { label: "蓄力", key: "chargeFrames", min: 0, max: 12, unit: " 帧" },
  { label: "飞行", key: "travelFrames", min: 2, max: 32, unit: " 帧" },
  { label: "命中消散", key: "impactFrames", min: 2, max: 20, unit: " 帧" },
  { label: "连发数量", key: "flightCount", min: 1, max: 5, unit: " 个" },
  { label: "发射间隔", key: "flightInterval", min: 0, max: 6, unit: " 帧" },
  { label: "散射幅度", key: "flightSpread", min: 0, max: 35, unit: "%" },
  { label: "弹体大小", key: "bodySize", min: 2, max: 16, unit: "%" },
  { label: "拖尾保留", key: "trailFrames", min: 0, max: 24, unit: " 帧" },
  { label: "拖尾宽度", key: "trailWidth", min: 0, max: 180, unit: "%" },
  { label: "头部宽度", key: "headWidth", min: 20, max: 250, unit: "%", kind: "arrow", always: true },
  { label: "头部弧度", key: "headCurve", min: 0, max: 100, unit: "%", kind: "arrow", always: true },
  { label: "命中效果", key: "impactKind", options: FLIGHT_IMPACTS },
  { label: "命中范围", key: "impactSize", min: 5, max: 40, unit: "%" },
];
export const flightFieldVisible = (f, s) => !(s.kind === "ice" && f.key === "trailWidth") && (!f.kind || f.kind === s.kind) && (f.always || (hasFlight(s) && (!f.path || f.path.includes(s.flightPath))));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const mix = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
export const hasFlight = (s) => isRemoteKind(s.kind) && !!s.flightPath && s.flightPath !== "sprite";

// Old sprites keep their original time/appearance. New flights have an explicit
// charge → travel → impact timeline, capped at the renderer's 64-frame limit.
export function remoteSettings(s) {
  if (!hasFlight(s)) return s;
  const r = { ...REMOTE_DEFAULTS, ...s };
  r.chargeFrames = Math.round(clamp(r.chargeFrames, 0, 12));
  r.travelFrames = Math.round(clamp(r.travelFrames, 2, 32));
  r.impactFrames = Math.round(clamp(r.impactFrames, 2, 20));
  r.flightCount = Math.round(clamp(r.flightCount, 1, 5));
  const budget = 64 - r.chargeFrames - r.travelFrames - r.impactFrames;
  r.flightInterval = Math.round(clamp(r.flightInterval, 0, r.flightCount > 1 ? Math.min(6, Math.floor(budget / (r.flightCount - 1))) : 6));
  r.frames = r.chargeFrames + r.travelFrames + r.impactFrames + (r.flightCount - 1) * r.flightInterval;
  return r;
}

export function pathAt(s, w, h, u, index = 0) {
  const p = { ...REMOTE_DEFAULTS, ...s }, k = Math.min(w, h) / 100;
  const ax = clamp(p.startX, 0, 100) * w / 100, ay = clamp(p.startY, 0, 100) * h / 100;
  const bx = clamp(p.endX, 0, 100) * w / 100, by = clamp(p.endY, 0, 100) * h / 100;
  u = clamp(u, 0, 1);
  if (p.flightPath === "sprite") return [w * 0.62, h * 0.5];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len;
  const fan = (index - (p.flightCount - 1) / 2) * clamp(p.flightSpread, 0, 35) * k;
  let x = mix(ax, bx, u), y = mix(ay, by, u), offset = 0;
  if (p.flightPath === "custom") {
    const cx = clamp(p.controlX, 0, 100) * w / 100, cy = clamp(p.controlY, 0, 100) * h / 100;
    x = (1 - u) ** 2 * ax + 2 * (1 - u) * u * cx + u * u * bx;
    y = (1 - u) ** 2 * ay + 2 * (1 - u) * u * cy + u * u * by;
  } else if (p.flightPath === "arc") offset = Math.sin(Math.PI * u) * clamp(p.pathBend, -60, 60) * k;
  else if (p.flightPath === "wave") offset = Math.sin(u * Math.PI * 2 * clamp(p.pathTurns, 1, 5)) * Math.sin(Math.PI * u) * clamp(p.pathWave, 0, 40) * k;
  else if (p.flightPath === "spiral") {
    const a = u * Math.PI * 2 * clamp(p.pathTurns, 1, 5), r = Math.sin(Math.PI * u) * (1 - u * 0.65) * clamp(p.pathWave, 0, 40) * k;
    offset = Math.sin(a) * r;
    x += dx / len * Math.cos(a) * r * 0.45;
    y += dy / len * Math.cos(a) * r * 0.45;
  }
  offset += fan * Math.sin(Math.PI * u);
  return [x + nx * offset, y + ny * offset];
}

export function pathProgress(s, u) {
  u = clamp(u, 0, 1);
  return s.flightEase === "in" ? u * u : s.flightEase === "out" ? 1 - (1 - u) ** 2 : s.flightEase === "smooth" ? smooth(u) : u;
}

export function flightState(s, w, h, frame, index = 0) {
  const p = remoteSettings(s), time = frame - index * p.flightInterval;
  const born = time >= 0, launched = time >= p.chargeFrames;
  const u = pathProgress(p, (time - p.chargeFrames) / p.travelFrames);
  const hit = (time - p.chargeFrames - p.travelFrames) / p.impactFrames;
  const at = pathAt(p, w, h, u, index);
  const a = pathAt(p, w, h, Math.max(0, u - 0.005), index), b = pathAt(p, w, h, Math.min(1, u + 0.005), index);
  return { at, angle: Math.atan2(b[1] - a[1], b[0] - a[0]), time, u, hit,
    charge: p.chargeFrames ? clamp(time / p.chargeFrames, 0, 1) : 1,
    body: born && hit < 0, born, launched, finished: hit >= 1 };
}

export function flightTrailWindow(s, frame, index = 0) {
  const p = remoteSettings(s), span = clamp(p.trailFrames, 0, 24);
  const time = frame - index * p.flightInterval, arrival = p.chargeFrames + p.travelFrames;
  const newest = Math.min(time, arrival);
  // A short impact phase must still finish the wake before the sequence loops.
  const catchup = Math.max(0, time - arrival) * Math.max(0, span / p.impactFrames - 1);
  const oldest = Math.max(p.chargeFrames, time - span + catchup);
  return { oldest, newest, span };
}

export function flightTrail(s, w, h, frame, index = 0) {
  const p = remoteSettings(s), { oldest, newest, span } = flightTrailWindow(s, frame, index);
  if (span <= 0 || newest <= oldest) return [];
  const n = Math.max(3, Math.ceil((newest - oldest) * 2));
  return Array.from({ length: n + 1 }, (_, i) => pathAt(p, w, h, pathProgress(p, (mix(oldest, newest, i / n) - p.chargeFrames) / p.travelFrames), index));
}
