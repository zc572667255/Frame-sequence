import assert from "node:assert/strict";
import { REMOTE_DEFAULTS, remoteSettings, hasFlight, pathAt, flightState, flightTrail } from "../web/js/vfx/remote.js";
import { migrate } from "../web/js/core/store.js";
import { crescentRuns, crescentEnds, CRESCENT_U0 } from "../web/js/trails/model.js";
import { ribbonSections, materialAt, flameFlow } from "../web/js/vfx/remotetrail.js";
import { flightTrailWindow } from "../web/js/vfx/remote.js";
import { alongPath, iceSwirl, iceLance, iceColors } from "../web/js/vfx/kinds/ice.js";
import { iceBurst } from "../web/js/vfx/kinds/icehit.js";
import { slashRuns, slashFrame, slashFade, slashCopies, slashLines, slashEnds, slashDepth, slashSpan, slashTilt, SLASH_SPAN } from "../web/js/vfx/kinds/slash.js";
import { paletteOf } from "../web/js/vfx/common.js";
import { shapeOf } from "../web/js/vfx/catalog.js";
import { thunderDischarge } from "../web/js/vfx/kinds/thunderhit.js";
import { sandGrains } from "../web/js/vfx/kinds/sand.js";
import { flameCells } from "../web/js/vfx/ribbonmesh.js";
import { fbmNoise, rng } from "../web/js/trails/glow/util.js";
import { arrowSections, headProfile } from "../web/js/vfx/arrowhead.js";
import { FLIGHT_FIELDS, flightFieldVisible } from "../web/js/vfx/remote.js";
import { projectileBounds, projectileShape, PROJECTILES } from "../web/js/vfx/kinds/arrow.js";
import { vfxRegion, vfxRect, vfxSettings } from "../web/js/vfx/layer.js";
import { vfxData } from "../web/js/godot/vfx.js";
import { codeParamsFrom as gdParams } from "../web/js/godot/code.js";
import { remoteProps as gdProps } from "../web/js/godot/remote.js";
import { VFX_KINDS } from "../web/js/vfx/effects.js";

