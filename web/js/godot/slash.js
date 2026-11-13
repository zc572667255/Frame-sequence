// 剑气, drawn the same way as vfx/kinds/slash.js: a crescent of sword light
// painted as an attack trail of the palette (_tg_glow), flying from near
// (big) to far (small) and fading out, at an adjustable angle to the ground.
export const SLASH_GD = `
var _tg_plain := false  # 剑气：完全照拖尾本身的画法（不用远程弹体包裹光的简化）

# 近大远小：近处 1，飞到终点是 far（0..1）
func _slash_scale(u: float, far: float) -> float:
	return 1.0 / (1.0 + (1.0 / maxf(0.05, far) - 1.0) * clampf(u, 0.0, 1.0))

# 飞到远处渐渐消失
func _slash_fade(u: float) -> float:
	return 1.0 - _smooth(0.7, 1.0, u)

# 月牙的拖尾截面 {a 内侧, b 外侧（亮边）, u 从细的尾尖到头}：at 是它的正中，travel 是屏幕上的飞行方向，
# half 是弦长的一半，thick 是最厚处，ground 是和地面的夹角（度）；鼓起的一面总是朝着飞行方向
func _slash_run(at: Vector2, travel: float, half: float, thick: float, ground: float) -> Array:
	var th := clampf(ground, 0.0, 90.0) * PI / 180.0
	var c := cos(th)
	var s := sin(th)
	var squash := 0.6 + 0.4 * s
	var span := 140.0 * PI / 180.0
	var fwd := Vector2(-s, -c * squash)
	var flip := -1.0 if fwd.dot(Vector2.from_angle(travel)) < 0.0 else 1.0
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	var out := []
	for k in 33:
		var u := k / 32.0
		var phi := -span / 2.0 + span * u
		var W := thick * (0.04 + 0.96 * pow(sin(PI * u), 0.7) * (0.55 + 0.45 * u))
		var nx := sin(phi)
		var ny := -cos(phi) * flip
		var ox := A * nx
		var oy := (A * cos(span / 2.0) - A * cos(phi) + sag / 2.0) * flip
		var b := Vector2(ox * c + oy * s, (-ox * s + oy * c) * squash)
		var ix := ox - nx * W
		var iy := oy - ny * W
		var a := Vector2(ix * c + iy * s, (-ix * s + iy * c) * squash)
		out.append({"a": at + a, "b": at + b, "u": u})
	return out

# 画一道剑气（k：第几个残影，用来换随机）
func _slash_at(at: Vector2, travel: float, r: float, scale0: float, alpha: float, k: int, key: int) -> void:
	if alpha <= 0.01 or scale0 <= 0.0: return
	var half := r * 4.0 * scale0
	var thick := half * 0.5 * maxf(0.1, trail_width / 70.0)
	var run := _slash_run(at, travel, half, thick, slash_angle)
	_tg_plain = true
	_tg_loop_n = 0.0
	_tg_glow(run, key * 2 + k, int(floor(_t * frames + 0.0001)), alpha, 1.0, false, k % 2)
	_tg_plain = false

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
		_slash_at(p, dir.angle(), r, _slash_scale(u, slash_far / 100.0) * grow, _slash_fade(u) * float(copy[1]), int(copy[2]), random_seed + index * 31)
`;
