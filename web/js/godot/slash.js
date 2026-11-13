// 剑气 (2D, side view), drawn the same way as vfx/kinds/slash.js: a crescent
// of sword light pointed at both tips, painted as two attack-trail halves of
// the palette (_tg_glow) meeting in its thick middle, flying along the path
// (left to right by default) and fading out, leaned forwards or back by its
// angle to the ground.
export const SLASH_GD = `
var _tg_plain := false  # 剑气：完全照拖尾本身的画法（不用远程弹体包裹光的简化）

# 飞到远处渐渐消失
func _slash_fade(u: float) -> float:
	return 1.0 - _smooth(0.7, 1.0, u)

# 屏幕上弦的方向（下尖 → 上尖）和鼓起的方向：ground 是和地面的夹角（度，90 竖直，小于 90 往前倾，大于 90 往后仰）
func _slash_axes(travel: float, ground: float) -> Array:
	var th := clampf(ground, 0.0, 180.0) * PI / 180.0
	var fwd := -1.0 if cos(travel) < -1e-9 else 1.0
	var chord := Vector2(fwd * cos(th), -sin(th))
	var bulge := Vector2(-chord.y, chord.x)
	var lead := bulge.x * fwd
	if lead < -1e-9 or (absf(lead) <= 1e-9 and bulge.y > 0.0): bulge = -bulge
	return [chord, bulge]

# 月牙分成两段拖尾，各从一个尖画到正中（所以两头都尖，正中最粗最亮）：截面 {a 内侧, b 外侧（亮边）, u}
func _slash_runs(at: Vector2, travel: float, half: float, thick: float, ground: float) -> Array:
	var axes := _slash_axes(travel, ground)
	var chord: Vector2 = axes[0]
	var bulge: Vector2 = axes[1]
	var span := 140.0 * PI / 180.0
	var A := half / sin(span / 2.0)
	var sag := A * (1.0 - cos(span / 2.0))
	var runs := [[], []]
	for k in 17:
		var u := k / 16.0
		for side in 2:
			var s := 0.5 * u if side == 0 else 1.0 - 0.5 * u
			var phi := -span / 2.0 + span * s
			var W := thick * (0.04 + 0.96 * pow(sin(PI * s), 0.8))
			var nx := cos(phi)
			var ny := sin(phi)
			var ox := A * nx - A * cos(span / 2.0) - sag / 2.0
			var oy := A * ny
			runs[side].append({"a": at + bulge * (ox - nx * W) + chord * (oy - ny * W), "b": at + bulge * ox + chord * oy, "u": u})
	return runs

# 画一道剑气（k：第几个残影，用来换随机）
func _slash_at(at: Vector2, travel: float, r: float, scale0: float, alpha: float, k: int, key: int) -> void:
	if alpha <= 0.01 or scale0 <= 0.0: return
	var half := r * 4.0 * scale0
	var thick := half * 0.5 * maxf(0.1, trail_width / 70.0)
	var runs := _slash_runs(at, travel, half, thick, slash_angle)
	_tg_plain = true
	_tg_loop_n = 0.0
	for side in 2:
		_tg_glow(runs[side], key * 4 + k * 2 + side, int(floor(_t * frames + 0.0001)), alpha, 1.0, false, side)
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
		_slash_at(p, dir.angle(), r, grow, _slash_fade(u) * float(copy[1]), int(copy[2]), random_seed + index * 31)
`;