const close = (a, b) => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6, `${a} != ${b}`);
const width = 384, height = 192;
for (const flightPath of ["straight", "arc", "wave", "spiral", "custom"]) {
  for (const flightEase of ["linear", "in", "out", "smooth"]) {
    const s = remoteSettings({ ...REMOTE_DEFAULTS, kind: "fireball", flightPath, flightEase, flightCount: 3 });
    for (let index = 0; index < s.flightCount; index++) {
      close(pathAt(s, width, height, 0, index), [width * s.startX / 100, height * s.startY / 100]);
      close(pathAt(s, width, height, 1, index), [width * s.endX / 100, height * s.endY / 100]);
      const launch = index * s.flightInterval + s.chargeFrames;
      const frame = launch + s.travelFrames * 0.6;
      const state = flightState(s, width, height, frame, index);
      assert.ok(state.launched && state.body && state.hit < 0);
      close(flightTrail(s, width, height, frame, index).at(-1), state.at);
      const points = flightTrail(s, width, height, frame, index);
      for (const kind of ["fireball", "thunder", "ice", "wind", "sand", "arrow", "slash"]) {
        const sections = ribbonSections(points, 12, kind);
        assert.ok(sections.length >= 2);
        assert.equal(sections[0].u, 0);
        assert.equal(sections.at(-1).u, 1);
        close(sections.at(-1).a.map((v, i) => (v + sections.at(-1).b[i]) / 2), state.at);
        assert.ok(sections.every((q, i) => [...q.a, ...q.b, q.u].every(Number.isFinite) && (!i || q.u > sections[i - 1].u)));
        const faded = ribbonSections(points, 12, kind, 0.1).at(-1);
        assert.ok(Math.hypot(faded.a[0] - faded.b[0], faded.a[1] - faded.b[1]) < Math.hypot(sections.at(-1).a[0] - sections.at(-1).b[0], sections.at(-1).a[1] - sections.at(-1).b[1]));
      }
      const hit = flightState(s, width, height, launch + s.travelFrames, index);
      assert.equal(hit.body, false);
      assert.equal(hit.hit, 0);
      assert.equal(flightTrail(s, width, height, launch + s.travelFrames + s.trailFrames + 1, index).length, 0);
      assert.equal(flightState(s, width, height, s.frames, index).finished, true);
    }
    assert.equal(flightTrail({ ...s, trailFrames: 0 }, width, height, 10).length, 0);
  }
}
const extreme = remoteSettings({ ...REMOTE_DEFAULTS, kind: "ice", chargeFrames: 999, travelFrames: 999, impactFrames: 999, flightCount: 999, flightInterval: 999 });
assert.equal(extreme.frames, 64);
assert.equal(extreme.flightInterval, 0);
const coincident = { ...REMOTE_DEFAULTS, kind: "wind", startX: 50, startY: 50, endX: 50, endY: 50 };
assert.ok(pathAt(coincident, width, height, 0.5).every(Number.isFinite));
assert.equal(hasFlight({ kind: "hit", flightPath: "arc" }), false);
const sprite = { kind: "arrow", frames: 8, loop: true };
assert.equal(remoteSettings(sprite), sprite);
const legacy = migrate({ board: { cards: { arrow: { type: "vfx", params: { kind: "arrow", frames: 8, shape: "axe", seed: 19 } } }, edges: { e: { from: { card: "arrow" } } } } });
assert.equal(legacy.board.cards.arrow.type, "remote");
assert.equal(legacy.board.cards.arrow.params.flightPath, "sprite");
assert.equal(legacy.board.cards.arrow.params.frames, 8);
assert.equal(legacy.board.cards.arrow.params.shape, "axe");
assert.equal(legacy.board.edges.e.from.card, "arrow");
assert.deepEqual(ribbonSections([[1, 1], [1, 1], [1, 1]], 12, "fireball"), []);
assert.ok(ribbonSections([[0, 0], [0.009, 0], [0.018, 0], [0.018, 0], [1, 0]], 12, "fireball").every(q => [...q.a, ...q.b].every(Number.isFinite)));
const noise = fbmNoise(27), fine = fbmNoise(57);
const shortHit = remoteSettings({ ...REMOTE_DEFAULTS, kind: "fireball", impactFrames: 2, trailFrames: 24, flightCount: 3 });
for (let shot = 0; shot < 3; shot++) {
  const end = shortHit.chargeFrames + shortHit.travelFrames + shortHit.flightInterval * shot;
  assert.ok(flightTrail(shortHit, width, height, end, shot).length > 0);
  assert.equal(flightTrail(shortHit, width, height, end + shortHit.impactFrames, shot).length, 0, "long wake catches up before a short hit phase ends");
}
for (const kind of ["fireball", "thunder", "wind", "sand"]) {
  let moving = false;
  for (let u = 0; u <= 1; u += 0.1) for (let v = 0; v <= 1; v += 0.1) {
    const sample = materialAt(kind, u, v, 12, noise, fine);
    assert.ok(sample.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
    if (u === 0) assert.equal(sample[1], 0, "tail ends dissolve to transparent");
    assert.deepEqual(sample, materialAt(kind, u, v, 12, noise, fine), "seeking is deterministic");
    moving ||= sample.some((x, i) => x !== materialAt(kind, u, v, 13, noise, fine)[i]);
  }
  assert.ok(moving, kind + " material flows between frames");
}
console.log("远程特效路径、连续截面、流动材质、拖尾消散、命中时序、连发上限与旧数据兼容检查通过");

// Projectiles are drawn from shapes only: the Godot export carries geometry, never pictures.
for (const [shape] of PROJECTILES) for (const spin of ["auto", "on", "off"]) {
  const o = projectileShape(shape, spin, paletteOf("blaze"));
  assert.ok(o.parts.every(q => ["fill", "line", "dot", "tassel"].includes(q.k)), shape + " has only drawn parts");
  assert.ok(!JSON.stringify(o).includes("data:image") && !JSON.stringify(o).includes("png"), shape + " embeds no picture");
  assert.ok([o.L, o.ro, o.outline, ...o.bounds].every(Number.isFinite));
  for (const q of o.parts.filter(q => q.k === "fill")) assert.ok(q.cols.length === 1 || q.cols.length === q.pts.length, "one colour per corner");
  assert.equal(shape === "core", o.parts.length === 0);
}
for (const [old, now] of [["s:arrow3", "arrow"], ["s:pole2", "spear"], ["s:star6", "shuriken"], ["s:bomb2", "ball"], ["custom", "core"], ["s:unknown", "arrow"], ["axe", "axe"]]) assert.equal(shapeOf(old), now);
const oldCard = migrate({ board: { cards: { a: { type: "remote", params: { kind: "arrow", shape: "s:dagger2", coreImg: "data:image/png;base64,AAAA", coreScale: 120 } } } } }).board.cards.a.params;
assert.equal(oldCard.shape, "dagger"); assert.equal(oldCard.coreImg, undefined); assert.equal(oldCard.coreScale, undefined);
console.log("投掷物只用代码形状、不内嵌图片、旧图片外观迁移检查通过");

// The rigid body's complete bounding box must sit inside the default envelope,
// including very long projectiles and rotated flight.
const contains = (point, polygon) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
for (const bounds of [[-45, -3, 90, 6], [-12, -20, 24, 40], [-4, -4, 8, 8]]) for (const angle of [0, 0.8, 2.6]) {
  const at = [100, 100], r = 12, run = arrowSections([], at, angle, r, bounds, REMOTE_DEFAULTS);
  const outline = [...run.map(q => q.a), ...run.toReversed().map(q => q.b)];
  for (const x of [bounds[0], bounds[0] + bounds[2]]) for (const y of [bounds[1], bounds[1] + bounds[3]]) {
    const point = [at[0] + Math.cos(angle) * x - Math.sin(angle) * y, at[1] + Math.sin(angle) * x + Math.cos(angle) * y];
    assert.ok(contains(point, outline), "aura covers the entire projectile, not only its centre");
  }
  assert.equal(run[0].u, 0); assert.equal(run.at(-1).u, 1);
  assert.ok(run.every((q, i) => [...q.a, ...q.b].every(Number.isFinite) && (!i || q.u > run[i - 1].u)));
}
assert.ok(headProfile(0.7, 100) > headProfile(0.7, 0), "curvature changes the cap independently");
const envelope = (headWidth) => arrowSections([], [100, 100], 0, 12, [-20, -3, 40, 6], { ...REMOTE_DEFAULTS, headWidth });
const widthOf = run => Math.max(...run.map(q => Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1])));
assert.ok(widthOf(envelope(200)) > widthOf(envelope(50)) * 3.9, "head width changes the body envelope");
for (const field of FLIGHT_FIELDS.filter(f => f.key === "headWidth" || f.key === "headCurve")) {
  assert.ok(flightFieldVisible(field, { kind: "arrow", flightPath: "sprite" }));
  assert.ok(flightFieldVisible(field, { kind: "arrow", flightPath: "arc" }));
  assert.equal(flightFieldVisible(field, { kind: "fireball", flightPath: "arc" }), false);
}
console.log("箭身完整包裹、旋转与长宽适配、头部弧度和宽度独立控制检查通过");

