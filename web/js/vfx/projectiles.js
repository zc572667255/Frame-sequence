// 箭矢's ready-made looks: pictures of things thrown or shot (web/assets/projectiles/<id>.png,
// facing right, on a transparent ground), each with how big it flies — its
// longer side, % of the effect's radius — and whether it tumbles as it flies.
// A look is the shape "s:<id>"; the picture is drawn like 自定义核心's.
const S = (id, name, size, spin) => ({ id, name, size, spin });

export const SPRITE_GROUPS = [
  ["箭", [S("arrow1", "红羽箭", 90, false), S("arrow2", "白羽箭", 90, false), S("arrow3", "黑羽箭", 90, false), S("arrow4", "金箭", 90, false), S("arrow5", "绿羽箭", 90, false)]],
  ["刀", [S("dagger1", "匕首", 70, false), S("dagger2", "环首刀", 70, false), S("dagger3", "锯齿刀", 70, false), S("dagger4", "猎刀", 70, false), S("dagger5", "弯刀", 72, false)]],
  ["枪", [S("spear1", "长枪", 95, false), S("spear2", "红缨枪", 100, false), S("spear3", "倒钩枪", 95, false), S("spear4", "金纹枪", 100, false),
    S("pole1", "火把", 90, false), S("pole2", "三叉戟", 95, false), S("pole3", "钩枪", 95, false), S("pole4", "绳镖", 90, false), S("pole5", "鱼叉", 90, false)]],
  ["斧", [S("axe1", "手斧", 60, true), S("axe2", "战斧", 62, true), S("axe3", "双刃斧", 62, true), S("axe4", "金纹斧", 62, true), S("axe5", "血斧", 64, true)]],
  ["锤棍", [S("club1", "钉头棒", 62, true), S("club2", "流星锤", 64, true), S("club3", "链枷", 66, true), S("club4", "狼牙棒", 68, true), S("club5", "长棍", 85, true)]],
  ["飞镖", [S("star1", "四角镖", 42, true), S("star2", "暗星镖", 42, true), S("star3", "八角镖", 44, true), S("star4", "旋刃镖", 42, true),
    S("star5", "方镖", 36, true), S("star6", "菱形镖", 55, false), S("star7", "十字镖", 46, true), S("star8", "圆锯", 42, true)]],
  ["球与炸弹", [S("ball1", "石球", 30, false), S("ball2", "刺球", 36, true), S("ball3", "铁球", 30, false),
    S("bomb1", "陶罐", 36, true), S("bomb2", "燃烧瓶", 55, true), S("bomb3", "火药筒", 50, true), S("bomb4", "炸药", 46, true)]],
];

export const SPRITES = SPRITE_GROUPS.flatMap(([, list]) => list);

// the ready-made look a shape names, or null
export const spriteOf = (shape) => (typeof shape === "string" && shape.startsWith("s:") ? SPRITES.find((x) => x.id === shape.slice(2)) || null : null);

// where its picture is (absolute: the render workers fetch it too)
export const spriteUrl = (id) => new URL("../../assets/projectiles/" + id + ".png", import.meta.url).href;
// a small copy for the panel's buttons (assets/projectiles/thumbs)
export const spriteThumb = (id) => new URL("../../assets/projectiles/thumbs/" + id + ".png", import.meta.url).href;
