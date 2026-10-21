// The right-hand panel: parameters of the selected card, or a project overview.
import { el } from "../core/util.js";
import { makeForm } from "./form.js";
import { nodeType } from "../nodes/registry.js";

export const SHORTCUTS = [
  ["拖动空白处", "框选"],
  ["空格 + 拖动 / 中键拖动", "平移画布"],
  ["滚轮", "以光标为中心缩放"],
  ["双击空白处", "添加节点"],
  ["从输出端口拖到空白处", "添加并自动连上下一步"],
  ["双击卡片标题", "重命名"],
  ["Shift / Ctrl + 点击", "多选"],
  ["Delete", "删除选中的卡片或连线"],
  ["Ctrl + Z / Ctrl + Y", "撤销 / 重做"],
  ["Ctrl + S", "立即保存（平时会自动保存）"],
  ["Ctrl + O", "打开项目"],
  ["Ctrl + C / V / D", "复制 / 粘贴 / 原地复制"],
  ["Ctrl + V（剪贴板里是图片）", "粘贴为素材图"],
  ["F", "适应视图（有选中时只看选中的）"],
  ["Ctrl + 0", "缩放到 100%"],
  ["Esc", "退出取样 / 画笔等模式"],
];

export class Inspector {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.current = null;
    this.form = null;
    this.handle = null;
    const { board, store, engine } = app;
    board.on("selection", () => this.rebuild());
    board.on("local", (id) => { if (id === this.current) this.sync(); });
    store.on("reset", () => this.rebuild());
    store.on("change", () => this.sync());
    store.on("meta", () => { if (!this.current) this.rebuild(); });
    engine.on("result", (id) => {
      if (id !== this.current) return;
      this.sync();
      this.handle && this.handle.onResult && this.handle.onResult();
    });
  }

  sync() {
    if (this.form) this.form.sync();
    if (this.headSync) this.headSync();
  }

  rebuild() {
    const { board, store } = this.app;
    const ids = board.selectedIds();
    this.form = null;
    this.handle = null;
    this.headSync = null;
    this.current = null;
    this.root.replaceChildren();
    this.root.scrollTop = 0;
    if (!store.doc) return;
    if (ids.length === 1) this.buildCard(ids[0]);
    else if (ids.length > 1) this.buildMulti(ids);
    else this.buildProject();
  }

  buildCard(id) {
    const { board, store } = this.app;
    const ctx = board.ctxOf(id);
    if (!ctx) return;
    this.current = id;
    const def = ctx.def;
    const card = ctx.card();

    const titleIn = el("input", { class: "insp-title", type: "text", placeholder: def.title, value: card.title || "" });
    titleIn.addEventListener("input", () => {
      store.mutate((d) => { const c = d.board.cards[id]; if (c) c.title = titleIn.value.trim(); }, { coalesce: id + ":title" });
    });
    titleIn.addEventListener("keydown", (e) => { if (e.key === "Enter") titleIn.blur(); });

    const status = el("div", { class: "insp-status" });
    this.headSync = () => {
      const c = ctx.card();
      if (!c) return;
      if (document.activeElement !== titleIn) titleIn.value = c.title || "";
      const r = ctx.result();
      let text = "", tone = "";
      if (r && r.busy) { text = "处理中…"; tone = "busy"; }
      else if (r && r.error) { text = r.error; tone = "error"; }
      else if (r && r.info && r.info.waiting) { text = r.info.waiting; tone = "dim"; }
      else if (r && r.info && r.info.text) text = r.info.text;
      status.textContent = text;
      status.dataset.tone = tone;
      status.style.display = text ? "" : "none";
    };

    this.root.append(
      el("div", { class: "insp-head" },
        el("span", { class: "insp-ico" }, def.icon || "•"),
        el("div", { class: "insp-head-text" }, titleIn, el("div", { class: "insp-type" }, def.title + (def.category ? " · " + def.category : ""))),
      ),
      def.help ? el("p", { class: "insp-help" }, def.help) : null,
      status,
    );

    const body = el("div", { class: "insp-body" });
    this.root.append(body);
    const form = makeForm(ctx, body);
    this.form = form;
    try {
      this.handle = def.inspector ? def.inspector(ctx, form) || null : null;
    } catch (err) {
      console.error(err);
      body.append(el("p", { class: "f-status", dataset: { tone: "error" } }, "面板加载失败：" + err.message));
    }

    const actions = makeForm(ctx, el("div", { class: "insp-actions" }));
    this.root.append(actions.el);
    if (def.evaluate && def.inputs.length && def.outputs.length) {
      actions.button("旁路（跳过这一步）", () => store.mutate((d) => { const c = d.board.cards[id]; if (c) c.bypass = !c.bypass; }), {
        sync: (b) => { const c = ctx.card(); b.classList.toggle("primary", !!(c && c.bypass)); b.textContent = c && c.bypass ? "已旁路 · 点击恢复" : "旁路（跳过这一步）"; },
      });
    }
    if (this.app.canBake(id)) actions.button("烘焙为动画卡片", () => this.app.bake(id), { title: "把当前结果的每一帧存进项目，得到可以逐帧编辑的动画" });
    actions.buttons(
      ["复制", () => board.duplicate()],
      ["删除", () => board.deleteSelection(), { danger: true }],
    );
    // the action buttons' sync functions live in their own form
    const prevSync = this.headSync;
    this.headSync = () => { prevSync(); actions.sync(); };
    this.sync();
  }

  buildMulti(ids) {
    const { board, store } = this.app;
    const types = new Map();
    for (const id of ids) {
      const c = store.cards[id];
      if (c) types.set(c.type, (types.get(c.type) || 0) + 1);
    }
    this.root.append(
      el("div", { class: "insp-head" }, el("span", { class: "insp-ico" }, "⧉"),
        el("div", { class: "insp-head-text" }, el("div", { class: "insp-title static" }, "已选 " + ids.length + " 个卡片"))),
      el("div", { class: "insp-body" },
        el("div", { class: "f-readout mono" }, ...[...types].map(([t, n]) =>
          el("span", null, el("span", { class: "k" }, (nodeType(t) || {}).title || t), el("span", { class: "v" }, "× " + n)))),
        el("div", { class: "f-buttons" },
          el("button", { class: "btn", onclick: () => this.app.groupSelection() }, "用分组框起来"),
          el("button", { class: "btn", onclick: () => board.fitView(ids) }, "聚焦到选中"),
          el("button", { class: "btn", onclick: () => board.duplicate() }, "复制"),
          el("button", { class: "btn danger", onclick: () => board.deleteSelection() }, "删除"),
        ),
      ),
    );
  }

  buildProject() {
    const { store } = this.app;
    const doc = store.doc;
    const nCards = Object.keys(doc.board.cards).length, nEdges = Object.keys(doc.board.edges).length;
    this.root.append(
      el("div", { class: "insp-head" }, el("span", { class: "insp-ico" }, "◇"),
        el("div", { class: "insp-head-text" }, el("div", { class: "insp-title static" }, doc.name), el("div", { class: "insp-type" }, "项目"))),
      el("div", { class: "insp-body" },
        el("div", { class: "f-readout mono" },
          el("span", null, el("span", { class: "k" }, "卡片"), el("span", { class: "v" }, String(nCards))),
          el("span", null, el("span", { class: "k" }, "连线"), el("span", { class: "v" }, String(nEdges))),
          el("span", { class: "span2" }, el("span", { class: "k" }, "保存位置（自动保存）"), el("span", { class: "v" }, store.projectPath || "–")),
        ),
        el("div", { class: "f-buttons" },
          el("button", { class: "btn", onclick: () => this.app.revealCurrent() }, "在资源管理器中显示"),
          el("button", { class: "btn", onclick: () => this.app.saveAsDialog() }, "另存为…"),
          el("button", { class: "btn", onclick: () => this.app.backupsDialog() }, "历史版本…"),
        ),
        el("div", { class: "f-buttons" },
          el("button", { class: "btn primary", onclick: () => this.app.addImageFromPicker() }, "添加图片…"),
          el("button", { class: "btn", onclick: () => this.app.addCard("note", null, null, null, { select: true }) }, "添加便签"),
        ),
        el("p", { class: "f-hint" }, "常用流程：拖入一张序列帧整图 → 右键它选「生成标准处理流程」。每个处理节点都可以单独调参、旁路或删掉，预览实时更新。"),
        el("div", { class: "f-section" },
          el("div", { class: "f-section-title" }, "快捷操作"),
          el("dl", { class: "shortcuts" }, ...SHORTCUTS.flatMap(([k, v]) => [el("dt", { class: "mono" }, k), el("dd", null, v)])),
        ),
      ),
    );
  }
}