const frameIds = Array.from({ length: 36 }, (_, i) => 'C' + i);
for (const kind of ["fireball", "thunder", "ice", "wind", "sand", "arrow", "slash"]) {
  const layer = { name: kind, vfx: { ...REMOTE_DEFAULTS, kind, w: 900, h: 600, x: -200, y: -100, follow: "old", perFrame: true, keys: { C0: { w: 10, h: 10, x: 2, y: 2 } } } };
  const s = vfxSettings(layer);
  assert.equal(s.follow, null); assert.equal(s.perFrame, false); assert.equal(s.keys, null);
  for (const [w, h] of [[321, 179], [640, 360], [1, 1]]) for (const fi of [0, 17, 35]) {
    assert.deepEqual(vfxRect(vfxRegion(s, frameIds, fi, { w, h, bbox: () => { throw Error("remote effects must not follow pixel layer bounds"); } })), { x: 0, y: 0, w, h });
    const data = vfxData(layer, frameIds, w, h, 12, {}, kind);
    assert.deepEqual(data.timeline[fi].slice(1), [0, 0, w, h], "export uses the animation canvas, ignoring an old larger effect box");
  }
}
assert.deepEqual(vfxRect(vfxRegion({ kind: "hit", x: 40, y: 30, w: 20, h: 10 }, frameIds, 0, { w: 321, h: 179 })), { x: 30, y: 25, w: 20, h: 10 }, "ordinary effects retain their regions");
console.log("远程特效整幅画布、自适应尺寸、旧区域兼容与导出坐标检查通过");

