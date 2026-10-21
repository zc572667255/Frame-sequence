import { defineNode } from "../registry.js";
import { makeStage } from "../view.js";
import { imageValue } from "../data.js";

defineNode({
  type: "image",
  title: "素材图",
  category: "素材",
  icon: "▣",
  help: "一张图片：序列帧整图、参考图或单帧。把图片文件直接拖到画布上、或 Ctrl+V 粘贴，都会自动创建。",
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
    f.hint("右键卡片 →「生成标准处理流程」可一键接上 去背景 → 完美像素 → 切片 → 对齐 → 调色 → 预览 / 导出。");
  },
});
