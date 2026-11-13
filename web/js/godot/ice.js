// 冰矛 as an ice meteor, drawn the same way as vfx/kinds/ice.js: a rough,
// faceted chunk of ice tumbling in a cold glow, shedding broken ice chips,
// with a trail of freezing vapour.
export const ICE_GD = `
# 冰块的颜色：深蓝、蓝、亮边、白光、寒气
func _ice_cols() -> Dictionary:
	return {
		"core": core_color, "rim": rim_color,
		"blue": colors[1] if colors.size() > 1 else rim_color,
		"deep": (colors[0] as Color).lerp(Color8(8, 18, 48), 0.35),
		"vapor": rim_color.lerp(core_color, 0.45),
	}

# 每一遍（循环）转几圈：大约 8 帧一圈
func _ice_cycles() -> int:
	return maxi(1, roundi(frames / 8.0))

# 光从上前方照来（飞行方向的坐标里）
const ICE_LIGHT := Vector2(0.35, -0.94)

# 路径从最老的点到头部，从头部往回量
func _ice_along(pts: PackedVector2Array) -> Dictionary:
	var rev := pts.duplicate()
	rev.reverse()
	var ds := PackedFloat32Array([0.0])
	for i in range(1, rev.size()):
		ds.append(ds[i - 1] + rev[i].distance_to(rev[i - 1]))
	return {"rev": rev, "ds": ds, "len": ds[ds.size() - 1]}

# 往回 d 处、沿法线偏 off 的位置
func _ice_place(path: Dictionary, d: float, off: float) -> Vector2:
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
	return a + dir * k + Vector2(-dir.y, dir.x) / l * off

# 一块有切面的冰：sides 个角、离中心远近不一，切面从稍偏中心的一点展开，每面按朝光的程度定亮暗
func _ice_lump(P: Rand, at: Vector2, size0: float, rot: float, sides: int, stretch := 1.0) -> Dictionary:
	var xf := Transform2D(rot, at)
	var pts := PackedVector2Array()
	for k in sides:
		var a := k * TAU / sides + (P.next() - 0.5) * (3.0 / sides)
		var rad := size0 * (0.58 + 0.52 * P.next())
		pts.append(xf * Vector2(cos(a) * rad * stretch, sin(a) * rad))
	var ox := (P.next() - 0.5) * 0.3 * size0
	var oy := (P.next() - 0.5) * 0.3 * size0
	var mid := xf * Vector2(ox, oy)
	var facets := []
	for k in sides:
		var a := pts[k]
		var b := pts[(k + 1) % sides]
		var m := (a + b) / 2.0 - mid
		var l := m.length()
		if l < 1e-9: l = 1.0
		facets.append({"pts": PackedVector2Array([mid, a, b]), "light": clampf(0.5 + 0.5 * m.dot(ICE_LIGHT) / l, 0.0, 1.0)})
	return {"pts": pts, "mid": mid, "facets": facets}

# 画一块冰：切面涂冰色，边缘一圈霜白，朝光的边最亮
func _ice_draw_lump(lump: Dictionary, alpha: float, lw: float) -> void:
	if alpha <= 0.005: return
	var col := _ice_cols()
	_add = false
	for f in lump.facets:
		var L: float = f.light
		var tone := (col.deep as Color).lerp(col.blue, 0.25 + 0.5 * L).lerp(col.core, L * L * 0.7)
		_poly_fill(f.pts, PackedColorArray([_col(tone, 0.93 * alpha)]))
	_add = additive
	for f in lump.facets:
		var p: PackedVector2Array = f.pts
		_line(PackedVector2Array([p[1], p[2]]), PackedColorArray([_col(core_color, (0.18 + maxf(0.0, float(f.light) - 0.5) * 1.5) * alpha)]), lw)

# 头部后面的寒气：先鼓起再变稀、左右摆动的雾团，加上紧跟头部的一段亮雾
func _ice_vapor(len0: float, r: float, t: float, key: int, width: float) -> Array:
	var ph := t * TAU * _ice_cycles()
	var out := []
	if len0 < 1.0: return out
	var N := clampi(roundi(len0 / (r * 0.3)), 4, 64)
	for k in N + 1:
		var d := len0 * k / N
		var f := d / len0
		var sway := sin(d / (r * 1.7) - ph + key) * r * 0.4 * f * width
		var size0 := r * (1.0 + 0.9 * sin(PI * minf(1.0, f * 1.6)) * (1.0 - f) + 0.3 * (1.0 - f)) * width
		out.append({"d": d, "off": sway, "r": size0 * (0.85 + 0.15 * sin(k * 1.7 + ph)), "a": pow(1.0 - f, 1.3) * 0.09, "hot": false})
	var reach := minf(len0, r * 4.0)
	var C := maxi(2, roundi(reach / (r * 0.2)))
	for k in C + 1:
		var f := float(k) / C
		out.append({"d": reach * f, "off": 0.0, "r": r * 0.75 * (1.0 - 0.7 * f) * minf(1.5, width), "a": 0.1 * pow(1.0 - f, 1.4), "hot": true})
	return out

func _remote_ice_vapor(pts: PackedVector2Array, r: float, strength: float, width: float, key: int) -> void:
	if pts.size() < 2: return
	var path := _ice_along(pts)
	if float(path.len) < 1.0: return
	var col := _ice_cols()
	_add = additive
	for m in _ice_vapor(path.len, r, _t, key, width):
		var tone: Color = col.core if m.hot else col.vapor
		var a: float = m.a * strength
		_blob(_ice_place(path, m.d, m.off), m.r, [[0.0, tone, a], [0.5, tone, a * 0.45], [1.0, tone, 0.0]])

# 原地循环：碎冰从身上掉下来、往后飘走（它自己的坐标），每块一遍正好一轮
func _ice_still_chips(r: float, t: float, key: int) -> Array:
	var P := Rand.new(key * 61 + 13)
	var cyc := _ice_cycles()
	var out := []
	for k in roundi(14.0 * maxf(0.0, amount)):
		var ph := P.next()
		var side := P.next() * 2.0 - 1.0
		var size0 := r * (0.2 + 0.26 * P.next())
		var rot := P.next() * TAU
		var spin := (-1.0 if P.next() < 0.5 else 1.0) * (1.0 + floorf(P.next() * 2.0))
		var sides := 3 + int(floorf(P.next() * 2.0))
		var p := fposmod(ph + t * cyc, 1.0)
		var at := Vector2(-r * (0.7 + 6.5 * p), side * r * (0.25 + 1.1 * p) + r * 0.5 * p * p)
		out.append({"lump": _ice_lump(Rand.new(key * 7 + k * 131 + 3), at, size0 * (1.0 - 0.4 * p), rot + spin * p * TAU, sides), "alpha": _smooth(0.0, 0.08, p) * pow(1.0 - p, 1.2)})
	return out

# 头部：在 (0, 0)，朝 +x 飞，一遍翻滚一整圈；still：原地循环时自带寒气和碎冰
func _remote_ice(r: float, key: int, still := false) -> void:
	if still:
		var pts := PackedVector2Array()
		for i in 9: pts.append(Vector2(-r * 6.0 * (1.0 - i / 8.0), 0.0))
		_remote_ice_vapor(pts, r, 1.0, 1.0, key)
		for chip in _ice_still_chips(r, _t, key):
			_ice_draw_lump(chip.lump, chip.alpha, maxf(0.5, r * 0.04))
	var col := _ice_cols()
	_add = additive
	_blob(Vector2.ZERO, 2.2 * r, [[0.0, rim_color, 0.28], [0.5, rim_color, 0.1], [1.0, rim_color, 0.0]], Vector2(1.3, 1.0))
	_blob(Vector2(0.7 * r, 0.0), 1.1 * r, [[0.0, core_color, 0.25], [1.0, rim_color, 0.0]])
	var head := _ice_lump(Rand.new(key * 97 + 5), Vector2.ZERO, r, _t * TAU, 9, 1.35)
	_ice_draw_lump(head, 1.0, maxf(0.6, r * 0.07))
	_add = additive
	var mid: Vector2 = head.mid
	var hp: PackedVector2Array = head.pts
	var inner := PackedVector2Array()
	for p in hp: inner.append(mid + (p - mid) * 0.55)
	_poly_fill(inner, PackedColorArray([_col(core_color, 0.18)]))
	for k in [1, 4, 6]:
		_line(PackedVector2Array([mid, mid + (hp[k] - mid) * 0.75]), PackedColorArray([_col(core_color, 0.35)]), maxf(0.4, r * 0.035))
	_blob(mid + ICE_LIGHT * r * 0.45, 0.3 * r, [[0.0, core_color, 0.6], [1.0, core_color, 0.0]])

# 冰面上的四角闪光
func _ice_twinkle(p: Vector2, size0: float, a: float) -> void:
	if a <= 0.01: return
	_blob(p, size0, [[0.0, core_color, 0.8 * a], [1.0, rim_color, 0.0]])
	for d in [Vector2(-1, 0), Vector2(1, 0), Vector2(0, -1), Vector2(0, 1)]:
		_streak(p + d * size0 * 1.8, p, rim_color, core_color, 0.75 * a, maxf(0.4, size0 * 0.22))
`;
