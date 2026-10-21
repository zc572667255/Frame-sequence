// Node type registry.
//
// A node type is a plain object:
//   type, title, category, icon, help
//   inputs:  [{ name, label, accepts: ["image" | "frames"] }]
//   outputs: [{ name, label, kind: "image" | "frames" | "same" }]   ("same" mirrors input 0)
//   size: { w, h }, minSize?
//   defaults(): params
//   evaluate?(params, inputs, ctx) -> { outputs, info, view }    (async ok)
//   mount?(ctx) -> { render(), destroy?(), onResult?() }          card body
//   inspector?(ctx, form) -> { onResult?() }                      side panel
//   headerTools?(ctx) -> Element[]                                 buttons in the card header
//
// Values flowing along edges:
//   { kind: "image",  canvas }
//   { kind: "frames", w, h, frames: [{ canvas, index, duration? }], fps? }
// Engine stamps each with a unique `ver` so downstream caches can key on it.

const types = new Map();

export function defineNode(def) {
  def.inputs = def.inputs || [];
  def.outputs = def.outputs || [];
  def.size = def.size || { w: 260, h: 220 };
  types.set(def.type, def);
  return def;
}

export const nodeType = (t) => types.get(t);
export const allNodeTypes = () => [...types.values()];

export const CATEGORIES = ["素材", "处理", "输出", "白板"];

export const KIND_LABEL = { image: "图像", frames: "序列帧", same: "同输入" };

// what an output can produce, for connect-time checks; "same" can be either
export function outputKinds(def, portName) {
  const p = def.outputs.find((o) => o.name === portName);
  if (!p) return [];
  return p.kind === "same" ? ["image", "frames"] : [p.kind];
}

export function inputAccepts(def, portName) {
  const p = def.inputs.find((i) => i.name === portName);
  return p ? p.accepts : [];
}

export function compatible(fromDef, fromPort, toDef, toPort) {
  const kinds = outputKinds(fromDef, fromPort);
  const acc = inputAccepts(toDef, toPort);
  return kinds.some((k) => acc.includes(k));
}
