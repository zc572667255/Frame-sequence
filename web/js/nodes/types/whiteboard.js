// Free-form whiteboard cards: sticky notes and group frames. No ports.
import { defineNode } from "../registry.js";
import { el } from "../../core/util.js";
import { toolButton } from "../view.js";

const NOTE_COLORS = ["yellow", "pink", "blue", "green", "gray"];

defineNode({
  type: "note",
  title: "便签",
  category: "白板",
  icon: "✎",
  help: "随手记：动作说明、参数备忘、待办。",
  size: { w: 220, h: 160 },
  minSize: { w: 120, h: 70 },
  defaults: () => ({ text: "", color: "yellow" }),

  mount(ctx) {
    const area = el("textarea", { class: "note-text scroll-y", placeholder: "写点什么…", spellcheck: false });
    area.addEventListener("input", () => ctx.set({ text: area.value }, { coalesce: ctx.id + ":text" }));
    ctx.body.append(area);
    const colorBtn = toolButton("●", "换颜色", () => {
      const i = NOTE_COLORS.indexOf(ctx.params().color);
      ctx.set({ color: NOTE_COLORS[(i + 1) % NOTE_COLORS.length] });
    });
    ctx.tools.append(colorBtn);
    return {
      render() {
        const p = ctx.params();
        if (document.activeElement !== area && area.value !== (p.text || "")) area.value = p.text || "";
        ctx.cardEl.dataset.color = p.color || "yellow";
      },
    };
  },
});

defineNode({
  type: "group",
  title: "分组",
  category: "白板",
  icon: "▢",
  help: "把一组卡片框在一起。拖动分组的标题栏或空白处，框内的卡片会跟着一起移动。",
  size: { w: 520, h: 360 },
  minSize: { w: 160, h: 100 },
  defaults: () => ({ color: "violet" }),

  mount(ctx) {
    const colors = ["violet", "teal", "amber", "rose", "gray"];
    ctx.tools.append(toolButton("●", "换颜色", () => {
      const i = colors.indexOf(ctx.params().color);
      ctx.set({ color: colors[(i + 1) % colors.length] });
    }));
    return {
      render() { ctx.cardEl.dataset.color = ctx.params().color || "violet"; },
    };
  },
});