// A flame feature must advect to older birth times, instead of riding forward
// with the head when the moving UV window is normalised on the next frame.
const samplePhase = (birth, frame, window) => {
  let phase;
  materialAt("fireball", (birth - window.oldest) / (window.newest - window.oldest), 0.5, frame, x => { phase = x; return 0.5; }, () => 0.5, window.oldest, window.newest - window.oldest);
  return phase;
};
const f = { ...REMOTE_DEFAULTS, kind: "fireball" };
const w0 = flightTrailWindow(f, 18), w1 = flightTrailWindow(f, 19);
assert.ok(samplePhase(14, 19, w1) > samplePhase(14, 18, w0), "flame flows backward through stationary emission points");
assert.ok(Math.abs(samplePhase(14, 18, w0) - samplePhase(14, 18, { oldest: 4, newest: 18 })) < 1e-9, "changing trail length cannot stretch the flame noise");
assert.ok(Math.abs(flameFlow(14, 18) - flameFlow(14 - 0.1 / 0.42, 19)) < 1e-9, "a feature travels toward the older tail");
const signedArea = pts => pts.reduce((area, p, i) => { const q = pts[(i + 1) % pts.length]; return area + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg + ": " + a + " != " + b);
for (const seed of [1, 23, 97]) for (const n of [8, 36, 64]) {
  const r = 12, a = iceSwirl(180, r, 0, n, seed), b = iceSwirl(180, r, 1, n, seed), mid = iceSwirl(180, r, 0.37, n, seed);
  assert.deepEqual(mid, iceSwirl(180, r, 0.37, n, seed), "the ribbons can be sought in any order");
  a.ribbons.forEach((rb, j) => rb.forEach((q, k) => { near(q.off, b.ribbons[j][k].off, "ribbons close the loop"); near(q.w, b.ribbons[j][k].w, "ribbons close the loop"); }));
  a.glints.forEach((g, i) => near(g.a, b.glints[i].a, "glints close the loop"));
  for (const rb of mid.ribbons) {
    assert.ok(rb.every(q => [q.d, q.off, q.w, q.a].every(Number.isFinite) && q.a >= 0 && q.w > 0));
    assert.ok(rb[0].a < 1e-9 && rb.at(-1).a < 1e-9, "ribbons fade in ahead of the tip and out at the tail");
    assert.ok(rb[0].d < 0, "ribbons start just ahead of the tip");
  }
  const lance = iceLance(r, seed);
  assert.deepEqual(lance, iceLance(r, seed));
  assert.ok(Math.abs(signedArea(lance.outline)) > r * r, "the lance has a body");
  assert.ok(lance.outline.every(([x, y]) => x <= 2.6 * r + 1e-9 && x >= -5.4 * r - 1e-9 && Math.abs(y) <= 0.4 * r), "the lance is long and thin");
}
for (const id of ["frost", "blaze", "venom", "umbra", "icefire"]) {
  const pal = paletteOf(id), col = iceColors(pal);
  assert.deepEqual(col.ribbonA, pal.rim, "the first ribbon takes the palette's rim colour");
  assert.ok(Math.max(...col.ribbonB) >= 200 && col.ribbonB.every(v => v >= 0 && v <= 255), "the second ribbon glows");
  assert.notDeepEqual(col.ribbonA, col.ribbonB, "the two ribbons differ");
}
assert.notDeepEqual(iceColors(paletteOf("frost")).ribbonB, iceColors(paletteOf("blaze")).ribbonB, "the ribbons follow the palette");
const ahead = alongPath([[0, 0], [10, 0]]);
assert.deepEqual(ahead.at(-5).slice(0, 2), [15, 0], "ahead of the head runs straight on");
assert.deepEqual(ahead.at(14).slice(0, 2), [-4, 0], "behind the oldest point runs straight on");
const bent = alongPath([[0, 0], [10, 0], [10, 10]]);
assert.equal(bent.len, 20);
assert.deepEqual(bent.at(0).slice(0, 2), [10, 10], "the tail is measured back from the head");
assert.deepEqual(bent.at(20).slice(0, 2), [0, 0]);
console.log("火尾后向流动、纹理不随长度拉伸、冰枪光带随配色、循环衔接与路径延伸检查通过");

for (const seed of [1, 23, 97]) for (const amount of [0, 0.9, 2]) {
  const early = iceBurst(32, amount, seed, 0.02), mid = iceBurst(32, amount, seed, 0.3);
  for (const t of [0, 0.12, 0.35, 0.7, 1]) {
    const hit = iceBurst(32, amount, seed, t);
    assert.deepEqual(hit, iceBurst(32, amount, seed, t), "the strike can be sought in any playback order");
    for (const p of [...hit.chips, ...hit.glints, ...hit.haze]) assert.ok(p.at.every(Number.isFinite) && p.alpha >= 0 && p.alpha <= 1);
    for (const cu of hit.curls) assert.ok(cu.pts.flat().every(Number.isFinite) && cu.alpha >= 0 && cu.alpha <= 1);
    if (t === 1) {
      assert.ok([...hit.chips, ...hit.glints, ...hit.haze, ...hit.curls].every(p => p.alpha === 0), "everything fades before the hit ends");
      assert.equal(hit.flash, 0); assert.equal(hit.ring.alpha, 0);
    }
  }
  assert.ok(mid.chips.every((p, j) => Math.hypot(...p.at) > Math.hypot(...early.chips[j].at)), "ice chips fly out from the hit");
  const forward = mid.chips.filter(p => p.at[0] > 0).length;
  assert.ok(forward > mid.chips.length / 2, "most chips carry on the way the lance flew");
}
console.log("冰枪命中的确定性、碎冰飞散与消散时序检查通过");

for (const flightPath of ["straight", "arc", "wave", "spiral", "custom"]) for (const flightEase of ["linear", "in", "out", "smooth"]) {
  const s = remoteSettings({ ...REMOTE_DEFAULTS, kind: "fireball", flightPath, flightEase, pathWave: 40, pathTurns: 4, pathBend: 60, trailFrames: 24 });
  for (const frame of [5, 12, 18, 23, 27]) for (const radius of [12, 80, 320]) {
    const run = ribbonSections(flightTrail(s, 640, 400, frame), radius, "fireball");
    for (const { points, uvs } of flameCells(run)) {
      const centre = [0, 1].map(k => points.reduce((sum, p) => sum + p[k], 0) / 4);
      for (let j = 0; j < 4; j++) assert.ok(signedArea([points[j], points[(j + 1) % 4], centre]) >= -1e-7, "enlarged fire ribbons cannot fold inside a bend");
      assert.ok(uvs.flat().every(x => x >= 0 && x <= 1));
    }
  }
}
console.log("大火球宽拖尾的弯道防翻折、对称网格与纹理坐标检查通过");
// A sand wake must have no bright cut at either side or its oldest endpoint.
for (const seed of [1, 23, 97]) {
  const noise = fbmNoise(seed * 13 + 7), fine = fbmNoise(seed * 29 + 11);
  for (const u of [0, 0.01, 0.3, 0.8, 1]) for (const v of [0, 1]) assert.equal(materialAt("sand", u, v, 17, noise, fine)[1], 0);
  for (const v of [0.2, 0.5, 0.8]) assert.equal(materialAt("sand", 0, v, 17, noise, fine)[1], 0);
  for (const t of [0, 0.08, 0.19, 0.32, 0.9, 1]) {
    const hit = thunderDischarge(40, 1, seed, t);
    assert.deepEqual(hit, thunderDischarge(40, 1, seed, t));
    assert.ok(hit.arcs.every(p => p.points.flat().every(Number.isFinite) && p.alpha >= 0 && p.width > 0));
    assert.ok(hit.sparks.every(p => [...p.at, ...p.back, p.alpha].every(Number.isFinite)));
    if (t === 1) assert.ok([...hit.arcs, ...hit.scars, ...hit.sparks].every(p => p.alpha === 0));
  }
  assert.equal(thunderDischarge(40, 0, seed, 0.2).sparks.length, 0);
  const early = thunderDischarge(40, 1, seed, 0.08), late = thunderDischarge(40, 1, seed, 0.32);
  assert.deepEqual(early.arcs.map(p => p.points), late.arcs.map(p => p.points), "re-strikes retain the discharge channels");
  assert.ok(early.arcs[0].alpha > thunderDischarge(40, 1, seed, 0.07).arcs[0].alpha, "return stroke briefly lights up again");
}
console.log("沙尾边缘渐隐、雷电分阶段放电与轨迹稳定检查通过");
for (const seed of [1, 23, 97]) {
  const first = sandGrains(32, 1, seed, 0), last = sandGrains(32, 1, seed, 1), moving = sandGrains(32, 1, seed, 0.01);
  assert.deepEqual(first, sandGrains(32, 1, seed, 0), "sand body is deterministic when seeking");
  first.forEach((p, i) => {
    close(p.at, last[i].at); close(p.back, last[i].back);
    assert.ok(Math.abs(p.alpha - last[i].alpha) < 1e-9, "sand grain recycling closes the loop");
    assert.ok([...p.at, ...p.back, p.width, p.alpha, p.heat].every(Number.isFinite));
    assert.ok(p.alpha >= 0 && p.alpha <= 1 && p.width > 0);
    if (moving[i].at[0] > p.at[0]) assert.ok(moving[i].alpha < 0.4, "recycled sand fades in at the tip");
  });
  assert.ok(first.some((p,i) => Math.hypot(p.at[0]-moving[i].at[0],p.at[1]-moving[i].at[1]) > 1), "sand body streams independently of path history");
}
console.log("流沙主体的独立流动、粒子重生渐隐与循环衔接检查通过");

for (const width of [0.5, 1, 2.5]) {
  const body = 40, run = ribbonSections([[0, 0], [120, 0], [240, 0]], body * width, "fireball", 1, body);
  assert.ok(Math.hypot(run.at(-1).a[0] - run.at(-1).b[0], run.at(-1).a[1] - run.at(-1).b[1]) <= body * 1.7 + 1e-9, "wide flame joins remain inside the body's height");
}

// 剑气 (2D): a crescent whose bulge leads and tips trail, two-tipped or half,
// laid down from upright towards parallel to the ground, either way
const slashWidth = q => Math.hypot(q.a[0] - q.b[0], q.a[1] - q.b[1]);
for (const ground of [0, 30, 60, 90]) for (const travel of [0, Math.PI, 0.3]) for (const shape of ["full", "half"]) {
  const runs = slashRuns([100, 100], travel, 40, 20, ground, shape), { x: X, y: Y } = slashFrame(travel);
  assert.equal(runs.length, 1, "one run, never pieced together");
  const run = runs[0], n = run.length;
  assert.equal(n, shape === "half" ? 17 : 33);
  assert.ok(run.every((q, i) => [...q.a, ...q.b, q.u].every(Number.isFinite) && (!i || q.u > run[i - 1].u)), "u runs on along it");
  const along = p => (p[0] - 100) * X[0] + (p[1] - 100) * X[1], across = p => (p[0] - 100) * Y[0] + (p[1] - 100) * Y[1];
  const top = run[0].b, mid = shape === "half" ? run.at(-1) : run[16];
  assert.ok(slashWidth(run[0]) < 1.5 && slashWidth(mid) > 15, "pointed at its upper tip, thick in the middle");
  assert.ok(across(top) < 0, "it starts at the upper tip");
  assert.ok(along(mid.b) > along(top) + 5, "its bulge leads, its tips trail");
  assert.ok(Math.abs(across(mid.a)) < 1e-9 && Math.abs(across(mid.b)) < 1e-9, "the middle (半头's flat cut) lies on the flight line");
  if (shape === "full") {
    const bottom = run.at(-1).b, height = across(bottom) - across(top);
    assert.ok(slashWidth(run.at(-1)) < 1.5, "two-tipped: pointed at its lower tip too");
    assert.ok(run[0].u >= 0.3, "neither end fades into the trail's tail");
    if (ground === 90) for (let i = 1; i < 16; i++) assert.ok(slashWidth(run[i]) < slashWidth(run[i + 1]) + 1e-9 && Math.abs(slashWidth(run[i]) - slashWidth(run[32 - i])) < 1e-6, "it thickens smoothly to the middle and thins the same way");
    if (ground === 90) {
      // the hollow is hollow: the inner edge bows the same way as the outer, its middle ahead of the tips
      const inner = run.map(q => along(q.a));
      for (let i = 1; i <= 16; i++) assert.ok(inner[i] >= inner[i - 1] - 1e-9 && inner[32 - i] >= inner[33 - i] - 1e-9, "the inner edge curves smoothly out to its middle and back");
      assert.ok(inner[16] > along(top) + 1, "the inner edge's middle lies ahead of the tips: no bulge into the hollow");
      for (let i = 2; i < 31; i++) assert.ok(inner[i - 1] + inner[i + 1] - 2 * inner[i] <= 1e-6, "the inner edge never bulges back into the hollow");
    }
    if (ground === 90) { assert.ok(Math.abs(height - 80) < 1e-6, "upright: the whole crescent, as tall as its chord"); assert.ok(Math.abs(along(bottom) - along(top)) < 1e-6, "upright: both tips level"); }
    if (ground === 0) { assert.ok(Math.abs(height - 24) < 1e-6, "parallel to the ground: flattened, seen from the side"); assert.ok(Math.abs(along(bottom) - along(top)) < 1e-6, "lying down, both tips still level along the flight"); }
  }
}
// turned all the way round its line of flight, 0 … 360, smoothly: no jump
// from one degree to the next, 360 the same as 0, upside down at 270
for (const shape of ["full", "half"]) for (const travel of [0, Math.PI]) {
  const { x: X, y: Y } = slashFrame(travel);
  const along = p => (p[0] - 100) * X[0] + (p[1] - 100) * X[1], across = p => (p[0] - 100) * Y[0] + (p[1] - 100) * Y[1];
  const at = (g) => slashRuns([100, 100], travel, 40, 20, g, shape)[0];
  let prev = at(0);
  for (let g = 1; g <= 360; g++) {
    const run = at(g);
    assert.ok(run.every(q => [...q.a, ...q.b].every(Number.isFinite)), g + "°: drawn");
    const jump = Math.max(...run.map((q, i) => Math.hypot(q.b[0] - prev[i].b[0], q.b[1] - prev[i].b[1])));
    assert.ok(jump < 1.5, g + "°: turns on smoothly from " + (g - 1) + "° (moved " + jump.toFixed(2) + " px)");
    prev = run;
  }
  const same = (r, o) => r.every((q, i) => Math.hypot(q.b[0] - o[i].b[0], q.b[1] - o[i].b[1]) < 1e-6);
  assert.ok(same(at(360), at(0)) && same(at(450), at(90)), "360° is 0° again");
  const up = at(90), down = at(270);
  if (shape === "half") assert.ok(across(up[0].b) < -30 && across(down[0].b) > 30, "半头 upside down at 270°: below the flight line");
  else {
    assert.ok(Math.abs(across(down[0].b) - 40) < 1e-6 && Math.abs(across(down.at(-1).b) + 40) < 1e-6, "upside down at 270°, as tall as upright");
    const tips = (r) => { const [a, b] = [r[0].b, r.at(-1).b]; return across(a) < across(b) ? [a, b] : [b, a]; }; // [upper, lower] on screen
    // turned round the flight line (start → end): every point keeps its place along the flight
    for (const g of [0, 30, 135, 163, 250, 300]) assert.ok(at(g).every((q, i) => Math.abs(along(q.b) - along(up[i].b)) < 1e-6 && Math.abs(along(q.a) - along(up[i].a)) < 1e-6), g + "°: turned round the flight line, nothing slides along it");
    void tips;
    assert.ok(same(at(200), [...at(20)].reverse()), "two-tipped, half a turn on looks the same (its tips swapped)");
  }
  const edge = at(163.3);
  assert.ok(Math.max(...edge.map(q => Math.abs(across(q.b)))) < 2, "edge on near 163°: a thin streak");
}
// 月牙弧度: how far round its arc it reaches. The tips stay as far apart;
// more is deeper (past 180° it bows out wider and the tips curl in), and however
// curved the hollow stays hollow and both ends still fade
{
  assert.equal(slashSpan({}), SLASH_SPAN, "170° by default: the crescent as before");
  assert.equal(slashSpan({ slashCurve: 10 }), 60 * Math.PI / 180);
  assert.equal(slashSpan({ slashCurve: 999 }), 240 * Math.PI / 180);
  assert.deepEqual(slashRuns([100, 100], 0, 40, 20, 90, "full"), slashRuns([100, 100], 0, 40, 20, 90, "full", slashSpan({ slashCurve: 170 })));
  let lastDepth = 0;
  for (const curve of [60, 100, 140, 170, 200, 240]) {
    const span = slashSpan({ slashCurve: curve }), depth = slashDepth(40, span);
    const run = slashRuns([0, 0], 0, 40, depth * 0.6, 90, "full", span)[0], mid = run[16], top = run[0].b, bottom = run.at(-1).b;
    assert.ok(run.every(q => [...q.a, ...q.b].every(Number.isFinite)), curve + "°: drawn");
    assert.ok(Math.abs(bottom[1] - top[1] - 80) < 1e-6, curve + "°: its tips as far apart as ever");
    assert.ok(Math.abs(mid.b[0] - top[0] - depth) < 1e-6, curve + "°: as deep as slashDepth");
    assert.ok(depth > lastDepth, curve + "°: deeper the more it curves");
    lastDepth = depth;
    const wide = Math.max(...run.map(q => Math.abs(q.b[1])));
    assert.ok(curve > 180 ? wide > 40.3 : wide < 40 + 1e-6, curve + "°: " + (curve > 180 ? "past half a circle it bows out wider than its tips, which curl in" : "no wider than its tips"));
    assert.ok(mid.a[0] > top[0], curve + "°: the inner edge's middle ahead of the tips, hollow");
    assert.ok(slashWidth(run[0]) < 1.5 && slashWidth(run.at(-1)) < 1.5, curve + "°: pointed at both tips");
    const ends = slashEnds([0, 0], 0, 40, 90, "full", span), m = q => [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2];
    assert.ok(ends(m(mid)) > 0.99 && ends(m(run[1])) < 0.2 && ends(m(run[31])) < 0.2, curve + "°: whole in the middle, both ends fading");
    assert.ok(slashLines([0, 0], 0, 40, depth * 0.6, 90, "full", 0.35, 7, 3, 1, span).every(l => l.pts.every(q => q.p.every(Number.isFinite))), curve + "°: the strands follow it");
  }
  assert.ok(FLIGHT_FIELDS.some(f => f.key === "slashCurve" && f.min === 60 && f.max === 240 && flightFieldVisible(f, { kind: "slash", flightPath: "straight" })), "月牙弧度 is offered for 剑气");
  assert.equal(VFX_KINDS.find(k => k.id === "slash").defaults.slashCurve, 170);
}
// 左右倾斜: leaned over round its middle while it stands upright (地面夹角
// 90°), its top towards the way it flies (> 0) or back (< 0), whichever way it
// flies — and only then laid down by the ground angle
{
  const span = SLASH_SPAN, d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  for (const ground of [90, 30, 0, 200]) for (const shape of ["full", "half"]) {
    assert.deepEqual(slashRuns([100, 100], 0, 40, 20, ground, shape, span, 0), slashRuns([100, 100], 0, 40, 20, ground, shape), "0°: as before");
    for (const travel of [0, Math.PI]) {
      const { x: X, y: Y } = slashFrame(travel), fwd = Math.cos(travel), { squash } = slashTilt(ground);
      const along = p => (p[0] - 100) * X[0] + (p[1] - 100) * X[1], across = p => (p[0] - 100) * Y[0] + (p[1] - 100) * Y[1];
      const upright0 = slashRuns([100, 100], travel, 40, 20, 90, shape, span, 0)[0];
      for (const lean of [-90, -40, 25, 90]) {
        const run = slashRuns([100, 100], travel, 40, 20, ground, shape, span, lean)[0], upright = slashRuns([100, 100], travel, 40, 20, 90, shape, span, lean)[0];
        // upright, the lean is a plain turn round its middle
        assert.ok(upright.every((q, i) => Math.abs(d(q.b, [100, 100]) - d(upright0[i].b, [100, 100])) < 1e-6 && Math.abs(d(q.a, q.b) - d(upright0[i].a, upright0[i].b)) < 1e-6), lean + "°: upright, the same crescent turned round its middle");
        assert.ok(Math.sign((upright[0].b[0] - upright0[0].b[0]) * fwd) === Math.sign(lean), lean + "° flying " + (fwd > 0 ? "right" : "left") + ": its top leans " + (lean > 0 ? "forward" : "back"));
        // then turned round the flight line: the leaned upright crescent, only its distance off the line scaled
        for (const [i, q] of run.entries()) for (const k of ["a", "b"]) {
          const a = along(upright[i][k]), c = across(upright[i][k]);
          assert.ok(Math.abs(along(q[k]) - a) < 1e-6 && Math.abs(across(q[k]) - c * squash) < 1e-6, lean + "° at " + ground + "°: leaned first, then turned round the flight line");
        }
        const ends = slashEnds([100, 100], travel, 40, ground, shape, span, lean), m = q => [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2];
        assert.ok(ends(m(run[16])) > 0.99 && ends(m(run[1])) < 0.2, lean + "° at " + ground + "°: its ends still fade where they are");
        assert.ok(slashLines([100, 100], travel, 40, 20, ground, shape, 0.35, 7, 3, 1, span, lean).every(l => l.pts.every(q => q.p.every(Number.isFinite))));
      }
    }
  }
  assert.ok(FLIGHT_FIELDS.some(f => f.key === "slashStrands" && f.min === 0 && f.max === 100 && flightFieldVisible(f, { kind: "slash", flightPath: "straight" })), "剑气光丝 is offered for 剑气");
  assert.equal(VFX_KINDS.find(k => k.id === "slash").defaults.slashStrands, 25);
  assert.ok(gdProps(gdParams({ ...VFX_KINDS.find(k => k.id === "slash").defaults, kind: "slash", slashStrands: 70 }, 64, 64, 12).remote).includes("slash_strands = 70"), "Godot gets 剑气光丝");
  assert.ok(FLIGHT_FIELDS.some(f => f.key === "slashLean" && f.min === -90 && f.max === 90 && flightFieldVisible(f, { kind: "slash", flightPath: "straight" })), "左右倾斜 is offered for 剑气");
  assert.equal(VFX_KINDS.find(k => k.id === "slash").defaults.slashLean, 0);
}
for (const travel of [0, Math.PI, 0.3, -0.4]) assert.ok(slashFrame(travel).y[1] > 0, "up stays up whichever way it flies");
for (const k of [0.1, 0.6, 0.9, 1.5]) {
  const run = slashRuns([0, 0], 0, 40, slashDepth(40) * k, 90, "full")[0];
  assert.ok(run[16].a[0] > run[0].b[0], "however thick, the hollow never fills or bulges");
}
// 光丝 curve along the arc towards the tips, ending inside the crescent before them, never straight
for (const shape of ["full", "half"]) for (const ground of [90, 40, 0]) {
  const lines = slashLines([100, 100], 0, 40, 20, ground, shape, 0.35, 7, 3, 1);
  assert.equal(lines.length, Math.round(0.35 * 22));
  for (const { pts, width: lw } of lines) {
    assert.equal(pts.length, 17); assert.ok(lw > 0 && pts.every(q => q.p.every(Number.isFinite) && q.a >= 0 && q.a <= 1));
    assert.ok(pts.at(-1).a < 1e-9, "each fades out at its far end");
    const [p0, p1, p2] = [pts[0].p, pts[8].p, pts[16].p], bend = Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]));
    assert.ok(bend > 1, "it curves, it is not a straight line");
    assert.ok(p2[0] < p0[0], "it runs from the middle back towards a tip");
    if (ground === 90) assert.ok(Math.abs(p2[1] - 100) < 40 * 0.97, "it ends before the tip, never sticking out of the crescent");
    if (shape === "half") assert.ok(p2[1] < 100, "半头: only the upper half has strands");
  }
}
assert.equal(slashLines([0, 0], 0, 40, 20, 90, "full", 0, 7, 3, 1).length, 0, "palettes without speed lines get none");
// the ends weaken and fade out, they do not only thin
for (const ground of [90, 40, 0]) for (const travel of [0, Math.PI]) {
  const run = slashRuns([100, 100], travel, 40, 20, ground, "full")[0], ends = slashEnds([100, 100], travel, 40, ground, "full");
  const mid = q => [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2];
  assert.ok(ends(mid(run[16])) > 0.999, "full strength in the middle");
  assert.ok(ends(mid(run[0])) < 0.02 && ends(mid(run[32])) < 0.02, "both tips fade right out");
  for (let i = 1; i <= 16; i++) assert.ok(ends(mid(run[i])) >= ends(mid(run[i - 1])) - 1e-6 && ends(mid(run[32 - i])) >= ends(mid(run[33 - i])) - 1e-6, "weakening steadily towards each tip");
  assert.ok(Math.abs(ends(mid(run[4])) - ends(mid(run[28]))) < 0.05 || ground !== 90, "the same at both ends when upright");
  const halfEnds = slashEnds([100, 100], travel, 40, ground, "half"), hrun = slashRuns([100, 100], travel, 40, 20, ground, "half")[0];
  assert.ok(halfEnds(mid(hrun[0])) < 0.02 && halfEnds(mid(hrun.at(-1))) > 0.999, "半头 fades at its tip, not at its flat cut");
}
assert.equal(slashFade(0), 1); assert.equal(slashFade(1), 0);
{
  const s = remoteSettings({ ...REMOTE_DEFAULTS, kind: "slash", flightPath: "straight", startX: 12, startY: 55, endX: 88, endY: 55 });
  const at = (frame) => slashCopies(s, 256, 200, flightState(s, 256, 200, frame, 0), 0, 12);
  const early = at(s.chargeFrames + 2), arrive = at(s.chargeFrames + s.travelFrames - 0.01);
  assert.ok(early.at(-1).at[0] < arrive.at(-1).at[0], "it flies from left to right");
  assert.equal(early.at(-1).alpha, 1, "whole while it flies"); assert.equal(arrive.at(-1).alpha, 1, "still whole as it arrives");
  const end = pathAt(s, 256, 200, 1, 0);
  assert.ok(Math.hypot(arrive.at(-1).at[0] - end[0], arrive.at(-1).at[1] - end[1]) < 1, "it gets all the way to the end point");
  let last = 1;
  for (let f = 0; f < s.impactFrames; f += 0.5) {
    const c = at(s.chargeFrames + s.travelFrames + f);
    assert.equal(c.length, 1, "after arriving only the crescent itself is left, no after-image");
    assert.ok(c[0].alpha <= last + 1e-9 && c[0].at[0] >= end[0] - 1e-9, "then it fades out at the end point, drifting on a little");
    last = c[0].alpha;
  }
  assert.ok(last < 0.2, "almost gone by the last frame");
  assert.deepEqual(at(s.frames + 1), [], "gone once its frames are over");
  assert.equal(s.frames, s.chargeFrames + s.travelFrames + s.impactFrames, "the animation is charge + flight + fade");
  assert.ok(FLIGHT_FIELDS.some(f => f.key === "slashAngle" && f.min === 0 && f.max === 360 && flightFieldVisible(f, { kind: "slash", flightPath: "sprite" })), "the ground angle is always offered for 剑气");
  assert.ok(FLIGHT_FIELDS.some(f => f.key === "slashThick" && flightFieldVisible(f, { kind: "slash", flightPath: "sprite" })), "剑气 has its own thickness");
  assert.ok(!FLIGHT_FIELDS.some(f => f.key === "trailWidth" && flightFieldVisible(f, { kind: "slash", flightPath: "straight" })), "the trail width is not offered for 剑气");
  assert.ok(FLIGHT_FIELDS.some(f => f.key === "slashShape" && f.options.map(o => o[0]).join() === "full,half" && flightFieldVisible(f, { kind: "slash", flightPath: "arc" })), "两头尖 / 半头 is offered for 剑气");
  assert.ok(!FLIGHT_FIELDS.some(f => f.key === "slashAngle" && flightFieldVisible(f, { kind: "fireball", flightPath: "arc" })));
  const k = VFX_KINDS.find(x => x.id === "slash");
  assert.ok(k.defaults.startX < k.defaults.endX && k.defaults.startY === k.defaults.endY && k.defaults.slashAngle === 90, "剑气 flies left to right, upright, by default");
}
console.log("剑气两头尖 / 半头、鼓面朝前、0°~360° 连续旋转的地面夹角、-90°~90° 左右倾斜、60°~240° 月牙弧度、横向飞行与消失检查通过");

