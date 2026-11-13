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
console.log("新建远程特效按现有动画帧数生成、不补帧、切换类型、单帧、长动画、连发、撤销与导出检查通过");

