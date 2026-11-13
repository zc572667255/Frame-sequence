import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { remoteSettings, fitRemoteFrames, flightState, flightTrail } from "../web/js/vfx/remote.js";
import { vfxSettings } from "../web/js/vfx/layer.js";
import { vfxData } from "../web/js/godot/vfx.js";
import { VFX_KINDS } from "../web/js/vfx/effects.js";
import { EditorDoc } from "../web/js/editor/doc.js";
import { VfxPanel } from "../web/js/editor/vfxpanel.js";
import { codeParamsFrom } from "../web/js/godot/code.js";
import { remoteProps } from "../web/js/godot/remote.js";

assert.equal(VFX_KINDS.find(k => k.id === "fireball").defaults.frames, 36, "standalone defaults remain unchanged");
const legacySprite = { kind: "arrow", frames: 8, loop: true };
assert.equal(remoteSettings(legacySprite), legacySprite, "old sprite timelines remain unchanged");

// Load the actual editor class without constructing its DOM UI.
const editorUrl = new URL("../web/js/editor/editor.js", import.meta.url);
const editorSource = readFileSync(editorUrl, "utf8").replace(/from "(\.[^"]+)"/g, (_, spec) => `from "${new URL(spec, editorUrl).href}"`);
const { Editor } = await import("data:text/javascript;base64," + Buffer.from(editorSource + "\nexport { Editor };\n").toString("base64"));
for (const count of [1, 2, 3, 8, 12, 36, 64, 80, 120]) for (const fi of new Set([0, Math.floor(count / 2), count - 1])) {
  for (const kind of ["fireball", "thunder", "ice", "wind", "sand", "arrow", "slash"]) {
    const frames = Array.from({ length: count }, (_, i) => ({ id: "F" + i, duration: i % 2 ? 75 : null }));
    const doc = new EditorDoc({ w: 64, h: 32, fps: 12, frames, layers: [{ id: "L1", name: "角色" }], cels: new Map(), palette: [] });
    const originalFrames = structuredClone(frames);
    doc.addFrame = () => { throw Error("creating remote effects must not add frames"); };
    const ed = Object.assign(Object.create(Editor.prototype), {
      doc, fi, li: 0, tool: "remote", remoteTool: { kind, style: "hd" },
      tm: { active: false }, app: { toast() {} }, syncToolUI() {}, goLayer() {},
      change(fn) { doc.checkpoint(); fn(); },
    });
    ed.newVfx("remote");
    let layer = doc.layers[ed.li], s = vfxSettings(layer);
    assert.deepEqual(doc.frames, originalFrames, "creation preserves frame IDs, durations and count");
    assert.equal(s.frames, count - fi, "a complete launch fits from the current frame to the animation end");
    assert.equal(s.start, frames[fi].id);
    assert.deepEqual(remoteSettings(JSON.parse(JSON.stringify(s))), s, "saved phases survive normalisation");
    const ids = frames.map(f => f.id), data = vfxData(layer, ids, 64, 32, 12, {});
    assert.equal(data.effect.frames, count - fi);
    assert.equal(data.timeline.at(-1)[0], count - fi - 1);
    if (fi) assert.equal(data.timeline[fi - 1], null);
    const code = codeParamsFrom(s, 64, 32, 12);
    assert.equal(code.frames, count - fi);
    assert.ok(remoteProps(code.remote).includes("flight_frame_budget = " + (count - fi)));
    for (const frame of [0, (s.frames - 1) / 2, s.frames - 1, s.frames]) {
      const state = flightState(s, 64, 32, frame);
      assert.ok([...state.at, state.u, state.hit, state.charge, state.angle].every(Number.isFinite));
      assert.ok(flightTrail(s, 64, 32, frame).flat().every(Number.isFinite));
    }
    assert.equal(flightState(s, 64, 32, s.frames).finished, true);
    assert.equal(flightTrail(s, 64, 32, s.frames).length, 0);
    // Changing the material must not restore the standalone 36-frame default.
    VfxPanel.prototype.pickKind.call({ ed, doc, layer: () => layer, remember() {} }, VFX_KINDS.find(k => k.id === "ice"));
    assert.equal(vfxSettings(layer).frames, count - fi);
    assert.deepEqual(doc.frames, originalFrames);
    for (const flightCount of [1, 3, 5]) {
      const burst = fitRemoteFrames({ ...s, flightCount, flightInterval: 6 }, count - fi);
      assert.equal(remoteSettings(burst).frames, count - fi);
      assert.equal(flightState(burst, 64, 32, burst.frames, flightCount - 1).finished, true);
    }
    const changed = remoteSettings({ ...s, chargeFrames: count, travelFrames: count, impactFrames: count, flightCount: 5 });
    assert.ok(changed.frames <= count - fi, "phase edits stay within the existing frame budget");
    const restored = remoteSettings(JSON.parse(JSON.stringify(changed)));
    assert.deepEqual(restored, changed);
    doc.undo();
    doc.undo();
    assert.equal(doc.layers.length, 1);
    assert.deepEqual(doc.frames, originalFrames, "undo preserves the original animation frames");
  }
}
// A flight shown on fewer frames than it has (持续 shortened, its start moved
// later, frames deleted) still plays whole there: it reaches the end point and
// finishes on its last shown frame instead of being cut off on its way.
{
  const ids = Array.from({ length: 40 }, (_, i) => "F" + i);
  const slash = { ...VFX_KINDS.find(k => k.id === "slash").defaults, kind: "slash", start: "F17" };
  const reaches = (s, shown, what) => {
    assert.ok(s.frames <= shown, what + ": fits in " + shown + " frames, not " + s.frames);
    const arrive = s.chargeFrames + s.travelFrames;
    assert.ok(arrive < shown, what + ": arrives at the end point within its frames");
    assert.equal(flightState(s, 64, 32, arrive).u, 1, what + ": at the end point");
    assert.equal(flightState(s, 64, 32, shown).finished, true, what + ": gone after its last frame");
  };
  for (const length of [8, 5, 3]) {
    // an old layer fitted to the whole rest of the animation, then 持续 = length
    const layer = { vfx: { ...fitRemoteFrames(slash, 23), length } };
    assert.equal(layer.vfx.frames, 23);
    reaches(vfxSettings(layer, ids), length, "持续 " + length);
    const data = vfxData(layer, ids, 64, 32, 12, {});
    assert.equal(data.timeline.filter(Boolean).length, length);
    assert.equal(data.effect.frames, length);
  }
  // no 持续, but only 8 frames left after its start
  reaches(vfxSettings({ vfx: { ...fitRemoteFrames(slash, 23), start: "F32" } }, ids), 8, "start moved late");
  // the panel's 持续 slider fits the stored timing, and dragging back restores it
  const doc = { frames: ids.map(id => ({ id })), checkpoint() {} };
  const layer = { vfx: fitRemoteFrames(slash, 23) };
  const panel = Object.assign(Object.create(VfxPanel.prototype), { live: false, layer: () => layer,
    ed: { doc, commitFloat() {}, markDirty() {}, requestRender() {}, afterChange() {} } });
  panel.liveEdit({ length: 8 });
  reaches(remoteSettings(layer.vfx), 8, "持续 slider");
  panel.liveEdit({ length: 3 });
  panel.liveEdit({ length: 0 });
  assert.equal(layer.vfx.frames, 23, "dragging 持续 back gives the whole timing again");
  panel.endLive();
  // 命中消散 set by hand, then 持续 changed again and again in separate drags:
  // every stage scales by the same proportions, without drifting
  const stages = (v) => [v.chargeFrames, v.travelFrames, v.impactFrames];
  panel.edit({ impactFrames: 8 });
  const set = stages(layer.vfx);
  assert.deepEqual(layer.vfx.stages, set, "a stage set by hand sets the proportions");
  const seen = [];
  panel.liveSync = [(v) => seen.push(v.impactFrames)];
  const tally = {};
  for (const length of [8, 16, 4, 30, 8, 12, 0, 8, 16, 0]) {
    panel.liveEdit({ length });
    panel.endLive();
    const v = remoteSettings(layer.vfx), shown = Math.min(length || 23, 23);
    assert.equal(v.frames, shown, "持续 " + length + ": the whole launch fills it");
    const expect = Math.round(shown * set[2] / (set[0] + set[1] + set[2]));
    assert.ok(Math.abs(v.impactFrames - expect) <= 1, "持续 " + length + ": 命中消散 " + v.impactFrames + " ≈ " + expect);
    if (length in tally) assert.deepEqual(stages(v), tally[length], "持续 " + length + " again: the same stages");
    tally[length] = stages(v);
    reaches(v, shown, "持续 " + length + " after 命中消散 set");
  }
  assert.deepEqual(stages(layer.vfx), set, "back to 自动: the stages as set");
  assert.equal(seen.length, 10, "the stage sliders follow 持续 while it is dragged");
  assert.ok(seen.at(-2) < seen.at(-1), "命中消散 grows with 持续");
}
console.log("新建远程特效按现有动画帧数生成、不补帧、切换类型、单帧、长动画、连发、撤销与导出检查通过");

