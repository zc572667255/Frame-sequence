// App shell: wires the store, evaluation engine, board and panels together and
// owns the actions that span them (projects, adding cards, baking, pipelines).
import "./nodes/types/index.js";
import { Store, migrate } from "./core/store.js";
import { api } from "./core/api.js";
import { putBlobAsset, putCanvasAsset } from "./core/assets.js";
import { el, uid, blobToCanvas, fmtBytes } from "./core/util.js";
import { Engine } from "./nodes/engine.js";
import { nodeType, allNodeTypes, CATEGORIES, outputKinds, inputAccepts } from "./nodes/registry.js";
import { Board, HEAD_H } from "./board/board.js";
import { Inspector, SHORTCUTS } from "./ui/inspector.js";
import { showMenu, showAddMenu, closeMenu } from "./ui/menu.js";
import { openModal } from "./ui/modal.js";
import { dockSplit } from "./ui/dock.js";
import { TRIM, trimBlank } from "./nodes/types/reframe.js";
import { newAnim, normalizeCharacter, calibrate } from "./tuner/model.js";
import { resolveSources } from "./tuner/tuner.js";
import { parseFrameJson, framesFromSpec, readZipFile, findFrameJson, importCharacterPackage } from "./tuner/import.js";
import { isImageFile, naturalSort, decodeFiles, decodeAnimated, importDialog, normalizeFrames, sheetDialog } from "./ui/importer.js";

const THEME = "gt.theme";

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

const fmtTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
};

class App {
  constructor() {
    this.store = new Store();
    this.engine = new Engine(this.store);
    this.board = new Board(document.getElementById("board"), this);
    this.inspector = new Inspector(document.getElementById("inspector"), this);
    this.toasts = document.getElementById("toasts");
    this.settings = {};
    this.buildTopbar();
    this.buildPalette();
    this.buildDock();
    this.bindGlobalKeys();
    // localStorage only paints the right theme before the server answers;
    // data/registry.json is where the setting really lives
    this.applyTheme(lsGet(THEME) || "dark", false);
    this.board.on("selection", () => {
      if (!this.store.doc) return;
      const sel = this.board.selectedIds();
      const prev = this.store.doc.ui.selection || [];
      if (sel.length !== prev.length || sel.some((id, i) => id !== prev[i])) this.store.setUi({ selection: sel });
    });
    window.addEventListener("pagehide", () => this.store.saveOnExit());
    window.addEventListener("beforeunload", (e) => {
      this.store.saveOnExit();
      if (this.store.saveState === "error") { e.preventDefault(); e.returnValue = ""; }
    });
  }

  async start() {
    try {
      this.settings = await api.getSettings();
      if (this.settings.theme) this.applyTheme(this.settings.theme, false);
      // the 属性 panel folded or not follows the setting (shared by every browser)
      if (this.settings.inspectorHidden != null && !!this.settings.inspectorHidden !== this.inspBar.folded()) this.inspBar.toggle(!!this.settings.inspectorHidden);
      const { projects, last } = await api.listProjects();
      const pick = projects.find((p) => p.id === last && !p.missing) || projects.find((p) => !p.missing);
      if (pick) await this.openProject(pick.id);
      else await this.createProject("我的第一个项目");
    } catch (err) {
      this.toast(err.message, "error");
      document.getElementById("board").append(el("div", { class: "board-fatal" }, "无法打开项目：" + err.message));
    }
  }

  saveSetting(patch) {
    Object.assign(this.settings, patch);
    api.putSettings(patch).catch((err) => this.toast("设置保存失败：" + err.message, "error"));
  }

  // ---------- projects ----------
  async openProject(id) {
    this.store.flushSave();
    const { doc, path } = await api.loadProject(id);
    const selection = (doc.ui && doc.ui.selection) || [];
    this.store.load(id, doc, path);
    // put the user back exactly where they left off: camera, selection, inspector
    this.board.applyView();
    const v = doc.board.view;
    if (v.x === 0 && v.y === 0 && v.z === 1) this.board.fitView();
    this.board.setSelection(selection.filter((sid) => this.store.cards[sid]));
    this.updateProjectName();
  }

  async createProject(name, parent) {
    const r = await api.createProject(name || "未命名项目", parent);
    await this.openProject(r.id);
    this.toast("已新建项目，保存在 " + r.path, "ok");
  }

