// Context menus and the searchable "add node" picker.
import { el } from "../core/util.js";

let open = null;

export function closeMenu() {
  if (!open) return;
  open.remove();
  open = null;
  document.removeEventListener("pointerdown", onOutside, true);
  document.removeEventListener("keydown", onEsc, true);
}

function onOutside(e) {
  if (open && !open.contains(e.target)) closeMenu();
}
function onEsc(e) {
  if (e.key === "Escape") { e.stopPropagation(); closeMenu(); }
}

function place(menu, x, y) {
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.max(8, Math.min(x, vw - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, vh - r.height - 8)) + "px";
  open = menu;
  setTimeout(() => {
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onEsc, true);
  }, 0);
}

// items: [{ label, hint, action, disabled, danger }] with "-" as separator
export function showMenu(x, y, items) {
  closeMenu();
  const menu = el("div", { class: "menu" });
  for (const it of items) {
    if (it === "-") { menu.append(el("div", { class: "menu-sep" })); continue; }
    if (it.heading) { menu.append(el("div", { class: "menu-heading" }, it.heading)); continue; }
    menu.append(el("button", {
      class: "menu-item" + (it.danger ? " danger" : ""),
      disabled: !!it.disabled,
      onclick: () => { closeMenu(); it.action && it.action(); },
    }, el("span", null, it.label), it.hint ? el("span", { class: "menu-hint mono" }, it.hint) : null));
  }
  place(menu, x, y);
  return menu;
}

// types: node defs to offer, grouped by category. onPick(type)
export function showAddMenu(x, y, types, categories, onPick, title) {
  closeMenu();
  const search = el("input", { type: "text", class: "menu-search", placeholder: "搜索节点…" });
  const list = el("div", { class: "menu-list" });
  const menu = el("div", { class: "menu add-menu" }, title ? el("div", { class: "menu-heading" }, title) : null, search, list);
  let active = 0, shown = [];

  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.replaceChildren();
    const hits = types.filter((t) => !q || (t.title + " " + t.type + " " + (t.help || "")).toLowerCase().includes(q));
    // keyboard order must match the on-screen (grouped) order
    shown = categories.flatMap((cat) => hits.filter((t) => t.category === cat));
    if (!shown.length) { list.append(el("div", { class: "menu-empty" }, "没有匹配的节点")); return; }
    active = Math.min(active, shown.length - 1);
    for (const cat of categories) {
      const inCat = shown.filter((t) => t.category === cat);
      if (!inCat.length) continue;
      list.append(el("div", { class: "menu-heading" }, cat));
      for (const t of inCat) {
        const idx = shown.indexOf(t);
        list.append(el("button", {
          class: "menu-item" + (idx === active ? " active" : ""),
          title: t.help || "",
          onclick: () => { closeMenu(); onPick(t.type); },
          onpointerenter: () => { active = idx; },
        }, el("span", { class: "menu-ico" }, t.icon), el("span", null, t.title)));
      }
    }
  };
  search.addEventListener("input", () => { active = 0; render(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === "Enter" && shown[active]) { e.preventDefault(); const t = shown[active]; closeMenu(); onPick(t.type); }
    e.stopPropagation();
  });
  render();
  place(menu, x, y);
  search.focus();
  return menu;
}
