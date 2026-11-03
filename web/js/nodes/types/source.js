import { defineNode } from "../registry.js";
import { makeStage } from "../view.js";
import { imageValue } from "../data.js";

defineNode({
  type: "image",
  title: "素材图",
  category: "素材",
  icon: "▣",
  help: "一张图片：可直接去背景、调色、导出透明 PNG，或双击生成可编辑副本进入像素编辑器。拖入文件或 Ctrl+V 粘贴即可导入。序列帧整图也可接切片节点。",
  outputs: [{ name: "out", label: "图像", kind: "image" }],
  size: { w: 300, h: 260 },
  defaults: () => ({ asset: null, name: "" }),

  async evaluate(p, _inputs, ctx) {
    if (!p.asset) return { info: { waiting: "还没有图片" } };
    const canvas = await ctx.asset(p.asset);
    return { outputs: { out: imageValue(canvas) }, info: { text: canvas.width + " × " + canvas.height } };
  },

  mount(ctx) {
    const stage = makeStage();
    ctx.body.append(stage.el);
    return {
      render() {
        const v = ctx.output("out");
        if (v) stage.show(v.canvas, null, v.ver);
        else stage.message(ctx.params().asset ? "读取中…" : "在右侧面板选择图片");
      },
    };
  },

  open(ctx) { ctx.app.openEditor(ctx.id); },

  inspector(ctx, f) {
    f.text("名称", "name");
    f.buttons(["更换图片…", async () => {
      const r = await ctx.app.pickAndUploadImage();
      if (r) ctx.set({ asset: r.asset, name: r.name });
    }, { primary: true }]);
    f.readout(() => {
      const v = ctx.output("out");
      return v ? [["尺寸", v.canvas.width + " × " + v.canvas.height]] : null;
    });
    f.buttons(["生成单图处理流程", () => ctx.app.buildPipeline(ctx.id, true), { primary: true }]);
    f.hint("双击图片可创建副本进入像素编辑器。单图处理流程接上去背景 → 完美像素 → 调色 → 预览 / 导出 PNG；序列帧整图可右键生成标准处理流程。");
  },
});
