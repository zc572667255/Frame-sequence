import { hasFlight, pathAt } from "../vfx/remote.js";

function point(s, r, x, y) {
  const a = (+s.rotate || 0) * Math.PI / 180, dx = (x / 100 - 0.5) * r.w, dy = (y / 100 - 0.5) * r.h;
  return { x: r.x + dx * Math.cos(a) - dy * Math.sin(a), y: r.y + dx * Math.sin(a) + dy * Math.cos(a) };
}
export function pathHandles(s, r) {
  if (!hasFlight(s)) return [];
  const list = [{ key: "start", label: "起", color: "#76e5a2", ...point(s, r, s.startX, s.startY) }, { key: "end", label: "终", color: "#ff8a94", ...point(s, r, s.endX, s.endY) }];
  if (s.flightPath === "custom") list.push({ key: "control", label: "弯", color: "#83baff", ...point(s, r, s.controlX, s.controlY) });
  return list;
}
export function pathHandle(s, r, q, zoom) {
  return pathHandles(s, r).find((p) => Math.hypot(q.x - p.x, q.y - p.y) * zoom < 11);
}
export function pathPatch(s, r, key, q) {
  const a = -(+s.rotate || 0) * Math.PI / 180, dx = q.x - r.x, dy = q.y - r.y;
  const x = Math.max(0, Math.min(100, ((dx * Math.cos(a) - dy * Math.sin(a)) / r.w + 0.5) * 100));
  const y = Math.max(0, Math.min(100, ((dx * Math.sin(a) + dy * Math.cos(a)) / r.h + 0.5) * 100));
  return { [key + "X"]: Math.round(x * 10) / 10, [key + "Y"]: Math.round(y * 10) / 10 };
}
export function drawRemotePath(g, s, r, ox, oy, zoom) {
  if (!hasFlight(s)) return;
  g.save();
  const screen = (p) => [ox + p.x * zoom, oy + p.y * zoom];
  g.setLineDash([5, 4]); g.lineWidth = 1.25; g.strokeStyle = "rgba(200,225,255,.8)";
  for (let index = 0; index < s.flightCount; index++) {
    g.beginPath();
    for (let i = 0; i <= 64; i++) {
      const p = pathAt(s, r.w, r.h, i / 64, index), q = point(s, r, p[0] / r.w * 100, p[1] / r.h * 100), v = screen(q);
      if (i) g.lineTo(...v); else g.moveTo(...v);
    }
    g.stroke();
  }
  const handles = pathHandles(s, r);
  if (s.flightPath === "custom") {
    g.strokeStyle = "rgba(131,186,255,.45)"; g.beginPath();
    g.moveTo(...screen(handles[0])); g.lineTo(...screen(handles[2])); g.lineTo(...screen(handles[1])); g.stroke();
  }
  g.setLineDash([]);
  for (const p of handles) {
    const [x, y] = screen(p);
    g.fillStyle = "#111722"; g.strokeStyle = p.color; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
    g.font = "11px sans-serif"; g.fillStyle = p.color; g.fillText(p.label, x + 9, y - 8);
  }
  g.restore();
}
