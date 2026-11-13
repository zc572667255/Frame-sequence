// 剑气 (2D, side view), drawn the same way as vfx/kinds/slash.js: a crescent
// of sword light painted as attack-trail runs of the palette (_tg_glow), each
// from a tip to its thick middle — both halves (两头尖) or the upper one only
// (半头) — flying along the path (left to right by default) and fading out,
// laid down from upright towards parallel to the ground by its angle.
export const SLASH_GD = `
var _tg_plain := false  # 剑气：完全照拖尾本身的画法（不用远程弹体包裹光的简化）
# 剑气两头变淡：画月牙时每个顶点的透明度按它在弧上的位置减弱（_tri 里用）
var _sm_on := false
var _sm := {}

# 画月牙的这一段时间里，按 at/travel/half/ground/shape 设好两头变淡
func _slash_mask_begin(at: Vector2, travel: float, half: float, ground: float, shape: String) -> void:
	var th := clampf(ground, 0.0, 90.0) * PI / 180.0
	var fr := _slash_frame(travel)
	var span := 140.0 * PI / 180.0
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	_sm = {"at": at, "X": fr[0], "Y": fr[1], "squash": 0.3 + 0.7 * sin(th), "shear": 0.25 * cos(th), "cx": -A * cos(span / 2.0) - sag / 2.0, "span": span, "half": shape == "half"}
	_sm_on = true

# 屏幕上一点留下多少光：过了尖是 0，往中间平滑升到 1（按它在弧上的角度，所以周围的光晕跟着一起淡）
func _slash_ends(p: Vector2) -> float:
	var d: Vector2 = p - (_sm.at as Vector2)
	var y: float = d.dot(_sm.Y) / float(_sm.squash)
	var x: float = d.dot(_sm.X) + y * float(_sm.shear)
	var s := (atan2(y, x - float(_sm.cx)) + float(_sm.span) / 2.0) / float(_sm.span)
	return _smooth(0.0, 0.3, s) * (1.0 if _sm.half else _smooth(0.0, 0.3, 1.0 - s))

func _slash_mask_cols(pts: PackedVector2Array, cols: PackedColorArray) -> PackedColorArray:
	var out := PackedColorArray()
	out.resize(pts.size())
	for i in pts.size():
		var c: Color = cols[i] if cols.size() == pts.size() else cols[0]
		c.a *= _slash_ends(pts[i])
		out[i] = c
	return out

# 飞到远处渐渐消失
func _slash_fade(u: float) -> float:
	return 1.0 - _smooth(0.7, 1.0, u)

# 飞行方向自己的坐标：x 沿着飞行，y 横过它、朝屏幕下方（不管往哪边飞，上面总是上面）
func _slash_frame(travel: float) -> Array:
	var x := Vector2.from_angle(travel)
	var y := Vector2(-x.y, x.x)
	if y.y < 0.0 or (absf(y.y) < 1e-9 and y.x < 0.0): y = -y
	return [x, y]

# 月牙是一整段拖尾：截面 {a 内侧, b 外侧（亮边）, u}。两头尖：从上尖一直画到下尖，两头尖完全靠厚度收出来，
# u 从拖尾中段开始，两头都不会淡没；半头：从上尖画到正中平切处（拖尾最粗的头）。
# ground 是和地面的夹角（度，90 竖直 … 0 平行地面，越放倒从侧面看越扁，下面的尖稍微更靠后）
func _slash_runs(at: Vector2, travel: float, half: float, thick: float, ground: float, shape: String) -> Array:
	var th := clampf(ground, 0.0, 90.0) * PI / 180.0
	var squash := 0.3 + 0.7 * sin(th)
	var shear := 0.25 * cos(th)
	var fr := _slash_frame(travel)
	var X: Vector2 = fr[0]
	var Y: Vector2 = fr[1]
	var span := 140.0 * PI / 180.0
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	var n := 16 if shape == "half" else 32
	var run := []
	for k in n + 1:
		var s := 0.5 * k / 16.0 if shape == "half" else float(k) / 32.0
		var u := k / 16.0 if shape == "half" else 0.35 + 0.65 * k / 32.0
		var phi := -span / 2.0 + span * s
		var W := thick * (0.04 + 0.96 * pow(sin(PI * s), 0.8))
		var nx := cos(phi)
		var ny := sin(phi)
		var ox := A * nx - A * cos(span / 2.0) - sag / 2.0
		var oy := A * ny
		var ix := ox - nx * W
		var iy := oy - ny * W
		run.append({"a": at + X * (ix - iy * shear) + Y * (iy * squash), "b": at + X * (ox - oy * shear) + Y * (oy * squash), "u": u})
	return [run]

# 画一道剑气（k：第几个残影，用来换随机）
func _slash_at(at: Vector2, travel: float, r: float, scale0: float, alpha: float, k: int, key: int) -> void:
	if alpha <= 0.01 or scale0 <= 0.0: return
	var half := r * 4.0 * scale0
	var thick := half * clampf(slash_thick, 10.0, 150.0) / 100.0
	var runs := _slash_runs(at, travel, half, thick, slash_angle, slash_shape)
	var frame := int(floor(_t * frames + 0.0001))
	_tg_plain = true
	_tg_loop_n = 0.0
	_slash_mask_begin(at, travel, half, slash_angle, slash_shape)
	for side in runs.size():
		_tg_glow(runs[side], key * 4 + k * 2 + side, frame, alpha, 1.0, false, side)
	_sm_on = false
	_tg_plain = false
	var li := TG_KEYS.find("speedLines")
	_slash_lines(at, travel, half, thick, slash_angle, slash_shape, trail_look[li] if li >= 0 and li < trail_look.size() else 0.0, key * 4 + k * 2, frame, alpha)

# 光丝：配色里拖尾的速度线，但顺着月牙的弧线走：从正中附近沿着弧往一个尖去，过了尖再顺着弯一点，开头亮、往外淡去
func _slash_lines(at: Vector2, travel: float, half: float, thick: float, ground: float, shape: String, quantity: float, key: int, frame: int, alpha: float) -> void:
	var th := clampf(ground, 0.0, 90.0) * PI / 180.0
	var squash := 0.3 + 0.7 * sin(th)
	var shear := 0.25 * cos(th)
	var fr := _slash_frame(travel)
	var X: Vector2 = fr[0]
	var Y: Vector2 = fr[1]
	var span := 140.0 * PI / 180.0
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	var cx := -A * cos(span / 2.0) - sag / 2.0
	var S := Rand.new(key * 131 + 3)
	var P := Rand.new(key * 131 + frame * 557 + 1)
	var sides := [-1.0] if shape == "half" else [-1.0, 1.0]
	_add = additive
	for k in roundi(maxf(0.0, quantity) * 22.0):
		var dir: float = sides[k % sides.size()]
		var from := (0.05 + 0.3 * S.next()) * span / 2.0
		var to := (1.1 + 0.3 * S.next()) * span / 2.0
		var depth := thick * (0.05 + 0.6 * S.next())
		var width := maxf(0.6, thick / (30.0 + 50.0 * S.next()))
		var a := alpha * (0.35 + 0.5 * P.next())
		var rad := A - depth
		var pts := PackedVector2Array()
		var cols := PackedColorArray()
		for j in 17:
			var f := j / 16.0
			var phi := dir * (from + (to - from) * f)
			var x := cx + cos(phi) * rad
			var y := sin(phi) * rad
			pts.append(at + X * (x - y * shear) + Y * (y * squash))
			var aj := a * (0.85 - 0.35 * f / 0.3 if f < 0.3 else 0.5 * (1.0 - (f - 0.3) / 0.7))
			cols.append(_col(core_color if j < 5 else rim_color, aj))
		_line(pts, cols, width)

# 飞行中：剑气本身和后面一个淡淡的残影
func _remote_slash(state: Dictionary, index: int, r: float) -> void:
	if not state.body: return
	var grow: float = 1.0 if state.launched else 0.15 + 0.85 * float(state.charge)
	for copy in [[0.06, 0.22, 1], [0.0, 1.0, 0]]:
		var lag: float = copy[0]
		if lag > 0.0 and (not state.launched or float(state.u) - lag < 0.0): continue
		var u := maxf(0.0, float(state.u) - lag)
		var p := _remote_path(u, index)
		var dir := _remote_path(minf(1.0, u + 0.005), index) - _remote_path(maxf(0.0, u - 0.005), index)
		_slash_at(p, dir.angle(), r, grow, _slash_fade(u) * float(copy[1]), int(copy[2]), random_seed + index * 31)
`;