// 攻击拖尾 两头尖: drawn once, whole (no end is the trail's own tail), both ends faded
{
  const run = Array.from({ length: 11 }, (_, i) => ({ a: [i, 0], b: [i, 4], u: i / 10 }));
  const [r] = crescentRuns([run]);
  assert.equal(r.length, run.length); assert.equal(r[0].u, CRESCENT_U0); assert.equal(r.at(-1).u, 1);
  assert.ok(r.every((q, i) => q.a === run[i].a && (!i || q.u > r[i - 1].u)), "one pass, its order kept");
  for (const ends of [0.1, 0.225, 0.5]) {
    assert.equal(crescentEnds(0, ends), 0); assert.equal(crescentEnds(1, ends), 0); assert.equal(crescentEnds(0.5, ends), 1);
    for (const u of [0.05, 0.15, 0.3]) assert.ok(Math.abs(crescentEnds(u, ends) - crescentEnds(1 - u, ends)) < 1e-12, "both ends fade alike");
  }
}
console.log("攻击拖尾两头尖整段画出、两头对称淡出检查通过");

// 特效大小 (remoteSize): at 100% the body's box just touches the canvas's
// width or height, whichever it reaches first, keeping its proportions —
// on wide, tall and square canvases alike; old layers keep their old size
{
  const { remoteRadius, remoteSizeOf, remoteBox, remoteFullRadius } = await import("../web/js/vfx/remotesize.js");
  const { codeParamsFrom } = await import("../web/js/godot/code.js");
  const { remoteProps } = await import("../web/js/godot/remote.js");
  const looks = [["fireball"], ["thunder"], ["ice"], ["wind"], ["sand"], ["slash"], ["slash", { slashShape: "half", slashAngle: 30, slashLean: 40, slashCurve: 230 }], ...["arrow", "spear", "ball", "core"].map(shape => ["arrow", { shape }])];
  for (const [kind, extra] of looks) {
    const s = { ...VFX_KINDS.find(k => k.id === kind).defaults, kind, ...extra };
    assert.ok(s.remoteSize > 0 && s.remoteSize <= 100, kind + ": new effects have a 特效大小");
    const [ex, ey] = remoteBox(s);
    assert.ok(ex > 0 && ey > 0, kind + ": a box");
    for (const [w, h] of [[640, 160], [160, 640], [300, 300], [64, 32]]) {
      const r = remoteRadius({ ...s, remoteSize: 100 }, w, h), gapX = w / 2 - ex * r, gapY = h / 2 - ey * r;
      assert.ok(gapX > -1e-6 && gapY > -1e-6, kind + " " + w + "×" + h + ": 100% never past the canvas");
      assert.ok(Math.min(gapX, gapY) < 1e-6, kind + " " + w + "×" + h + ": 100% touches its width or height");
      assert.ok(Math.abs(remoteRadius({ ...s, remoteSize: 40 }, w, h) - r * 0.4) < 1e-9, "40% is 0.4 of that");
      // an old layer: the size it had, and the 特效大小 that gives it
      const old = { ...s, remoteSize: undefined, bodySize: 9, size: 80 }, was = Math.min(w, h) * 0.09 * 80 / 90;
      assert.ok(Math.abs(remoteRadius(old, w, h) - was) < 1e-9, kind + ": an old layer keeps its size");
      assert.ok(Math.abs(remoteRadius({ ...s, remoteSize: remoteSizeOf(old, w, h) }, w, h) - was) < 1e-6, kind + ": shown as the 特效大小 that gives it");
      // Godot gets the same
      const code = codeParamsFrom(old, w, h, 12), props = remoteProps(code.remote).join("\n");
      assert.ok(Math.abs(code.remote.remoteSize / 100 * remoteFullRadius(old, w, h) - was) < 1e-3, kind + ": Godot draws it as big");
      assert.ok(props.includes("remote_size = ") && props.includes("body_box = Vector2(") && !props.includes("body_size"));
    }
  }
  // wider than tall: a wide canvas lets a long body (冰矛) grow by its width
  const ice = { ...VFX_KINDS.find(k => k.id === "ice").defaults, kind: "ice", remoteSize: 100 };
  assert.ok(remoteRadius(ice, 640, 160) > remoteRadius(ice, 160, 160) * 1.5, "a wide canvas holds a long body bigger");
  assert.ok(!FLIGHT_FIELDS.some(f => f.key === "bodySize"), "弹体大小 is folded into 特效大小");
  console.log("远程特效大小按画布宽高：100% 刚好碰到宽或高、保持比例不出框、旧图层大小不变、Godot 一致检查通过");
}
