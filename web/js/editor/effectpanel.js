// 效果调整: the effect controls the attack trail panel (trailmode.js) and the
// 拖尾笔 panel (editor.js) share — 头部弧度, 尾部, and for glow styles the
// handful of controls by where on the effect they act, each with its layers
// folded under 「细节 ▸」. Each panel keeps its settings its own way; it hands
// over how to read and write them:
//   ui = { P, get(key), live({ key: value, ... }), end(), isOpen(id), toggle(id), refresh() }
// get gives a value in the attack trail's units (fade, taper, headArc 0..1;
// the rest as the sliders show them); live sets some while a slider moves,
// end when it is let go; toggle opens or shuts a ▸ group (and redraws);
// refresh (optional) redraws the panel after a choice.
import { el } from "../core/util.js";

// the row builders: a slider, a choice, a row with its parts under ▸, a heading
export function controlKit(ui) {
  const slider = (label, key, min, max, scale, unit, into = ui.P, title) => {
    const v = ui.get(key) ?? 0;
    const val = el("span", { class: "mono tm-num" }, Math.round(v * scale) + unit);
    const r = el("input", { type: "range", min, max, value: Math.round(v * scale), title });
    r.oninput = () => { ui.live({ [key]: +r.value / scale }); val.textContent = r.value + unit; };
    r.onchange = () => ui.end();
    const row = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, label), r, val);
    into.append(row);
    return row;
  };
  const choose = (label, key, options, def, into = ui.P, title) => {
    const cur = String(ui.get(key) ?? def);
    const sel = el("select", { class: "ed-select", title }, ...options.map(([v, n]) => el("option", { value: String(v), selected: cur === String(v) }, n)));
    sel.onchange = () => { const v = sel.value; ui.live({ [key]: v === "true" ? true : v === "false" ? false : v }); ui.end(); if (ui.refresh) ui.refresh(); };
    into.append(el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, label), sel));
  };
  // a control with its fine-grained parts folded under it: ▸ opens them, and
  // they stay open while you work
  const group = (id, row, details) => {
    const open = ui.isOpen(id);
    row.classList.add("has-more");
    row.append(el("button", {
      class: "tm-more" + (open ? " on" : ""), title: open ? "收起细节" : "展开细节调整",
      onclick: () => ui.toggle(id),
    }, open ? "细节 ▾" : "细节 ▸"));
    if (open) { const box = el("div", { class: "tm-details" }); ui.P.append(box); details(box); }
  };
  const heading = (label) => {
    const row = el("div", { class: "tm-row tm-group-head" }, el("span", { class: "tm-label" }, label), el("span"), el("span"));
    ui.P.append(row);
    return row;
  };
  return { slider, choose, group, heading };
}

// 头部弧度 (not for 两头尖) and 尾部: one slider for the tail — a longer,
// softer tail is also a thinner one; its two parts can be set apart under ▸
export function headTailControls(kit, ui, shape = "head") {
  if (shape !== "crescent") kit.slider("头部弧度", "headArc", 0, 100, 100, "%", ui.P, "刀尖一端圆润地鼓出去多少：0 = 平头");
  const tv = Math.round((ui.get("fade") ?? 0.45) * 100);
  const tr = el("input", { type: "range", min: 0, max: 100, value: tv, title: "尾巴拖多长、多细：越大尾巴越长、渐隐越慢、尾端越细" });
  const tvv = el("span", { class: "mono tm-num" }, tv + "%");
  tr.oninput = () => {
    const v = +tr.value / 100;
    ui.live({ fade: v, taper: Math.max(0.05, 0.6 - 0.55 * v) });
    tvv.textContent = tr.value + "%";
  };
  tr.onchange = () => ui.end();
  const row = el("div", { class: "tm-row" }, el("span", { class: "tm-label" }, shape === "crescent" ? "两端" : "尾部"), tr, tvv);
  ui.P.append(row);
  kit.group("tail", row, (box) => {
    kit.slider("渐隐长度", "fade", 0, 100, 100, "%", box);
    if (shape === "head") kit.slider("尾端收窄", "taper", 0, 100, 100, "%", box);
  });
}

// the same controls for every glow style, by where on the effect they act;
// each scales its layers (100 % = the preset as designed), and ▸ opens the
// layers themselves for fine tuning
export function glowControls(kit, ui, pixelGlow = false) {
  const { slider, group, heading } = kit;
  group("g-edge", slider("刀锋", "mixEdge", 0, 200, 1, "%"), (box) => {
    slider("刀芯", "core", 0, 100, 1, "%", box);
    slider("结晶", "crystal", 0, 100, 1, "%", box);
    slider("光芒", "rays", 0, 100, 1, "%", box);
    slider("阴影", "shadow", 0, 100, 1, "%", box);
  });
  group("g-body", slider("刀身", "mixBody", 0, 200, 1, "%"), (box) => {
    slider("光丝", "strands", 0, 160, 1, " 条", box);
    slider("流体", "flow", 0, 100, 1, "%", box);
    slider("火舌", "flames", 0, 100, 1, "%", box);
    slider("闪电", "bolts", 0, 100, 1, "%", box);
    slider("速度线", "speedLines", 0, 100, 1, "%", box);
    slider("风刃", "curls", 0, 100, 1, "%", box);
    slider("锯齿", "serrate", 0, 100, 1, "%", box);
    slider("水纹", "caustic", 0, 100, 1, "%", box);
  });
  group("g-glow", slider("光晕", "mixGlow", 0, 200, 1, "%"), (box) => {
    slider("辉光", "glow", 0, 100, 1, "%", box);
    slider("残影", "haze", 0, 100, 1, "%", box);
  });
  group("g-fx", slider("粒子", "mixFx", 0, 200, 1, "%"), (box) => {
    slider("星光", "sparkles", 0, 60, 1, " 颗", box);
    slider("星光大小", "sparkleSize", 1, 20, 1, "", box);
    slider("粉尘", "dust", 0, 100, 1, "%", box);
    slider("雪花", "snow", 0, 100, 1, "%", box);
    slider("余烬", "embers", 0, 100, 1, "%", box);
    slider("碎片", "shards", 0, 100, 1, "%", box);
    slider("飞溅", "splatter", 0, 100, 1, "%", box);
    slider("气泡", "bubbles", 0, 100, 1, "%", box);
    slider("岩石", "rocks", 0, 100, 1, "%", box);
    slider("叶片", "leaves", 0, 100, 1, "%", box);
    slider("水滴", "drops", 0, 100, 1, "%", box);
  });
  group("g-burst", slider("爆发", "mixBurst", 0, 200, 1, "%"), (box) => {
    slider("起手闪光", "flash", 0, 100, 1, "%", box);
    slider("命中爆点", "impact", 0, 100, 1, "%", box);
  });
  if (!pixelGlow) slider("平涂", "cel", 0, 100, 1, "%");
  group("g-more", heading("其他细节"), (box) => {
    slider("侵蚀", "erode", 0, 100, 1, "%", box);
    slider("撕裂", "tear", 0, 100, 1, "%", box);
    slider("尾部变色", "tailTint", 0, 100, 1, "%", box);
    if (!pixelGlow) slider("平涂描边", "celOutline", 0, 100, 1, "%", box);
  });
  ui.P.append(el("p", { class: "ed-hint" }, "这些总控所有光效通用，按作用的位置分，100% 是预设原样，换预设时保留。"));
}
