// 冰矛 as a frost bolt, drawn the same way as vfx/kinds/ice.js: a white-hot
// core with ice crystals turning inside, a blue halo, and a comet of frost
// behind it (mist, three spiralling wisps, a hot streak, twinkling motes).
export const ICE_GD = `
# 寒冰箭的颜色：冰白的核、蓝色的边、一点淡紫的雾
func _frost_cols() -> Dictionary:
	return {
		"core": core_color, "rim": rim_color,
		"blue": colors[1] if colors.size() > 1 else rim_color,
		"mist": rim_color.lerp(Color8(176, 164, 255), 0.35),
		"deep": (colors[0] as Color).lerp(Color8(10, 20, 60), 0.3),
	}

# 每一遍（循环）光丝转几圈：大约 8 帧一圈
func _frost_cycles() -> int:
	return maxi(1, roundi(frames / 8.0))

# 路径从最老的点到头部，从头部往回量：_frost_at(path, d) → [位置, 法线]
func _frost_along(pts: PackedVector2Array) -> Dictionary:
	var rev := pts.duplicate()
	rev.reverse()
	var ds := PackedFloat32Array([0.0])
	for i in range(1, rev.size()):
		ds.append(ds[i - 1] + rev[i].distance_to(rev[i - 1]))
	return {"rev": rev, "ds": ds, "len": ds[ds.size() - 1]}

func _frost_at(path: Dictionary, d: float) -> Array:
	var rev: PackedVector2Array = path.rev
	var ds: PackedFloat32Array = path.ds
	d = clampf(d, 0.0, float(path.len))
	var i := 1
	while i < rev.size() - 1 and ds[i] < d: i += 1
	var a := rev[i - 1]
	var b := rev[i]
	var s := ds[i] - ds[i - 1]
	var k := (d - ds[i - 1]) / s if s > 1e-9 else 0.0
	var dir := b - a
	var l := dir.length()
	if l < 1e-9: l = 1.0
	return [a + dir * k, Vector2(-dir.y, dir.x) / l]

func _frost_place(path: Dictionary, d: float, off: float) -> Vector2:
	var p := _frost_at(path, d)
	return (p[0] as Vector2) + (p[1] as Vector2) * off

# 拖尾由什么组成（任意一帧都能直接算出来）：雾团、三根光丝、闪光点
func _frost_tail(len0: float, r: float, t: float, key: int, quantity: float, width: float) -> Dictionary:
	var ph := t * TAU * _frost_cycles()
	var P := Rand.new(key * 173 + 41)
	var mist := []
	var wisps := []
	var motes := []
	if len0 < 1.0: return {"mist": mist, "wisps": wisps, "motes": motes}
	var N := clampi(roundi(len0 / (r * 0.3)), 4, 64)
	for k in N + 1:
		var d := len0 * k / N
		var f := d / len0
		var sway := sin(d / (r * 1.7) - ph + key) * r * 0.45 * f * width
		var size0 := r * (1.2 + 1.1 * sin(PI * minf(1.0, f * 1.6)) * (1.0 - f) + 0.4 * (1.0 - f)) * width
		mist.append({"d": d, "off": sway, "r": size0 * (0.85 + 0.15 * sin(k * 1.7 + ph)), "a": pow(1.0 - f, 1.3) * 0.11, "f": f, "hot": false})
	var reach := minf(len0, r * 6.0)
	var C := maxi(2, roundi(reach / (r * 0.18)))
	for k in C + 1:
		var d := reach * k / C
		var f := d / reach
		mist.append({"d": d, "off": 0.0, "r": r * 0.6 * (1.0 - 0.75 * f) * minf(1.5, width), "a": 0.16 * pow(1.0 - f, 1.4), "f": 0.0, "hot": true})
	var M := clampi(roundi(len0 / (r * 0.25)), 6, 120)
	for j in 3:
		var off := j * TAU / 3.0
		var pts := []
		for k in M + 1:
			var d := len0 * k / M
			var f := d / len0
			var a := d / (r * 1.4) - ph * 2.0 + off
			pts.append({"d": d, "off": sin(a) * r * (0.35 + 1.1 * f) * width, "w": maxf(0.5, r * 0.22 * pow(1.0 - f, 0.8)), "a": pow(1.0 - f, 1.1) * 0.75 * (0.55 + 0.45 * cos(a)), "f": f})
		wisps.append(pts)
	for k in roundi(10.0 * maxf(0.0, quantity)):
		var d := P.next() * len0
		var f := d / len0
		var side := (P.next() - 0.5) * r * 1.6 * (0.3 + f) * width
		var tw := P.next() * TAU
		var size0 := r * (0.12 + 0.15 * P.next()) * (1.0 - 0.6 * f)
		motes.append({"d": d, "off": side, "size": size0, "a": (0.5 + 0.5 * sin(ph * 2.0 + tw)) * (1.0 - f)})
	return {"mist": mist, "wisps": wisps, "motes": motes}

# 四角的小闪光
func _frost_twinkle(p: Vector2, size0: float, a: float) -> void:
	if a <= 0.01: return
	_blob(p, size0, [[0.0, core_color, 0.8 * a], [1.0, rim_color, 0.0]])
	for d in [Vector2(-1, 0), Vector2(1, 0), Vector2(0, -1), Vector2(0, 1)]:
		_streak(p + d * size0 * 1.8, p, rim_color, core_color, 0.75 * a, maxf(0.4, size0 * 0.22))

# 沿 pts（从最老的点到头部）画拖尾
func _remote_frost_tail(pts: PackedVector2Array, r: float, strength: float, width: float, key: int) -> void:
	if pts.size() < 2: return
	var path := _frost_along(pts)
	var len0: float = path.len
	if len0 < 1.0: return
	var tail := _frost_tail(len0, r, _t, key, amount, width)
	var col := _frost_cols()
	_add = additive
	for m in tail.mist:
		var tone: Color = col.core if m.hot else (col.rim as Color).lerp(col.mist, minf(1.0, float(m.f) * 1.2))
		var a: float = m.a * strength
		_blob(_frost_place(path, m.d, m.off), m.r, [[0.0, tone, a], [0.5, tone, a * 0.45], [1.0, tone, 0.0]])
	for wisp in tail.wisps:
		var line := PackedVector2Array()
		var cl := PackedColorArray()
		var ws := PackedFloat32Array()
		for q in wisp:
			line.append(_frost_place(path, q.d, q.off))
			cl.append(_col((col.core as Color).lerp(col.rim, q.f), float(q.a) * strength))
			ws.append(q.w)
		_line(line, cl, 1.0, ws)
	for m in tail.motes:
		_frost_twinkle(_frost_place(path, m.d, m.off), m.size, float(m.a) * strength)

# 头部里的冰晶（它自己的坐标，x 朝前）：从正中伸出的菱形，一边亮一边暗，慢慢转
func _frost_crystals(r: float, t: float, key: int) -> Array:
	var P := Rand.new(key * 97 + 5)
	var turn := t * TAU
	var out := []
	for arm in [[0.0, 1.0], [PI, 0.85], [1.05, 0.7], [-1.1, 0.75], [2.15, 0.65], [-2.2, 0.6]]:
		var a: float = arm[0] + (P.next() - 0.5) * 0.3 + sin(turn + arm[0]) * 0.12
		var len0: float = r * arm[1] * (0.85 + 0.3 * P.next())
		var d := Vector2.from_angle(a)
		var nv := Vector2(-d.y, d.x) * len0 * 0.2
		var m := d * len0 * 0.35
		var tip := d * len0
		out.append({"lit": PackedVector2Array([Vector2.ZERO, m + nv, tip]), "dark": PackedVector2Array([Vector2.ZERO, tip, m - nv]), "tip": tip})
	return out

# 头部：在 (0, 0)，朝 +x 飞；still：原地循环时身后自己带一段短拖尾
func _remote_ice(r: float, key: int, still := false) -> void:
	if still:
		var pts := PackedVector2Array()
		for i in 9: pts.append(Vector2(-r * 6.0 * (1.0 - i / 8.0), 0.0))
		_remote_frost_tail(pts, r, 1.0, 1.0, key)
	var col := _frost_cols()
	var tw := 0.85 + 0.15 * sin(_t * TAU * _frost_cycles() * 3.0)
	_add = additive
	_blob(Vector2.ZERO, 2.6 * r, [[0.0, col.rim, 0.35], [0.45, col.mist, 0.14], [1.0, col.mist, 0.0]], Vector2(1.25, 0.9))
	_blob(Vector2.ZERO, 1.6 * r, [[0.0, col.mist, 0.4], [1.0, col.mist, 0.0]])
	_add = false
	var crystals := _frost_crystals(r, _t, key)
	var lit_col := (col.blue as Color).lerp(col.core, 0.7)
	var dark_col := (col.deep as Color).lerp(col.blue, 0.55)
	for k in crystals:
		_poly_fill(k.lit, PackedColorArray([_col(lit_col, 0.9)]))
		_poly_fill(k.dark, PackedColorArray([_col(dark_col, 0.8)]))
	_add = additive
	for k in crystals:
		_streak(Vector2.ZERO, k.tip, rim_color, core_color, 0.6, maxf(0.5, r * 0.06))
	_blob(Vector2.ZERO, 1.05 * r, [[0.0, core_color, tw], [0.35, core_color, 0.8 * tw], [1.0, rim_color, 0.0]])
	for f in [[-1.6, 0.0, 1.0], [1.2, 0.0, 1.0], [0.0, -0.7, 0.7], [0.0, 0.7, 0.7]]:
		_streak(Vector2(f[0], f[1]) * r, Vector2.ZERO, rim_color, core_color, 0.8 * tw * f[2], maxf(0.5, r * 0.1))
`;
