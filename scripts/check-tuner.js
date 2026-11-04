// Browser regression checks, using an installed Chromium without npm dependencies.
// Run with Node 22+; set CHROME_PATH if Chrome is not in its usual Windows location.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profile = await mkdtemp(path.join(tmpdir(), "guangtai-tuner-"));
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><link rel="stylesheet" href="/css/app.css"><link rel="stylesheet" href="/css/editor.css"><body><div id="board" tabindex="0"></div>');
      return;
    }
    const file = path.resolve(root, "web", "." + new URL(req.url, "http://localhost").pathname);
    if (!file.startsWith(path.join(root, "web") + path.sep)) throw new Error("Invalid path");
    res.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : "text/css");
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const chrome = spawn(process.env.CHROME_PATH || path.join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"), [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
  "--remote-debugging-port=0", "--window-size=1400,1000", "--user-data-dir=" + profile, "about:blank",
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    let stderr = "";
    const timeout = setTimeout(() => reject(new Error("Chrome startup timeout")), 15000);
    chrome.on("error", (err) => { clearTimeout(timeout); reject(err); });
    chrome.stderr.on("data", (chunk) => {
      stderr += chunk;
      const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const msg = JSON.parse(event.data), task = pending.get(msg.id);
    if (msg.method === "Runtime.consoleAPICalled") console.log(...msg.params.args.map((a) => a.value || a.description));
    if (task) { pending.delete(msg.id); clearTimeout(task.timeout); msg.error ? task.reject(new Error(JSON.stringify(msg.error))) : task.resolve(msg.result); }
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(method + " timed out")); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.bringToFront", {}, sessionId);
  await call("Runtime.enable", {}, sessionId);
  await call("Page.enable", {}, sessionId);
  await call("Page.navigate", { url: "http://127.0.0.1:" + server.address().port + "/" }, sessionId);
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception.description);
    return result.result.value;
  };
  await evaluate(`(async () => {
    const { Store, migrate } = await import('/js/core/store.js');
    const { Engine } = await import('/js/nodes/engine.js');
    const { Board } = await import('/js/board/board.js');
    const { defineNode, nodeType } = await import('/js/nodes/registry.js');
    const { createCanvas } = await import('/js/core/util.js');
    const model = await import('/js/tuner/model.js');
    const { openTuner, frameSourceCards } = await import('/js/tuner/tuner.js');
    await import('/js/nodes/types/character.js');
    await import('/js/nodes/types/export.js');
    const { exportSheet, exportGif, exportWebp, exportPngZip } = await import('/js/nodes/exporters.js');
    window.ok = (condition, message) => { if (!condition) throw new Error(message); };
    window.near = (a, b, message) => ok(Math.abs(a - b) < 1e-6, message + ': ' + a + ' / ' + b);
    const migrated = migrate({ board: { cards: { c: { type: 'character', params: {}, ui: { current: 'a2' } } } } });
    ok(migrated.board.cards.c.params.outputAnim === 'a2', 'Legacy selection migration');
    defineNode({ type: 'test-source', outputs: [{ name: 'out', kind: 'frames' }], defaults: () => ({}), evaluate(p) {
      const frames = [0, 1, 2].map((i) => { const canvas = createCanvas(40, 30), g = canvas.getContext('2d'); g.fillStyle = p.color; g.fillRect(0, 0, 40, 30); return { canvas, index: i, duration: 70 + i }; });
      return { outputs: { out: { kind: 'frames', frames, w: 40, h: 30, fps: 13 } } };
    } });
    const a1 = model.newAnim('a1', 'idle', { card: 's' });
    a1.frames = { 0: { scale: 1.25, duration: 123 }, 1: { disabled: true } };
    const a2 = model.newAnim('a2', 'run', { card: 's' });
    a2.fps = 20;
    const char = { ...model.defaultCharacter(), anims: [a1, a2] };
    window.store = new Store();
    store.load(null, { board: { cards: {
      c: { id: 'c', type: 'character', params: char },
      s: { id: 's', type: 'test-source', params: { color: '#ff0000' } },
      e: { id: 'e', type: 'export', params: nodeType('export').defaults() },
    }, edges: { ce: { id: 'ce', from: { card: 'c', port: 'out' }, to: { card: 'e', port: 'src' } } } } });
    window.engine = new Engine(store);
    // Explicit passes make the checks independent of the animation clock.
    engine.schedule = () => {};
    await engine.run();
    let out = engine.input('e', 'src');
    ok(out.frames.length === 2 && out.frames[0].duration === 123 && out.frames[1].index === 2, 'Output skips disabled frames and retains durations/source indices');
    ok(out.w === 50 && (out.h === 37 || out.h === 38), 'Transformed pixels set output size without source padding: ' + out.w + 'x' + out.h);
    const sheet = await exportSheet(out, { layout: 'row', fps: 12 });
    ok(sheet.png.size > 0 && sheet.json.frames[0].duration === 123, 'Sheet exports tuned frames/timing');
    ok((await exportGif(out, { fps: 12 })).size > 0, 'GIF export');
    ok((await exportWebp(out, { fps: 12 })).size > 0, 'WebP export');
    ok((await exportPngZip(out, { fps: 12 })).size > 0, 'PNG ZIP export');
    window.board = Object.create(Board.prototype);
    Object.assign(board, { store, engine, root: document.getElementById('board') });
    ok(board.canConnect({ card: 'c', port: 'out' }, { card: 'e', port: 'src' }), 'Character output is connectable');
    ok(board.reaches('s', 'e') && !board.reaches('c', 's'), 'References participate in cycle detection');
    window.app = { store, engine, board, framesToBake: (id) => {
      const r = engine.result(id); return r && (r.outputs.out || r.inputs && r.inputs.src) || null;
    }, canBake: (id) => id !== 'e', toast: () => ({ remove() {} }) };
    ok(!frameSourceCards(app, 'c').some((c) => c.id === 'c' || c.id === 'e'), 'Self/downstream references excluded');
    window.tuner = openTuner(app, 'c');
    window.frame = () => store.cards.c.params.anims[0].frames[0];
    const scaleInput = [...tuner.props.querySelectorAll('label')].find((el) => el.querySelector('.f-label')?.textContent === '缩放').querySelector('input');
    ok(scaleInput.value === '1.25' && scaleInput.step === '0.01', 'Two decimal scale field');
    const initialBounds = { ...tuner.bounds };
    ok(tuner.boundsEl.textContent.includes('自适应画布'), 'Adaptive canvas is the visible default');
    const field = (label, tag) => [...tuner.props.querySelectorAll('label')].find((el) => el.querySelector('.f-label')?.textContent === label).querySelector(tag);
    const width = field('画布宽 px', 'input'), height = field('画布高 px', 'input');
    width.value = '160'; width.dispatchEvent(new Event('input', { bubbles: true }));
    height.value = '120'; height.dispatchEvent(new Event('input', { bubbles: true }));
    tuner.updateBounds(); await engine.run();
    ok(store.cards.c.params.export.canvasMode === 'manual' && tuner.bounds.w === 160 && tuner.bounds.h === 120, 'Typing width/height enables manual canvas');
    ok(engine.input('e', 'src').w === 160 && engine.input('e', 'src').h === 120, 'Manual size reaches connected export');
    width.value = '1'; width.dispatchEvent(new Event('input', { bubbles: true }));
    height.value = '1'; height.dispatchEvent(new Event('input', { bubbles: true }));
    tuner.updateBounds();
    ok(tuner.bounds.w === initialBounds.w && tuner.bounds.h === initialBounds.h, 'Manual shrink keeps overflowing painted pixels');
    const mode = field('画布尺寸', 'select'); mode.value = 'auto'; mode.dispatchEvent(new Event('change', { bubbles: true }));
    tuner.updateBounds(); await engine.run();
    ok(store.cards.c.params.export.canvasMode === 'auto' && engine.input('e', 'src').w === initialBounds.w, 'Switching back restores adaptive output');
    tuner.bounds = { w: 10000, h: 8000, ox: 5000, oy: 8000 }; tuner.fit();
    const left = tuner.panX - tuner.bounds.ox * tuner.zoom, top = tuner.panY - tuner.bounds.oy * tuner.zoom;
    ok(tuner.zoom < 1 && left >= 0 && top >= 0 && left + 10000 * tuner.zoom <= tuner.stage.clientWidth && top + 8000 * tuner.zoom <= tuner.stage.clientHeight, 'Large canvas fully fits the stage without stretching');
    tuner.bounds = initialBounds;
    const next = tuner.animList.children[1]; next.click(); await engine.run();
    ok(store.cards.c.params.outputAnim === 'a2' && engine.input('e', 'src').frames.length === 3, 'Tuner animation selection drives output');
    store.undo(); await engine.run();
    ok(tuner.anim().id === 'a1' && engine.input('e', 'src').frames.length === 2, 'Undo restores selection and output');
    tuner.autoFit = false;
    tuner.zoom = 5; tuner.panX = 350; tuner.panY = 300; tuner.onion = false; tuner.render();
    window.dragPoint = (hx, hy) => { const p = tuner.frameBox().point(hx, hy), r = tuner.canvas.getBoundingClientRect(); return { x: p.x + r.left, y: p.y + r.top }; };
    return true;
  })()`);
  const mouse = (type, x, y, extra = {}) => call("Input.dispatchMouseEvent", { type, x, y, ...extra }, sessionId);
  const drag = async (hx, hy, dx, dy) => {
    const p = await evaluate(`dragPoint(${hx}, ${hy})`);
    await mouse("mouseMoved", p.x, p.y);
    await mouse("mousePressed", p.x, p.y, { button: "left", buttons: 1, clickCount: 1 });
    for (let i = 1; i <= 4; i++) await mouse("mouseMoved", p.x + dx * i / 4, p.y + dy * i / 4, { button: "left", buttons: 1 });
    await mouse("mouseReleased", p.x + dx, p.y + dy, { button: "left", clickCount: 1 });
  };
  for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
    const delta = await evaluate(`(() => {
      const box = tuner.frameBox(), moving = box.point(${hx}, ${hy});
      window.expectedFixed = box.point(${1 - hx}, ${1 - hy});
      return { x: (moving.x - expectedFixed.x) * 0.2, y: (moving.y - expectedFixed.y) * 0.2 };
    })()`);
    await drag(hx, hy, delta.x, delta.y);
    await evaluate(`(() => {
      near(frame().scale, 1.50, 'Scale from handle ${hx},${hy}');
      const fixed = tuner.frameBox().point(${1 - hx}, ${1 - hy});
      near(fixed.x, expectedFixed.x, 'Opposite handle x'); near(fixed.y, expectedFixed.y, 'Opposite handle y');
      store.undo(); near(frame().scale, 1.25, 'Handle drag undo');
    })()`);
  }
  await drag(1, 0.5, 50, 0);
  await evaluate(`(async () => {
    near(frame().scale, 1.50, 'Right edge increases scale');
    near(frame().x, 5, 'Opposite edge stays fixed');
    ok(store.cards.c.params.anims[0].frames[2] == null, 'Other frame unchanged');
    await engine.run(); ok(engine.input('e', 'src').w > 50, 'Drag updates downstream canvas');
    store.undo(); near(frame().scale, 1.25, 'One undo restores whole drag');
    store.redo(); near(frame().scale, 1.50, 'Redo restores drag');
    store.undo();
    store.mutate((d) => { const c = d.board.cards.c.params; c.transform = { x: 10, y: -3, scale: 1.1, rot: 18, flip: true }; c.anims[0].transform = { x: 2, y: 4, scale: 0.9, rot: -25, flip: true }; Object.assign(c.anims[0].frames[0], { rot: 30, flip: true }); });
    tuner.zoom = 5; tuner.panX = 350; tuner.panY = 300; tuner.render();
    const box = tuner.frameBox(); window.fixedBefore = box.point(0, 1); const h = box.point(1, 0);
    window.resizeDelta = { x: (h.x - fixedBefore.x) * 0.2, y: (h.y - fixedBefore.y) * 0.2 };
  })()`);
  const delta = await evaluate("resizeDelta");
  await drag(1, 0, delta.x, delta.y);
  await evaluate(`(async () => {
    near(frame().scale, 1.50, 'Corner scaling under rotation and flips');
    const fixed = tuner.frameBox().point(0, 1);
    near(fixed.x, fixedBefore.x, 'Fixed rotated corner x'); near(fixed.y, fixedBefore.y, 'Fixed rotated corner y');
    store.undo(); near(frame().scale, 1.25, 'Rotated drag undo');
    tuner.scaleFrame(-100); near(frame().scale, 0.05, 'Minimum scale');
    tuner.scaleFrame(100); near(frame().scale, 20, 'Maximum scale');
    store.undo();
    // A preview/export used as a source must invalidate when its input changes.
    {
      const { defineNode } = await import('/js/nodes/registry.js');
      defineNode({ type: 'test-pass', inputs: [{ name: 'src', accepts: ['frames'] }] });
    }
    tuner.close();
    store.mutate((d) => { d.board.cards.p = { id: 'p', type: 'test-pass', params: {} }; d.board.edges.sp = { id: 'sp', from: { card: 's', port: 'out' }, to: { card: 'p', port: 'src' } }; d.board.cards.c.params.anims.forEach((a) => a.source.card = 'p'); });
    await engine.run(); const old = engine.outputOf('c', 'out').ver;
    store.mutate((d) => { d.board.cards.s.params.color = '#0000ff'; });
    await engine.run();
    const out = engine.outputOf('c', 'out'); ok(out.ver !== old, 'Referenced pass-through update invalidates character');
    const pixels = out.frames[0].canvas.getContext('2d').getImageData(0, 0, out.w, out.h).data;
    ok(pixels.some((v, i) => i % 4 === 2 && v === 255), 'Changed source pixels reach output');
    store.mutate((d) => { d.board.cards.c.params.anims[0].source.card = 'missing'; }); await engine.run();
    ok(!engine.input('e', 'src'), 'Missing source clears export input');
    store._save.cancel();
  })()`);
  console.log("调帧台浏览器检查通过：两位小数、真实鼠标边缘/四角缩放、旋转/翻转、撤销/重做、连线输出、四种导出、来源更新与缺失。");
  await evaluate(`(async () => {
    const model = await import('/js/tuner/model.js');
    const { createCanvas } = await import('/js/core/util.js');
    const { nodeType } = await import('/js/nodes/registry.js');
    const { exportCharacterZip, bakeAnimation } = await import('/js/tuner/export.js');
    const { readZipFile } = await import('/js/tuner/import.js');
    const big = createCanvas(100, 80), small = createCanvas(100, 80);
    big.getContext('2d').fillStyle = '#f08030'; big.getContext('2d').fillRect(0, 0, 100, 80);
    const sg = small.getContext('2d'); sg.fillStyle = '#10b0f0'; sg.fillRect(10, 10, 20, 20);
    const a = model.newAnim('a', 'sized', { card: 'test-source' });
    a.frames[1] = { scale: 0.5, x: 40 };
    const char = { ...model.defaultCharacter(), anims: [a], outputAnim: a.id };
    const source = { kind: 'frames', w: 100, h: 80, frames: [{ canvas: big, index: 0 }, { canvas: small, index: 1 }], ver: 1 };
    const sources = new Map([['test-source', source]]);
    const size = () => model.exportCanvas(char, sources, [a]);
    let canvas = size();
    ok(canvas.w === 100 && canvas.h === 80, 'Largest painted frame after scaling sets output dimensions');
    ok(canvas.ox === 50 && canvas.oy === 80, 'Transparent overflow does not move the origin');
    // A faint pixel at the far edge must extend the output instead of disappearing.
    sg.fillStyle = 'rgba(255,0,0,0.004)'; sg.fillRect(98, 78, 2, 2);
    canvas = size();
    ok(canvas.w === 115 && canvas.h === 80, 'Painted right overflow adds only the required transparent space');
    const rendered = model.renderExportFrame(char, a, 1, sources, canvas);
    ok(rendered.getContext('2d').getImageData(114, 79, 1, 1).data[3] > 0, 'Faint overflowing edge pixel is retained');
    const preserved = model.renderExportFrame(char, a, 0, sources, canvas).getContext('2d').getImageData(0, 0, 100, 80).data;
    const original = big.getContext('2d').getImageData(0, 0, 100, 80).data;
    ok(preserved.every((v, i) => v === original[i]), 'Largest frame pixels remain unchanged after expansion');
    a.frames[1].disabled = true; ok(size().w === 100, 'Disabled overflow does not expand output');
    delete a.frames[1].disabled;
    sg.clearRect(0, 0, 100, 80); sg.fillStyle = '#10b0f0'; sg.fillRect(0, 0, 100, 80);
    for (const [x, y, w, h] of [[40, 0, 115, 80], [-40, 0, 115, 80], [0, -50, 100, 90], [0, 20, 100, 100], [-40, -50, 115, 90]]) {
      a.frames[1] = { scale: 0.5, x, y }; canvas = size();
      ok(canvas.w === w && canvas.h === h, 'Painted overflow expands correct edge: ' + x + ',' + y);
    }
    // Rotated/flipped overflow is compared with an independently large render.
    a.frames[1] = { scale: 0.5, x: 80, y: -25, rot: 37, flip: true };
    canvas = size();
    const actual = model.renderExportFrame(char, a, 1, sources, canvas);
    const reference = createCanvas(600, 600), rg = reference.getContext('2d');
    rg.imageSmoothingEnabled = false; rg.setTransform(new DOMMatrix().translateSelf(canvas.ox, canvas.oy));
    model.drawAnimFrame(rg, char, a, 1, sources);
    const referencePixels = reference.getContext('2d').getImageData(0, 0, 600, 600).data;
    ok(referencePixels.every((alpha, i) => i % 4 !== 3 || !alpha || ((i >> 2) % 600 < canvas.w && Math.floor((i >> 2) / 600) < canvas.h)), 'No rotated or flipped pixels fall outside the output canvas');
    ok(actual.width === canvas.w && actual.height === canvas.h, 'Rotated output uses the expanded canvas without resizing');
    a.frames[1] = { scale: 0.5, x: 5000 };
    sg.clearRect(0, 0, 100, 80); ok(size().w === 100, 'Distant fully transparent frame does not create extra padding');
    a.frames[1] = { scale: 0.5 };
    const other = model.newAnim('other', 'large-group', { card: 'other-source' });
    const otherCanvas = createCanvas(200, 160); otherCanvas.getContext('2d').fillRect(0, 0, 200, 160);
    sources.set('other-source', { kind: 'frames', w: 200, h: 160, frames: [{ canvas: otherCanvas, index: 0 }], ver: 2 });
    char.anims.push(other);
    const ctx = { store: { cards: { 'test-source': { type: 'test-source' }, 'other-source': { type: 'test-source' } } }, engine: { result: (id) => ({ outputs: { out: sources.get(id) } }) } };
    const out = nodeType('character').evaluate(char, {}, ctx).outputs.out;
    ok(out.w === 100 && out.h === 80, 'Connected output sizes only the selected animation');
    const zip = await exportCharacterZip({ store: { projectId: null } }, char, sources, 'test');
    const files = await readZipFile(zip), json = JSON.parse(new TextDecoder().decode(files.get('character.json')));
    ok(json.frameSize.w === 200 && json.frameSize.h === 160, 'Character package shares maximum canvas across animations');
    const { api } = await import('/js/core/api.js'); const upload = api.uploadAsset;
    let baked, serial = 0; api.uploadAsset = async () => 'sizing-test-' + ++serial;
    try {
      await bakeAnimation({ store: { projectId: null, cards: { c: { x: 0, y: 0, w: 10, title: 'test' } } },
        toast: () => ({ remove() {} }), imageCardSize: () => ({ w: 100, h: 80 }), freeSpot: () => ({ x: 0, y: 0 }),
        addCard: (_type, _x, _y, p) => { baked = p; return 'baked'; },
      }, 'c', char, a, sources);
      ok(baked.w === 100 && baked.h === 80, 'Baking uses the selected animation canvas');
    } finally { api.uploadAsset = upload; }
  })()`);
  console.log("输出尺寸浏览器检查通过：缩放后的实际像素、透明溢出裁切、半透明像素扩边、四边扩展、原像素不变、旋转翻转、连线/角色包/烘焙尺寸。");
  await evaluate(`(async () => {
    const model = await import('/js/tuner/model.js');
    const { createCanvas } = await import('/js/core/util.js');
    const { nodeType } = await import('/js/nodes/registry.js');
    const { exportSheet } = await import('/js/nodes/exporters.js');
    // Imported/processed frames share a large canvas even when their contents
    // differ in size. Shrinking the big drawing must make the other frame win.
    const small = createCanvas(1000, 1000), large = createCanvas(1000, 1000);
    small.getContext('2d').fillRect(460, 940, 80, 60);
    large.getContext('2d').fillRect(300, 600, 400, 400);
    const source = { kind: 'frames', w: 1000, h: 1000, frames: [{ canvas: small, index: 0 }, { canvas: large, index: 1 }] };
    const sources = new Map([['padded', source]]);
    const a = model.newAnim('padded', 'padded', { card: 'padded' });
    a.frames[1] = { scale: 0.1 };
    const char = { ...model.defaultCharacter(), anims: [a] };
    const size = () => model.exportCanvas(char, sources);
    let canvas = size();
    ok(canvas.w === 80 && canvas.h === 60, '400x400 frame shrunk to 40x40 cannot enlarge the 80x60 frame');
    ok(source.w === 1000 && source.frames[1].canvas.width === 1000, 'Shared original canvas stays intact');
    const actual = model.renderExportFrame(char, a, 0, sources, canvas).getContext('2d').getImageData(0, 0, 80, 60).data;
    const expected = small.getContext('2d').getImageData(460, 940, 80, 60).data;
    ok(actual.every((v, i) => v === expected[i]), 'Unscaled frame remains pixel-identical after transparent padding is cropped');
    const ctx = { store: { cards: { padded: { type: 'test-source' } } }, engine: { result: () => ({ outputs: { out: source } }) } };
    let out = nodeType('character').evaluate(char, {}, ctx).outputs.out;
    ok(out.w === 80 && out.h === 60 && out.frames.every((f) => f.canvas.width === 80 && f.canvas.height === 60), 'Node outputs use actual scaled dimensions for every cell');
    const sheet = await exportSheet(out, { layout: 'row' });
    ok(sheet.json.frameSize.w === 80 && sheet.json.frameSize.h === 60 && sheet.json.size.w === 160, 'Export sheet and JSON retain scaled output dimensions');
    a.frames[0] = { scale: 0.25 };
    canvas = size(); ok(canvas.w === 40 && canvas.h === 40, 'Shrinking a former maximum frame recomputes the winner');
    a.frames[1].scale = 0.05;
    canvas = size(); ok(canvas.w === 20 && canvas.h === 20, 'Repeated shrinking never keeps the original canvas minimum');
    a.frames = { 1: { scale: 0.1 } };
    a.transform.scale = 0.8; char.transform.scale = 0.5;
    canvas = size(); ok(canvas.w === 32 && canvas.h === 24, 'Frame, group and character scaling all contribute to output dimensions');
    out = nodeType('character').evaluate(char, {}, ctx).outputs.out;
    ok(out.w === 32 && out.h === 24, 'Connected output follows all three scale levels');
    const autoCanvas = canvas, autoFrame = model.renderExportFrame(char, a, 0, sources, autoCanvas);
    char.export.canvasMode = 'manual'; char.export.w = 100; char.export.h = 80;
    const manualCanvas = size(), manualFrame = model.renderExportFrame(char, a, 0, sources, manualCanvas);
    ok(manualCanvas.w === 100 && manualCanvas.h === 80, 'Manual dimensions add transparent space');
    const manualPixels = manualFrame.getContext('2d').getImageData(manualCanvas.ox - autoCanvas.ox, manualCanvas.oy - autoCanvas.oy, 32, 24).data;
    const autoPixels = autoFrame.getContext('2d').getImageData(0, 0, 32, 24).data;
    ok(manualPixels.every((v, i) => v === autoPixels[i]), 'Manual canvas padding keeps scaled pixels unchanged');
    char.export.w = 1; char.export.h = 1;
    canvas = size(); ok(canvas.w === 32 && canvas.h === 24, 'Manual dimensions cannot clip actual pixels');
    char.export.canvasMode = 'auto'; char.export.w = 100; char.export.h = 80;
    canvas = size(); ok(canvas.w === 32 && canvas.h === 24, 'Adaptive mode ignores remembered manual dimensions');
    a.frames[0] = { disabled: true }; a.frames[1] = { disabled: true };
    canvas = size(); ok(canvas.w === 1 && canvas.h === 1, 'No enabled pixels do not resurrect source dimensions');
  })()`);
  console.log("缩小尺寸回归通过：1000×1000 共用画布不撑大输出，400×400 缩至 40×40 后按 40×40 计算，最大帧切换与三级缩放正常。");
  await evaluate(`(async () => {
    const { api } = await import('/js/core/api.js');
    const { putCanvasAsset, getAssetCanvas } = await import('/js/core/assets.js');
    const { createCanvas, canvasToBlob } = await import('/js/core/util.js');
    const { appendFrameImages } = await import('/js/editor/import.js');
    const { openEditor } = await import('/js/editor/editor.js');
    const { nodeType } = await import('/js/nodes/registry.js');
    await import('/js/nodes/types/animation.js');
    const upload = api.uploadAsset; let serial = 0;
    api.uploadAsset = async () => 'test-frame-' + ++serial;
    try {
      const image = (w, h, color) => { const c = createCanvas(w, h); const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, w, h); return c; };
      const oldAsset = await putCanvasAsset(null, image(40, 30, '#ff0000'));
      const small = new File([await canvasToBlob(image(10, 10, '#00ff00'))], 'frame_2.png', { type: 'image/png' });
      const large = new File([await canvasToBlob(image(80, 40, '#0000ff'))], 'frame_10.png', { type: 'image/png' });
      store.mutate((d) => { d.board.cards.anim = { id: 'anim', type: 'animation', title: 'test', params: {
        w: 40, h: 30, fps: 17, layers: [{ id: 'L1', name: 'original', visible: true, opacity: 100 }],
        frames: [{ id: 'old-frame', duration: 145, cels: { L1: oldAsset } }], palette: ['#ff0000'], trails: [],
      } }; });
      const original = JSON.stringify(store.cards.anim.params.frames[0]);
      ok(await appendFrameImages(app, 'anim', [large, small]) === 2, 'Batch append count');
      let p = store.cards.anim.params;
      ok(p.frames.length === 3 && p.fps === 17 && p.palette[0] === '#ff0000', 'Append preserves animation settings');
      ok(JSON.stringify(p.frames[0]) === original, 'Original frame and layer asset preserved');
      const green = await getAssetCanvas(null, p.frames[1].cels.L1);
      const g = green.getContext('2d');
      ok(g.getImageData(15, 20, 1, 1).data[1] === 255 && g.getImageData(14, 20, 1, 1).data[3] === 0, 'Numeric filename order and small-image bottom-centre padding');
      const blue = await getAssetCanvas(null, p.frames[2].cels.L1);
      ok(blue.getContext('2d').getImageData(0, 10, 1, 1).data[2] === 255 && blue.getContext('2d').getImageData(0, 9, 1, 1).data[3] === 0, 'Large image shrinks proportionally without cropping');
      store.undo(); ok(store.cards.anim.params.frames.length === 1, 'Batch append is one undo step');
      store.redo(); ok(store.cards.anim.params.frames.length === 3, 'Batch append redo');
      const before = JSON.stringify(store.cards.anim.params);
      try { await appendFrameImages(app, 'anim', [new File(['bad'], 'broken.png', { type: 'image/png' })]); throw new Error('Invalid file accepted'); }
      catch (err) { ok(err.message !== 'Invalid file accepted', 'Invalid image rejects'); }
      ok(JSON.stringify(store.cards.anim.params) === before, 'Failed decoding leaves animation unchanged');
      ok(await appendFrameImages(app, 'anim', []) === 0, 'Cancelled selection makes no change');
      await engine.run(); ok(engine.outputOf('anim', 'out').frames.length === 3, 'Appended frames reach node output');

      app.appendAnimationFrames = (id, files) => { window.appendTask = appendFrameImages(app, id, files); return appendTask; };
      app.addFiles = () => { throw new Error('Drop created a separate card'); };
      board.app = app;
      const target = document.createElement('div'); target.className = 'card'; target.dataset.id = 'anim'; board.root.append(target);
      board.onDrop({ target, clientX: 10, clientY: 10, preventDefault() {}, dataTransfer: { getData: () => '', files: [small], items: [] } });
      await appendTask; ok(store.cards.anim.params.frames.length === 4, 'Dropping one image appends to target card');
      store.undo();
      const body = document.createElement('div');
      const view = nodeType('animation').mount({ body, id: 'anim', app, params: () => store.cards.anim.params, output: () => engine.outputOf('anim', 'out') });
      ok(body.querySelector('button').textContent.includes('添加帧图片'), 'Animation card exposes add-images button'); view.destroy();

      const ed = await openEditor(app, 'anim');
      ed.doc.layers[0].locked = true;
      await ed.importFrameImages([small]);
      ok(ed.doc.frames.length === 4 && ed.fi === 1, 'Editor inserts image immediately after current frame');
      ok(ed.doc.layers.length === 2 && !ed.doc.layers[ed.li].locked, 'Locked layer is preserved; imported image gets editable layer');
      ok(ed.doc.cel(1, ed.li).data[(20 * 40 + 15) * 4 + 1] === 255, 'Inserted cel contains image pixels');
      ok(store.cards.anim.params.frames.length === 3, 'Editor changes stay local before save');
      ed.undo(); ok(ed.doc.frames.length === 3 && ed.doc.layers.length === 1, 'Editor insertion undo restores frames/layers');
      ed.redo(); ok(ed.doc.frames.length === 4, 'Editor insertion redo');
      ok(await ed.save(), 'Editor import saves to original card');
      ok(store.cards.anim.params.frames.length === 4 && store.cards.anim.params.frames[0].id === 'old-frame', 'Save keeps original frame and appends no extra cards');
      ed.close(true);
      store.undo(); ok(store.cards.anim.params.frames.length === 3, 'Board undo restores saved animation');
      store._save.cancel();
    } finally { api.uploadAsset = upload; }
  })()`);
  console.log("单帧导入浏览器检查通过：追加/插入、多图数字排序、尺寸适配、原帧保留、拖放、失败回滚、撤销重做、保存和节点输出。");
  await call("Browser.close");
} finally {
  socket?.close();
  chrome.kill();
  await new Promise((resolve) => server.close(resolve));
  // Only remove the unique temporary profile created by this check.
  assert.ok(profile.startsWith(path.join(tmpdir(), "guangtai-tuner-")));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
