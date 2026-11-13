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

# 和地面的夹角（度，0 … 360）→ Vector2(squash, shear)：月牙绕着飞行方向转，从侧面稍微偏上看。
# 90 竖直，0（和 180）平行地面、扁扁的、下面的尖靠后；中间连续转过去，没有跳变：约 163° 和 343° 侧对（一道细线），
# 270 倒过来，360 又回到 0。squash 显示多高（有正负，小于 0 是倒过来的），shear 下面的尖靠后多少
func _slash_tilt(ground: float) -> Vector2:
	var th := ground * PI / 180.0
	var sq := sin(th) + 0.3 * cos(th)
	if absf(sq) < 0.001: sq = -0.001 if sq < 0.0 else 0.001  # 从屏幕换回月牙坐标要除以它
	return Vector2(sq, 0.25 * cos(th))

# 月牙弧度：从一个尖到另一个尖绕弧多少（度，60 … 240，默认 170）。弦长不变：小了更平、更浅，大了更深，过了 180 两个尖往回卷成「C」
func _slash_span() -> float:
	return clampf(slash_curve, 60.0, 240.0) * PI / 180.0

# 画月牙的这一段时间里，按 at/travel/half/ground/shape 设好两头变淡
func _slash_mask_begin(at: Vector2, travel: float, half: float, ground: float, shape: String) -> void:
	var tilt := _slash_tilt(ground)
	var fr := _slash_axes(travel)
	var span := _slash_span()
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	_sm = {"at": at, "X": fr[0], "Y": fr[1], "squash": tilt.x, "shear": tilt.y, "cx": -A * cos(span / 2.0) - sag / 2.0, "span": span, "half": shape == "half"}
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

# 到达终点之后：在「命中消散」的帧数里淡出（hit 0 → 1）
func _slash_fade(hit: float) -> float:
	return 1.0 - _smooth(0.0, 1.0, hit)

# 飞行方向自己的坐标：x 沿着飞行，y 横过它、朝屏幕下方（不管往哪边飞，上面总是上面）
func _slash_frame(travel: float) -> Array:
	var x := Vector2.from_angle(travel)
	var y := Vector2(-x.y, x.x)
	if y.y < 0.0 or (absf(y.y) < 1e-9 and y.x < 0.0): y = -y
	return [x, y]

# 左右倾斜（度，-90 … 90）：放倒（地面夹角）之后再绕正中在屏幕上斜过去，大于 0 上端往前（飞行方向）倾，小于 0 往后倾
func _slash_axes(travel: float) -> Array:
	var fr := _slash_frame(travel)
	var l := clampf(slash_lean, -90.0, 90.0) * PI / 180.0
	var x: Vector2 = fr[0]
	var y: Vector2 = fr[1]
	return [x * cos(l) + y * sin(l), y * cos(l) - x * sin(l)]

# 月牙是一整段拖尾：截面 {a 内侧, b 外侧（亮边）, u}。两头尖：从上尖一直画到下尖，两头尖完全靠厚度收出来，
# u 从拖尾中段开始，两头都不会淡没；半头：从上尖画到正中平切处（拖尾最粗的头）。
# ground 是和地面的夹角（度，0 … 360，见 _slash_tilt）
func _slash_runs(at: Vector2, travel: float, half: float, thick: float, ground: float, shape: String) -> Array:
	var tilt := _slash_tilt(ground)
	var squash := tilt.x
	var shear := tilt.y
	var fr := _slash_axes(travel)
	var X: Vector2 = fr[0]
	var Y: Vector2 = fr[1]
	var span := _slash_span()
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	var n := 16 if shape == "half" else 32
	var run := []
	for k in n + 1:
		var s := 0.5 * k / 16.0 if shape == "half" else float(k) / 32.0
		var u := k / 16.0 if shape == "half" else 0.35 + 0.65 * k / 32.0
		var phi := -span / 2.0 + span * s
		var W := _slash_inset(A, thick, phi, span)
		var nx := cos(phi)
		var ny := sin(phi)
		var ox := A * nx - A * cos(span / 2.0) - sag / 2.0
		var oy := A * ny
		var ix := ox - nx * W
		var iy := oy - ny * W
		run.append({"a": at + X * (ix - iy * shear) + Y * (iy * squash), "b": at + X * (ox - oy * shear) + Y * (oy * squash), "u": u})
	return [run]

# 内侧边也是一段圆弧（穿过两个尖、正中离外弧 thick 的圆），所以凹进去的地方永远是凹的：thick 不超过月牙鼓出的深度。
# 返回外弧上角度 phi 处，沿外弧圆心的射线往里到内侧边的距离
func _slash_inset(A: float, thick: float, phi: float, span: float) -> float:
	var a := A * cos(span / 2.0)
	var m := A - minf(thick, 0.95 * (A - a))
	var d := (m * m - A * A) / (2.0 * (m - a))
	var B := m - d
	var t := d * cos(phi) + sqrt(maxf(0.0, d * d * cos(phi) * cos(phi) - d * d + B * B))
	return maxf(A - t, thick * 0.02)

# 画一道剑气（k：第几个残影，用来换随机）
func _slash_at(at: Vector2, travel: float, r: float, scale0: float, alpha: float, k: int, key: int) -> void:
	if alpha <= 0.01 or scale0 <= 0.0: return
	var half := r * 4.0 * scale0
	var span := _slash_span()
	var thick := half / sin(span / 2.0) * (1.0 - cos(span / 2.0)) * clampf(slash_thick, 10.0, 90.0) / 100.0
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
	var tilt := _slash_tilt(ground)
	var squash := tilt.x
	var shear := tilt.y
	var fr := _slash_axes(travel)
	var X: Vector2 = fr[0]
	var Y: Vector2 = fr[1]
	var span := _slash_span()
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

# 剑气（飞行中还有后面一个淡淡的残影）：完整地一直飞到终点，然后在「命中消散」的帧数里在终点往前飘一点、
# 稍微变大并淡出——从出现到消失，跟着整段帧数
func _remote_slash(state: Dictionary, index: int, r: float) -> void:
	var key := random_seed + index * 31
	if not state.body:
		var hit := float(state.hit)
		if hit < 0.0 or hit >= 1.0: return
		var end := _remote_path(1.0, index)
		var travel := (end - _remote_path(0.995, index)).angle()
		_slash_at(end + Vector2.from_angle(travel) * r * 0.8 * hit, travel, r, 1.0 + 0.15 * hit, _slash_fade(hit), 0, key)
		return
	var grow: float = 1.0 if state.launched else 0.15 + 0.85 * float(state.charge)
	for copy in [[0.06, 0.22, 1], [0.0, 1.0, 0]]:
		var lag: float = copy[0]
		if lag > 0.0 and (not state.launched or float(state.u) - lag < 0.0): continue
		var u := maxf(0.0, float(state.u) - lag)
		var p := _remote_path(u, index)
		var dir := _remote_path(minf(1.0, u + 0.005), index) - _remote_path(maxf(0.0, u - 0.005), index)
		_slash_at(p, dir.angle(), r, grow, float(copy[1]), int(copy[2]), key)
`