  newProjectDialog() {
    api.listProjects().then(({ defaultParent }) => {
      const name = el("input", { type: "text", value: "未命名项目" });
      const parent = el("input", { type: "text", class: "mono", value: this.settings.lastParent || defaultParent });
      const browse = el("button", { class: "btn", onclick: async () => {
        const r = await this.pickFolder("选择新项目存放的位置", parent.value);
        if (r) parent.value = r;
      } }, "浏览…");
      const m = openModal("新建项目", {
        buttons: [
          { label: "取消", action: () => {} },
          { label: "创建", primary: true, action: async () => {
            try {
              this.saveSetting({ lastParent: parent.value.trim() });
              await this.createProject(name.value.trim() || "未命名项目", parent.value.trim() || defaultParent);
            } catch (err) { this.toast(err.message, "error"); return false; }
          } },
        ],
      });
      m.body.append(
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "项目名称"), name),
        el("label", { class: "f-field" }, el("span", { class: "f-label" }, "存放位置（会在这里新建一个同名文件夹）"),
          el("div", { class: "f-row" }, parent, browse)),
        el("p", { class: "f-hint" }, "项目就是一个普通文件夹：project.gtproj 加上 assets 图片目录。可以整个复制、备份或放进网盘，用「打开项目」就能再打开。"),
      );
      name.focus();
      name.select();
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") m.root.querySelector(".modal-foot .primary").click(); });
    }).catch((err) => this.toast(err.message, "error"));
  }

  // native folder dialog; falls back to typing a path where there is none
  async pickFolder(title, start) {
    try {
      return (await api.pickFolder(title, start)).path;
    } catch (err) {
      const p = prompt(err.message + "\n\n" + title, start || "");
      return p && p.trim() ? p.trim() : null;
    }
  }

  async openProjectDialog() {
    let p;
    try {
      p = (await api.pickProjectFile(this.settings.lastParent)).path;
    } catch (err) {
      p = prompt(err.message + "\n\n项目文件夹或 .gtproj 文件的完整路径：", "");
    }
    if (!p) return;
    try {
      const r = await api.openProject(p.trim());
      await this.openProject(r.id);
      this.toast("已打开 " + r.path, "ok");
    } catch (err) { this.toast(err.message, "error"); }
  }

  async saveAsDialog() {
    const doc = this.store.doc;
    const name = prompt("另存为：新项目名称", doc.name + " 副本");
    if (name === null) return;
    const cur = this.store.projectPath;
    const parent = await this.pickFolder("选择另存的位置", cur ? cur.replace(/[\\/][^\\/]*$/, "") : "");
    if (!parent) return;
    try {
      await this.store.saveNow();
      const r = await api.saveProjectAs(this.store.projectId, parent, name.trim() || doc.name + " 副本");
      await this.openProject(r.id);
      this.toast("已另存到 " + r.path + "，现在编辑的是新副本。", "ok");
    } catch (err) { this.toast(err.message, "error"); }
  }

  async backupsDialog() {
    let list;
    try { list = await api.listBackups(this.store.projectId); } catch (err) { this.toast(err.message, "error"); return; }
    const m = openModal("历史版本");
    m.body.append(el("p", { class: "f-hint" }, "编辑时每 10 分钟最多自动备份一次，保留最近 30 份，存在项目文件夹的 backups 里。恢复会替换当前画布，可以用 Ctrl+Z 撤回。"));
    if (!list.length) { m.body.append(el("p", { class: "chips-empty" }, "还没有备份。第一次备份会在下次保存时生成。")); return; }
    m.body.append(el("div", { class: "backup-list" }, ...list.map((b) => el("div", { class: "backup-row" },
      el("span", { class: "mono" }, fmtTime(b.savedAt)),
      el("span", { class: "dim mono" }, fmtBytes(b.size)),
      el("button", { class: "btn small", onclick: async () => {
        try {
          const old = migrate(await api.loadBackup(this.store.projectId, b.name));
          this.store.mutate((d) => {
            d.board.cards = old.board.cards;
            d.board.edges = old.board.edges;
          });
          m.close();
          this.toast("已恢复到 " + fmtTime(b.savedAt) + " 的版本，Ctrl+Z 可以撤回。", "ok");
        } catch (err) { this.toast(err.message, "error"); }
      } }, "恢复"),
    ))));
  }

  revealCurrent() {
    api.revealProject(this.store.projectId).catch((e) => this.toast(e.message, "error"));
  }

  async trashProject() {
    const doc = this.store.doc;
    if (!doc) return;
    if (!confirm("删除项目「" + doc.name + "」？\n\n整个项目文件夹会移到工作室的 data/trash 里，需要时可以手动找回。")) return;
    const id = this.store.projectId;
    this.store._save.cancel();
    try {
      const r = await api.trashProject(id);
      this.toast("已移到 " + r.movedTo, "ok");
    } catch (err) { this.toast(err.message, "error"); return; }
    await this.openFallback();
  }

  async forgetProject(id) {
    await api.forgetProject(id);
    if (id === this.store.projectId) await this.openFallback();
  }

  async openFallback() {
    const { projects } = await api.listProjects();
    const next = projects.find((p) => !p.missing);
    if (next) await this.openProject(next.id);
    else await this.createProject("未命名项目");
  }

  updateProjectName() {
    if (this.projectBtnLabel && this.store.doc) {
      this.projectBtnLabel.textContent = this.store.doc.name;
      this.projectBtn.title = "保存在 " + this.store.projectPath + "\n点击切换 / 新建 / 打开项目";
      document.title = this.store.doc.name + " · 光台序列帧工作室";
    }
  }

  async showProjectMenu(x, y) {
    let list = [];
    try { list = (await api.listProjects()).projects; } catch (err) { this.toast(err.message, "error"); }
    const cur = this.store.projectId;
    const err = (p) => p.catch((e) => this.toast(e.message, "error"));
    showMenu(x, y, [
      { label: "新建项目…", action: () => this.newProjectDialog() },
      { label: "打开项目…", hint: "Ctrl+O", action: () => this.openProjectDialog() },
      { label: "另存为…", action: () => this.saveAsDialog() },
      "-",
      { heading: "最近的项目" },
      ...list.slice(0, 15).map((p) => ({
        label: (p.id === cur ? "● " : "") + p.name + (p.missing ? "（找不到文件）" : ""),
        hint: fmtTime(p.lastOpened).slice(5),
        disabled: p.id === cur,
        action: () => {
          if (!p.missing) { err(this.openProject(p.id)); return; }
          if (confirm("找不到这个项目：\n" + p.path + "\n\n文件夹可能被移动或删除了。要把它从最近列表里移除吗？")) err(this.forgetProject(p.id));
        },
      })),
      "-",
      { label: "重命名当前项目…", action: () => this.renameProject() },
      { label: "历史版本…", action: () => this.backupsDialog() },
      { label: "清理未使用素材…", action: () => err(this.cleanAssets()) },
      { label: "在资源管理器中显示", action: () => this.revealCurrent() },
      { label: "从最近列表移除", hint: "文件保留", action: () => err(this.forgetProject(cur)) },
      { label: "删除项目…", danger: true, action: () => this.trashProject() },
      "-",
      { label: "打开旧版单页工具", hint: "/legacy", action: () => window.open("/legacy", "_blank") },
    ]);
  }

  // Old versions of edited frames stay in assets/ after saving. Move the ones
  // nothing uses — not the project, its backups or this page's undo history —
  // to the trash.
  async cleanAssets() {
    if (document.querySelector(".editor-root")) { this.toast("先关闭像素编辑器（保存或放弃改动）再清理。", "warn"); return; }
    const id = this.store.projectId;
    // what's on screen must be on disk first
    this.store.flushSave();
    for (let i = 0; i < 100 && (this.store._inflight || this.store.saveState === "dirty"); i++) await new Promise((r) => setTimeout(r, 50));
    const keep = new Set();
    for (const s of [JSON.stringify(this.store.doc), ...this.store.undoStack, ...this.store.redoStack]) {
      for (const m of String(s).matchAll(/[0-9a-f]{40}\.(?:png|webp|jpg|gif|wav|mp3|ogg)/g)) keep.add(m[0]);
    }
    const r = await api.unusedAssets(id, [...keep]);
    if (!r.count) { this.toast("没有未使用的素材（共 " + r.total + " 个，都在用）。", "ok"); return; }
    if (!confirm("找到 " + r.count + " 个未使用的素材（" + fmtBytes(r.bytes) + "），是编辑时被替换掉的旧版本。\n\n当前项目、历史版本和撤销记录里用到的都会保留。\n清理后这些文件会移到 data/trash，不会直接删除。要清理吗？")) return;
    const done = await api.cleanAssets(id, [...keep]);
    this.toast("已清理 " + done.count + " 个素材（" + fmtBytes(done.bytes) + "），移到了 " + done.movedTo, "ok");
  }

  renameProject() {
    const n = prompt("项目名称（只改显示名称，文件夹名不变）", this.store.doc.name);
    if (n === null || !n.trim()) return;
    this.store.rename(n.trim());
    this.updateProjectName();
  }

  // ---------- cards ----------
  makeCard(type, x, y, params, extra) {
    const def = nodeType(type);
    const id = uid("c");
    const size = (extra && extra.size) || def.size;
    return {
      id, type, x: Math.round(x), y: Math.round(y), w: size.w, h: size.h,
      title: (extra && extra.title) || "",
      bypass: !!(extra && extra.bypass),
      params: { ...(def.defaults ? def.defaults() : {}), ...(params || {}) },
    };
  }

  // x/y null = centre of the view
  addCard(type, x, y, params, opts = {}) {
    const def = nodeType(type);
    if (x == null || y == null) {
      const c = this.board.centerWorld();
      const size = (opts.size || def.size);
      x = c.x - size.w / 2; y = c.y - size.h / 2;
    }
    const card = this.makeCard(type, x, y, params, opts);
    this.store.mutate((d) => { d.board.cards[card.id] = card; }, { coalesce: "add-" + card.id });
    if (opts.select !== false) this.board.select(card.id, false);
    return card.id;
  }

  // nearest spot at or below (x, y) where a w×h card doesn't overlap any other card
  freeSpot(x, y, w, h) {
    const cards = Object.values(this.store.cards).filter((c) => c.type !== "group");
    const gap = 24;
    for (let i = 0; i < 60; i++) {
      const hit = cards.find((c) => x < c.x + c.w + gap && x + w + gap > c.x && y < c.y + c.h + gap && y + h + gap > c.y);
      if (!hit) return { x, y };
      y = hit.y + hit.h + gap;
    }
    return { x, y };
  }

  // card size that shows an image at its aspect ratio
  imageCardSize(w, h) {
    const cw = Math.max(200, Math.min(420, w < 200 ? 260 : w));
    const bodyH = Math.max(120, Math.min(420, cw * h / w));
    return { w: Math.round(cw), h: Math.round(bodyH + HEAD_H + 26) };
  }

  async addImageBlob(blob, name, at) {
    const canvas = await blobToCanvas(blob);
    const asset = await putBlobAsset(this.store.projectId, blob);
    const size = this.imageCardSize(canvas.width, canvas.height);
    const p = at || this.board.centerWorld();
    return this.addCard("image", p.x - size.w / 2, p.y - size.h / 2, { asset, name: name || "" }, { size, select: true });
  }

  // Dropped / picked files. Several images (or a folder) can become one animation;
  // a single animated GIF / WebP / APNG becomes an animation directly.
  async addFiles(files, at, opts = {}) {
    // packages first: a zip, or a JSON describing frames on a sheet
    const zip = files.find((f) => /\.zip$/i.test(f.name));
    if (zip) { this.importZip(zip, at).catch((err) => this.toast("导入失败：" + err.message, "error")); return; }
    const json = files.find((f) => /\.json$/i.test(f.name));
    if (json) { this.importJson(json, files.filter(isImageFile), at).catch((err) => this.toast("导入失败：" + err.message, "error")); return; }
    const images = naturalSort(files.filter(isImageFile));
    if (!images.length) { this.toast("只支持图片文件（PNG / JPG / WebP / GIF）。", "warn"); return; }
    if (images.length > 1 && opts.folder) { this.importSequence(images, at); return; }
    if (images.length > 1) {
      const m = openModal("导入 " + images.length + " 张图片", {
        buttons: [
          { label: "分别作为素材图", action: () => { this.addImageCards(images, at); } },
          { label: "合成一个动画（" + images.length + " 帧）", primary: true, action: () => { this.importSequence(images, at); } },
        ],
      });
      m.body.append(el("p", null, "这些图片是同一段动画的序列帧吗？"),
        el("p", { class: "f-hint" }, images[0].name + "  …  " + images[images.length - 1].name));
      return;
    }
    const anim = await decodeAnimated(images[0]);
    if (anim) { this.importSequence(images, at, anim); return; }
    this.addImageCards(images, at);
  }

  async addImageCards(images, at) {
    let off = 0;
    for (const f of images) {
      try {
        await this.addImageBlob(f, f.name.replace(/\.[^.]+$/, ""), { x: at.x + off, y: at.y + off });
        off += 40;
      } catch (err) {
        this.toast("「" + f.name + "」读取失败：" + err.message, "error");
      }
    }
  }

  pickFile(accept) {
    return this.pickFiles(accept).then((list) => list[0] || null);
  }

  // multiple: several files; directory: a whole folder (all files inside)
  pickFiles(accept, opts = {}) {
    return new Promise((resolve) => {
      const input = el("input", { type: "file", accept, multiple: !!opts.multiple });
      if (opts.directory) input.webkitdirectory = true;
      input.addEventListener("change", () => resolve([...(input.files || [])]));
      input.click();
    });
  }

  importMenu(x, y, at) {
    const where = at || this.board.centerWorld();
    showMenu(x, y, [
      { label: "选择多张序列帧图片…", hint: "可多选", action: () => this.pickFiles("image/*", { multiple: true }).then((fs) => fs.length && this.importSequence(naturalSort(fs.filter(isImageFile)), where)) },
      { label: "选择文件夹…", hint: "整个文件夹", action: () => this.pickFiles("", { directory: true }).then((fs) => {
        const imgs = naturalSort(fs.filter(isImageFile));
        if (imgs.length) this.importSequence(imgs, where); else if (fs.length) this.toast("这个文件夹里没有图片。", "warn");
      }) },
      { label: "选择 GIF / WebP / APNG 动图…", action: () => this.pickFile("image/gif,image/webp,image/png,image/apng").then((f) => f && this.importSequence([f], where)) },
      { label: "导入角色包 / 序列图+JSON / zip…", hint: "可多选", action: () => this.pickFiles(".zip,.json,image/*", { multiple: true }).then((fs) => fs.length && this.addFiles(fs, where)) },
      { label: "选择序列帧整图…", hint: "一张图里多帧", action: () => this.pickFile("image/*").then(async (f) => {
        if (f) this.sheetToAnimation(await blobToCanvas(f), f.name.replace(/\.[^.]+$/, ""), where);
      }) },
    ]);
  }

  // a zip: a character package, an export with frame JSON, or just loose PNGs
  async importZip(file, at) {
    const entries = await readZipFile(file);
    if (entries.has("character.json")) { await importCharacterPackage(this, entries, at); return; }
    const name = file.name.replace(/\.zip$/i, "");
    const found = findFrameJson(entries);
    const get = (p) => {
      for (const k of entries.keys()) if (k === p || k.endsWith("/" + p) || k.split("/").pop() === String(p).split("/").pop()) return new Blob([entries.get(k)]);
      return null;
    };
    let frames;
    if (found) frames = await framesFromSpec(found.spec, get, name);
    else {
      const pngs = [...entries.keys()].filter((k) => /\.(png|webp|jpe?g|gif)$/i.test(k)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!pngs.length) { this.toast("zip 里没有图片。", "warn"); return; }
      frames = [];
      for (const k of pngs) frames.push({ canvas: await blobToCanvas(new Blob([entries.get(k)])), duration: null, name: k });
    }
    this.importSequence(null, at, frames);
  }

  // sheet + JSON picked / dropped together (studio export, Aseprite, TexturePacker)
  async importJson(file, images, at) {
    const spec = parseFrameJson(JSON.parse(await file.text()));
    if (!spec) { this.toast("看不懂这个 JSON：需要 frames 列表（本工具导出的、Aseprite 或 TexturePacker 格式）。", "warn"); return; }
    const byName = new Map(images.map((f) => [f.name.toLowerCase(), f]));
    const get = (p) => byName.get(String(p || "").split(/[\\/]/).pop().toLowerCase()) || (images.length === 1 ? images[0] : null);
    if (!spec.frames.some((f) => f.file) && !get(spec.image)) {
      this.toast("请把 JSON 和它对应的序列图（" + (spec.image || "PNG") + "）一起选中或拖进来。", "warn");
      return;
    }
    this.importSequence(null, at, await framesFromSpec(spec, get, file.name.replace(/\.json$/i, "")));
  }

  // one image holding many frames -> grid dialog -> import dialog -> animation card
  async sheetToAnimation(canvas, name, at) {
    const frames = await sheetDialog(canvas, name);
    if (frames && frames.length) this.importSequence(null, at, frames);
  }

  // decode -> ask -> upload -> animation card
  async importSequence(files, at, decoded) {
    const t = this.toast("正在读取图片…");
    let frames;
    try {
      frames = decoded || await decodeFiles(files, (i, n) => { t.textContent = "正在读取图片 " + i + " / " + n + "…"; });
    } catch (err) {
      this.toast("读取失败：" + err.message, "error");
      return;
    }
    t.remove();
    if (!frames.length) return;
    const opt = await importDialog(frames);
    if (!opt) return;
    if (opt.reverse) frames = [...frames].reverse();
    const norm = normalizeFrames(frames, opt.anchor);
    const progress = this.toast("正在保存帧…");
    try {
      const assets = [];
      for (let i = 0; i < norm.frames.length; i++) {
        progress.textContent = "正在保存帧 " + (i + 1) + " / " + norm.frames.length + "…";
        assets.push(await putCanvasAsset(this.store.projectId, norm.frames[i].canvas));
      }
      progress.remove();
      const s = this.imageCardSize(norm.w, norm.h);
      const size = { w: Math.max(240, s.w), h: s.h + 10 };
      const p = at || this.board.centerWorld();
      const spot = this.freeSpot(p.x - size.w / 2, p.y - size.h / 2, size.w, size.h);
      this.addCard("animation", spot.x, spot.y, {
        w: norm.w, h: norm.h, fps: opt.fps,
        layers: [{ id: "L1", name: "图层 1", visible: true, opacity: 100 }],
        frames: norm.frames.map((f, i) => ({ id: "F" + (i + 1), duration: opt.keepDurations ? f.duration || null : null, cels: { L1: assets[i] } })),
        palette: [],
      }, { size, title: opt.name, select: true });
      this.toast("已导入 " + norm.frames.length + " 帧动画「" + opt.name + "」。可以直接接处理节点，或双击进像素编辑器。", "ok");
    } catch (err) {
      progress.remove();
      this.toast("导入失败：" + err.message, "error");
    }
  }

  async pickAndUploadImage() {
    const f = await this.pickFile("image/*");
    if (!f) return null;
    const asset = await putBlobAsset(this.store.projectId, f);
    return { asset, name: f.name.replace(/\.[^.]+$/, "") };
  }

  async addImageFromPicker() {
    const f = await this.pickFile("image/*");
    if (f) await this.addFiles([f], this.board.centerWorld());
  }

  groupSelection() {
    const ids = this.board.selectedIds();
    const cards = ids.map((id) => this.store.cards[id]).filter(Boolean);
    if (!cards.length) return;
    const pad = 28;
    const x0 = Math.min(...cards.map((c) => c.x)) - pad, y0 = Math.min(...cards.map((c) => c.y)) - pad - HEAD_H;
    const x1 = Math.max(...cards.map((c) => c.x + c.w)) + pad, y1 = Math.max(...cards.map((c) => c.y + c.h)) + pad;
    this.addCard("group", x0, y0, null, { size: { w: x1 - x0, h: y1 - y0 }, select: true });
  }

  // Put a new node right after card `id`: id -> new, and whatever used to read
  // id's output now reads the new node's output instead.
  insertAfter(id, type, params) {
    const card = this.store.cards[id];
    const def = card && nodeType(card.type);
    if (!def || !def.outputs.length) return null;
    const port = def.outputs[0].name;
    const size = nodeType(type).size;
    const spot = this.freeSpot(card.x + card.w + 70, card.y, size.w, size.h);
    const nc = this.makeCard(type, spot.x, spot.y, params);
    this.store.mutate((d) => {
      d.board.cards[nc.id] = nc;
      for (const k in d.board.edges) {
        const e = d.board.edges[k];
        if (e.from.card === id && e.from.port === port) e.from = { card: nc.id, port: "out" };
      }
      const eid = uid("e");
      d.board.edges[eid] = { id: eid, from: { card: id, port }, to: { card: nc.id, port: "src" } };
    });
    this.board.select(nc.id, false);
    return nc.id;
  }

  // ---------- baking: freeze a result into an animation document ----------
  framesToBake(id) {
    const card = this.store.cards[id];
    const def = card && nodeType(card.type);
    if (!def) return null;
    for (const o of def.outputs) {
      const v = this.engine.outputOf(id, o.name);
      if (v && v.kind === "frames") return v;
    }
    if (!def.evaluate) {
      for (const i of def.inputs) {
        const v = this.engine.input(id, i.name);
        if (v && v.kind === "frames") return v;
      }
    }
    return null;
  }

  canBake(id) {
    const card = this.store.cards[id];
    const def = card && nodeType(card.type);
    if (!def || card.type === "animation") return false;
    return def.outputs.some((o) => outputKinds(def, o.name).includes("frames")) || (!def.evaluate && def.inputs.some((i) => i.accepts.includes("frames")));
  }

  async bake(id) {
    const v = this.framesToBake(id);
    if (!v || !v.frames.length) { this.toast("这个节点现在还没有可烘焙的序列帧。", "warn"); return; }
    const card = this.store.cards[id];
    const def = nodeType(card.type);
    this.toast("正在烘焙 " + v.frames.length + " 帧…");
    try {
      const assets = [];
      for (const f of v.frames) assets.push(await putCanvasAsset(this.store.projectId, f.canvas));
      const s = this.imageCardSize(v.w, v.h);
      const size = { w: Math.max(240, s.w), h: s.h + 10 };
      const at = this.freeSpot(card.x + card.w + 80, card.y, size.w, size.h);
      this.addCard("animation", at.x, at.y, {
        w: v.w, h: v.h, fps: v.fps || 12,
        layers: [{ id: "L1", name: "图层 1", visible: true, opacity: 100 }],
        frames: assets.map((a, i) => ({ id: "F" + (i + 1), duration: v.frames[i].duration || null, cels: { L1: a } })),
        palette: [],
      }, { size, title: (card.title || def.title) + " · 动画", select: true });
      this.toast("已烘焙为动画卡片，双击它可以打开像素编辑器。", "ok");
    } catch (err) {
      this.toast("烘焙失败：" + err.message, "error");
    }
  }

  // ---------- the classic pipeline, as nodes ----------
  buildPipeline(imageId) {
    const img = this.store.cards[imageId];
    if (!img) return;
    const steps = [
      ["removeBg"],
      ["depixel", { bypass: true }],
      ["slice"],
      ["align", { bypass: true }],
      ["recolor"],
    ];
    const gap = 70;
    let x = img.x + img.w + gap;
    const y = img.y;
    const made = [];
    let prev = { card: imageId, port: "out" };
    this.store.mutate((d) => {
      const link = (from, toCard) => {
        const id = uid("e");
        d.board.edges[id] = { id, from, to: { card: toCard, port: "src" } };
      };
      for (const [type, extra] of steps) {
        const c = this.makeCard(type, x, y, null, extra);
        d.board.cards[c.id] = c;
        link(prev, c.id);
        made.push(c.id);
        prev = { card: c.id, port: "out" };
        x += c.w + gap;
      }
      const pv = this.makeCard("preview", x, y);
      const ex = this.makeCard("export", x, y + pv.h + 40);
      d.board.cards[pv.id] = pv;
      d.board.cards[ex.id] = ex;
      link(prev, pv.id);
      link(prev, ex.id);
      made.push(pv.id, ex.id);
    });
    this.board.setSelection([imageId, ...made]);
    this.board.fitView([imageId, ...made]);
    this.toast("已生成流程。「完美像素」和「主体对齐」默认旁路，需要时点卡片标题栏的「旁路」开启。", "ok");
  }

  // ---------- menus ----------
  showMenu(x, y, items) { return showMenu(x, y, items); }

  // opts: { from, to, onPick }
  showAddMenu(x, y, opts = {}) {
    let types = allNodeTypes();
    let title = "添加节点";
    if (opts.from) {
      const c = this.store.cards[opts.from.card];
      const kinds = outputKinds(nodeType(c.type), opts.from.port);
      types = types.filter((t) => t.inputs.some((i) => i.accepts.some((k) => kinds.includes(k))));
      title = "接到下一步";
    } else if (opts.to) {
      const c = this.store.cards[opts.to.card];
      const acc = inputAccepts(nodeType(c.type), opts.to.port);
      types = types.filter((t) => t.outputs.some((o) => outputKinds(t, o.name).some((k) => acc.includes(k))));
      title = "接到上一步";
    }
    showAddMenu(x, y, types, CATEGORIES, opts.onPick, title);
  }

  cardMenu(id) {
    const card = this.store.cards[id];
    const def = nodeType(card.type);
    const ids = this.board.selectedIds();
    const items = [];
    if (card.type === "image") {
      items.push({ label: "生成标准处理流程", action: () => this.buildPipeline(id) });
      items.push({ label: "切成动画…", hint: "整图多帧", action: () => {
        const v = this.engine.outputOf(id, "out");
        if (!v) { this.toast("图片还没加载好。", "warn"); return; }
        this.sheetToAnimation(v.canvas, card.params.name || card.title || "序列帧", this.freeSpot(card.x + card.w + 80, card.y, 260, 280));
      } });
    }
    if (def && def.open) items.push({ label: "打开编辑器", action: () => def.open(this.board.ctxOf(id)) });
    if (this.canBake(id)) items.push({ label: "烘焙为动画卡片", action: () => this.bake(id) });
    if (card.type === "animation") items.push({ label: "分层导出（Godot）…", action: () => import("./godot/layers.js").then((m) => m.openLayeredExport(this, id)) });
    if (card.type === "animation" || this.canBake(id)) {
      const chars = Object.values(this.store.cards).filter((c) => c.type === "character");
      items.push({ label: "加入角色…", action: () => {
        const r = this.board.cards.get(id).el.getBoundingClientRect();
        showMenu(r.right + 6, r.top, [
          { heading: "加入哪个角色" },
          ...chars.map((c) => ({ label: c.title || "角色", hint: (c.params.anims || []).length + " 组", action: () => this.addToCharacter(id, c.id) })),
          { label: "新建角色", action: () => this.addToCharacter(id, null) },
        ]);
      } });
    }
    if (card.type === "reframe") {
      items.push({ label: "一键裁掉空白", action: () => trimBlank(this.board.ctxOf(id)) });
    } else if (def && def.outputs.some((o) => outputKinds(def, o.name).some((k) => k === "image" || k === "frames"))) {
      items.push({ label: "一键裁掉空白", hint: "插入画框调整", action: () => {
        this.insertAfter(id, "reframe", TRIM);
        this.toast("已在后面插入「画框调整」，裁到所有帧的共同内容范围。原来的下游连线已改接到它后面。", "ok");
      } });
    }
    if (def && def.evaluate && def.inputs.length && def.outputs.length) {
      items.push({ label: card.bypass ? "取消旁路" : "旁路（跳过这一步）", action: () => this.store.mutate((d) => { d.board.cards[id].bypass = !card.bypass; }) });
    }
    if (items.length) items.push("-");
    items.push(
      { label: "重命名", hint: "双击标题", action: () => this.board.renameCard(id) },
      { label: "复制", hint: "Ctrl+D", action: () => this.board.duplicate() },
    );
    if (ids.length > 1) items.push({ label: "用分组框起来", action: () => this.groupSelection() });
    items.push(
      { label: "断开所有连线", action: () => this.store.mutate((d) => {
        for (const k in d.board.edges) { const e = d.board.edges[k]; if (e.from.card === id || e.to.card === id) delete d.board.edges[k]; }
      }) },
      "-",
      { label: ids.length > 1 ? "删除选中的 " + ids.length + " 个" : "删除", hint: "Delete", danger: true, action: () => this.board.deleteSelection() },
    );
    return items;
  }

  boardMenu(at, cx, cy) {
    return [
      { label: "添加节点…", hint: "双击空白", action: () => this.showAddMenu(cx, cy, { onPick: (t) => this.addCard(t, at.x, at.y) }) },
      { label: "添加图片…", action: () => this.pickFile("image/*").then((f) => f && this.addFiles([f], at)) },
      { label: "导入序列帧…", hint: "多图 / 文件夹 / 动图", action: () => this.importMenu(cx, cy, at) },
      { label: "添加便签", action: () => this.addCard("note", at.x, at.y) },
      { label: "添加分组框", action: () => this.addCard("group", at.x, at.y) },
      "-",
      { label: "粘贴", hint: "Ctrl+V", disabled: !this.board.clip, action: () => this.board.paste(at) },
      { label: "全选", hint: "Ctrl+A", action: () => this.board.setSelection(Object.keys(this.store.cards)) },
      { label: "适应视图", hint: "F", action: () => this.board.fitView() },
    ];
  }

  clearModes() {
    closeMenu();
    for (const e of this.board.cards.values()) {
      if (e.ctx.local.mode) e.ctx.setLocal({ mode: null });
    }
  }

  // ---------- pixel editor (phase 2) ----------
  openEditor(id) {
    if (this.modalOpen()) return;
    import("./editor/editor.js")
      .then((m) => m.openEditor(this, id))
      .catch((err) => { console.error(err); this.toast("编辑器打开失败：" + err.message, "error"); });
  }

  // ---------- characters (phase 3) ----------
  openTuner(id) {
    if (this.modalOpen()) return;
    import("./tuner/tuner.js")
      .then((m) => m.openTuner(this, id))
      .catch((err) => { console.error(err); this.toast("调帧台打开失败：" + err.message, "error"); });
  }

  // add the frames of card `srcId` as a new animation of character `charId`
  // (or of a new character placed next to it), calibrated to the shared origin
  addToCharacter(srcId, charId) {
    const src = this.store.cards[srcId];
    if (!src) return;
    if (!charId) {
      const def = nodeType("character");
      const at = this.freeSpot(src.x + src.w + 80, src.y, def.size.w, def.size.h);
      charId = this.addCard("character", at.x, at.y, null, { title: "角色", select: false });
    }
    const name = src.title || (nodeType(src.type) || {}).title || "动画";
    const a = newAnim(uid("A"), name, { card: srcId });
    const char = normalizeCharacter(this.store.cards[charId].params);
    const pos = calibrate(char, a, resolveSources(this, { anims: [a] }));
    if (pos) { a.transform.x = pos.x; a.transform.y = pos.y; }
    this.store.mutate((d) => {
      const p = d.board.cards[charId].params;
      Object.assign(p, normalizeCharacter(p));
      p.anims.push(a);
    }, { coalesce: "add-" + charId });
    this.board.select(charId, false);
    this.toast("已把「" + name + "」加入角色「" + (this.store.cards[charId].title || "角色") + "」，脚底已对齐原点。双击角色卡片进入调帧台。", "ok");
  }

  modalOpen() { return !!document.querySelector(".modal-root.open, .editor-root.open"); }

  // ---------- chrome ----------
  toast(msg, tone) {
    const t = el("div", { class: "toast" + (tone ? " " + tone : "") }, msg);
    this.toasts.append(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, tone === "error" ? 6000 : 3200);
    return t;
  }

  applyTheme(t, persist = true) {
    document.documentElement.dataset.theme = t;
    lsSet(THEME, t);
    if (persist) this.saveSetting({ theme: t });
  }

  buildTopbar() {
    const bar = document.getElementById("topbar");
    this.projectBtnLabel = el("span", { class: "proj-name" }, "…");
    const projBtn = this.projectBtn = el("button", { class: "proj-btn", title: "切换 / 新建项目", onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.showProjectMenu(r.left, r.bottom + 6);
    } }, this.projectBtnLabel, el("span", { class: "caret" }, "▾"));
    projBtn.addEventListener("dblclick", () => this.renameProject());

    const save = el("span", { class: "save-state mono" });
    const saveText = { saved: "已保存", dirty: "未保存", saving: "保存中…", error: "保存失败" };
    this.store.on("save", (s) => {
      save.textContent = saveText[s] || s;
      save.dataset.state = s;
      save.title = s === "error" ? this.store.saveError || "" : "改动会自动保存到 " + (this.store.projectPath || "项目文件夹") + "（Ctrl+S 立即保存）";
    });
    this.store.on("meta", () => this.updateProjectName());
    this.store.on("reset", () => this.updateProjectName());

    const undo = el("button", { class: "icon-btn", title: "撤销 (Ctrl+Z)", onclick: () => this.store.undo() }, "↶");
    const redo = el("button", { class: "icon-btn", title: "重做 (Ctrl+Y)", onclick: () => this.store.redo() }, "↷");
    const syncHist = () => { undo.disabled = !this.store.canUndo(); redo.disabled = !this.store.canRedo(); };
    this.store.on("change", syncHist);
    this.store.on("reset", syncHist);

    const theme = el("button", { class: "icon-btn", title: "切换深色 / 浅色", onclick: () => this.applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark") }, "◑");
    const help = el("button", { class: "icon-btn", title: "快捷键", onclick: () => this.showHelp() }, "?");
    const toggleInsp = el("button", { class: "icon-btn", title: "显示 / 隐藏属性面板", onclick: () => {
      // on narrow windows the panel is an overlay that starts hidden
      const narrow = window.matchMedia("(max-width: 900px)").matches;
      if (narrow) document.getElementById("app").classList.toggle("show-inspector");
      else this.inspBar.toggle();
    } }, "▤");

    bar.append(
      el("div", { class: "brand" }, el("span", { class: "brand-mark" }), el("span", { class: "brand-name" }, "光台"), el("span", { class: "brand-sub" }, "序列帧工作室")),
      projBtn, save,
      el("span", { class: "spacer" }),
      undo, redo,
      el("span", { class: "divider" }),
      theme, help, toggleInsp,
    );
  }

  // the node bar and the 属性 panel: drag their inner edge to resize, fold them
  // away (ui/dock.js)
  buildDock() {
    const pal = document.getElementById("palette"), insp = document.getElementById("inspector");
    this.palBar = dockSplit(pal, { id: "palette", axis: "x", after: false, def: 80, min: 52, max: () => 240, label: "节点栏" });
    this.inspBar = dockSplit(insp, {
      id: "inspector", axis: "x", after: true, def: 320, min: 240, max: () => Math.max(260, window.innerWidth * 0.5), label: "属性面板", cls: "insp-split",
      onToggle: (folded) => this.saveSetting({ inspectorHidden: folded }),
    });
    pal.after(this.palBar);
    insp.before(this.inspBar);
  }

  buildPalette() {
    const pal = document.getElementById("palette");
    pal.append(el("button", { class: "pal-item accent", title: "添加图片（也可以直接拖文件到画布）", onclick: () => this.addImageFromPicker() },
      el("span", { class: "pal-ico" }, "＋"), el("span", { class: "pal-label" }, "图片")));
    pal.append(el("button", { class: "pal-item accent", title: "导入序列帧：多张图片、整个文件夹，或 GIF / WebP / APNG 动图，合成一个动画", onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      this.importMenu(r.right + 6, r.top);
    } }, el("span", { class: "pal-ico" }, "⇶"), el("span", { class: "pal-label" }, "序列帧")));
    for (const cat of CATEGORIES) {
      pal.append(el("div", { class: "pal-cat" }, cat));
      for (const t of allNodeTypes().filter((d) => d.category === cat)) {
        const item = el("button", {
          class: "pal-item", draggable: "true", title: t.title + "：" + (t.help || "") + "\n（点击添加到视图中央，或拖到画布上）",
          onclick: () => this.addCard(t.type, null, null, null, { select: true }),
        }, el("span", { class: "pal-ico" }, t.icon), el("span", { class: "pal-label" }, t.title));
        item.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("application/x-guangtai-node", t.type);
          e.dataTransfer.effectAllowed = "copy";
        });
        pal.append(item);
      }
    }
  }

  showHelp() {
    const close = () => root.remove();
    const root = el("div", { class: "modal-root open", onclick: (e) => { if (e.target === root) close(); } },
      el("div", { class: "modal" },
        el("div", { class: "modal-head" }, el("span", null, "快捷操作"), el("button", { class: "icon-btn", onclick: close }, "×")),
        el("dl", { class: "shortcuts" }, ...SHORTCUTS.flatMap(([k, v]) => [el("dt", { class: "mono" }, k), el("dd", null, v)])),
      ));
    root.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    document.body.append(root);
    root.tabIndex = -1;
    root.focus();
  }

  bindGlobalKeys() {
    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const t = e.target;
      const editing = t && t.closest && t.closest("input, textarea, [contenteditable='true']");
      const k = e.key.toLowerCase();
      if (k === "s") {
        e.preventDefault();
        this.store.flushSave();
        this.store.saveNow().then(() => this.store.saveState === "saved" && this.toast("已保存到 " + this.store.projectPath, "ok"));
        return;
      }
      if (k === "o" && !this.modalOpen()) { e.preventDefault(); this.openProjectDialog(); return; }
      if (editing || this.modalOpen()) return;
      if (k === "z" && !e.shiftKey) { e.preventDefault(); this.store.undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); this.store.redo(); }
    });
    window.addEventListener("paste", (e) => {
      const t = e.target;
      if (t && t.closest && t.closest("input, textarea, [contenteditable='true']")) return;
      if (this.modalOpen()) return;
      const items = [...(e.clipboardData ? e.clipboardData.items : [])];
      const img = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (img) {
        e.preventDefault();
        const f = img.getAsFile();
        this.addImageBlob(f, "粘贴的图片").catch((err) => this.toast(err.message, "error"));
        return;
      }
      if (this.board.clip) { e.preventDefault(); this.board.paste(); }
    });
  }
}

const app = new App();
window.__app = app; // handy from the devtools console
app.start();
