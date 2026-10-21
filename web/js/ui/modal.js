// A small modal dialog. Returns { root, body, close }.
import { el } from "../core/util.js";

export function openModal(title, opts = {}) {
  const body = el("div", { class: "modal-body" });
  const foot = el("div", { class: "modal-foot" });
  const close = () => {
    root.remove();
    opts.onClose && opts.onClose();
  };
  const root = el("div", { class: "modal-root open", tabindex: "-1" },
    el("div", { class: "modal" + (opts.wide ? " wide" : "") },
      el("div", { class: "modal-head" }, el("span", null, title), el("button", { class: "icon-btn", title: "关闭", onclick: close }, "×")),
      body, foot));
  root.addEventListener("pointerdown", (e) => { if (e.target === root) close(); });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    // keep board shortcuts (Delete, Ctrl+Z…) from firing behind the dialog
    e.stopPropagation();
  });
  for (const b of opts.buttons || []) {
    foot.append(el("button", {
      class: "btn" + (b.primary ? " primary" : "") + (b.danger ? " danger" : ""),
      onclick: async () => { if ((await b.action()) !== false) close(); },
    }, b.label));
  }
  if (!foot.children.length) foot.remove();
  document.body.append(root);
  root.focus();
  return { root, body, close };
}
