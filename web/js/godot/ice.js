// 冰矛's flying lance, drawn the same way as vfx/kinds/ice.js: four flat
// facets with a broken back end, a bright ridge, a glint on the upper edge, a
// light sweeping along the ridge to a sparkling tip and a cold halo.
export const ICE_GD = `
# 冰矛的形状（本体坐标：x 朝前，y 朝下；r 是本体半径）
func _ice_spear(r: float, key: int) -> Dictionary:
	var T := Vector2(2.7, 0.0) * r
	var Su := Vector2(0.3, -0.52) * r
	var Sd := Vector2(0.3, 0.52) * r
	var Wu := Vector2(-0.95, -0.4) * r
	var Wd := Vector2(-0.95, 0.4) * r
	var Bu := Vector2(-1.45, -0.27) * r
	var Bn := Vector2(-1.22, -0.03) * r
	var Bd := Vector2(-1.6, 0.17) * r
	var Iu1 := Vector2(0.25, -0.35) * r
	var Iu2 := Vector2(-0.95, -0.25) * r
	var Id1 := Vector2(0.25, 0.37) * r
	var Id2 := Vector2(-0.95, 0.28) * r
	var Rs := Vector2(0.3 * r, Bn.y * (2.7 - 0.3) / (2.7 + 1.22))
	var P := Rand.new(key * 97 + 5)
	var cracks := []
	for c in [[-0.7, -0.03, -0.25, -0.22], [0.5, -0.02, 0.9, -0.17], [-0.5, 0.04, -0.1, 0.24]]:
		var a := Vector2(c[0] + P.next() * 0.4, c[1]) * r
		var b := Vector2(c[2] + P.next() * 0.5, c[3]) * r
		cracks.append(PackedVector2Array([a, b]))
	return {
		"tip": T, "back": Bn, "edge": PackedVector2Array([Bu, Wu, Su, T]), "cracks": cracks,
		"faces": [
			[0, PackedVector2Array([T, Su, Wu, Bu, Iu2, Iu1])],
			[1, PackedVector2Array([T, Iu1, Iu2, Bu, Bn, Rs])],
			[2, PackedVector2Array([T, Rs, Bn, Bd, Id2, Id1])],
			[3, PackedVector2Array([T, Id1, Id2, Bd, Wd, Sd])],
		],
		"x0": Bd.x, "x1": T.x,
	}

# 各个切面在尾部和尖上的颜色（颜色, 透明度）；roll：绕自身的轴转了多少，只改变上面那一面有多亮
func _ice_tones(roll: float) -> Array:
	var deep: Color = colors[0].lerp(Color8(6, 14, 40), 0.45)
	var blue: Color = colors[0]
	var cyan: Color = colors[1] if colors.size() > 1 else rim_color
	var lit := 0.5 + 0.5 * cos(roll)
	return [
		[cyan.lerp(core_color, 0.35), 0.85, core_color, 0.98],
		[blue.lerp(cyan, 0.45), 0.7, cyan.lerp(core_color, 0.2 + 0.25 * lit), 0.92],
		[deep.lerp(blue, 0.6), 0.75, blue.lerp(cyan, 0.4 + 0.2 * (1.0 - lit)), 0.9],
		[deep, 0.85, deep.lerp(blue, 0.5), 0.9],
	]

func _remote_ice(r: float, key: int) -> void:
	var sp := _ice_spear(r, key)
	var tones := _ice_tones(_t * TAU + key)
	_add = additive
	_blob(Vector2(0.4 * r, 0.0), 1.9 * r, [[0.0, rim_color, 0.22], [0.5, rim_color, 0.08], [1.0, rim_color, 0.0]], Vector2(1.7, 0.75))
	_add = false
	var x0: float = sp.x0
	var x1: float = sp.x1
	for face in sp.faces:
		var tone: Array = tones[face[0]]
		var pts: PackedVector2Array = face[1]
		var cl := PackedColorArray()
		for p in pts:
			var k := clampf((p.x - x0) / (x1 - x0), 0.0, 1.0)
			cl.append(_col((tone[0] as Color).lerp(tone[2], k), lerpf(tone[1], tone[3], k)))
		_poly_fill(pts, cl)
	_add = additive
	var w := maxf(0.6, r * 0.07)
	for crack in sp.cracks:
		_line(crack, PackedColorArray([_col(core_color, 0.3)]), maxf(0.4, r * 0.03))
	var tip: Vector2 = sp.tip
	var back: Vector2 = sp.back
	_streak(back, tip, rim_color, core_color, 0.85, w)
	_line(sp.edge, PackedColorArray([_col(core_color, 0.55)]), maxf(0.5, r * 0.045))
	# 一道光沿着棱跑到尖上（循环时跑两遍）
	var s := fposmod(_t * 2.0, 1.0)
	var x := -1.1 * r + 3.4 * r * s
	_blob(Vector2(x, back.y * (tip.x - x) / (tip.x - back.x)), 0.35 * r, [[0.0, core_color, 0.55 * sin(PI * s)], [1.0, core_color, 0.0]])
	# 尖上闪光
	var tw := 0.7 + 0.3 * sin(_t * TAU * 2.0)
	_blob(tip, 0.55 * r, [[0.0, core_color, 0.9 * tw], [0.4, rim_color, 0.35 * tw], [1.0, rim_color, 0.0]])
	for d in [Vector2(-0.6, 0.0), Vector2(0.45, 0.0), Vector2(0.0, -0.35), Vector2(0.0, 0.35)]:
		_streak(tip + d * r, tip, rim_color, core_color, 0.75 * tw, maxf(0.5, r * 0.05))

# 拖尾的宽度：收在本体尾部里面
func _ice_trail_sections(points: PackedVector2Array, r: float, key: int, strength: float) -> Array:
	var shifted := PackedVector2Array()
	for i in points.size():
		var d := (points[mini(points.size() - 1, i + 1)] - points[maxi(0, i - 1)]).normalized()
		shifted.append(points[i] - d * r * 0.65)
	return _remote_sections(shifted, 0.34 * r / 0.85, strength, r)
`;
