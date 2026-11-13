// 冰矛 as an ice lance, drawn the same way as vfx/kinds/ice.js: a long,
// needle-sharp spear of ice with shards along its shaft, two ribbons of magic
// in two of the palette's colours spiralling round it and trailing back along
// the flight, a haze and star glints.
export const ICE_GD = `
# 颜色都取自配色：冰枪用亮色；两条光带一条用边缘色，另一条用配色里（除了接近白色的）和边缘色差别最大的那个，
# 提亮到能发光；光晕在最深的颜色和第二条光带之间
func _ice_cols() -> Dictionary:
	var blue: Color = colors[1] if colors.size() > 1 else rim_color
	var second: Color = colors[0]
	var best := -1.0
	var cands := Array(colors)
	cands.append(splat_color)
	for c in cands:
		var cc: Color = c
		var lum := 0.299 * cc.r + 0.587 * cc.g + 0.114 * cc.b
		var far := Vector3(cc.r - rim_color.r, cc.g - rim_color.g, cc.b - rim_color.b).length()
		if lum <= 215.0 / 255.0 and far > best:
			best = far
			second = cc
	var top := maxf(1.0 / 255.0, maxf(second.r, maxf(second.g, second.b)))
	var lift := 200.0 / 255.0 / top if top < 200.0 / 255.0 else 1.0
	var ribbon := Color(minf(1.0, second.r * lift), minf(1.0, second.g * lift), minf(1.0, second.b * lift))
	return {
		"core": core_color, "rim": rim_color, "blue": blue, "pale": blue.lerp(core_color, 0.55),
		"ribbon_a": rim_color, "ribbon_b": ribbon, "haze": (colors[0] as Color).lerp(ribbon, 0.5),
	}

# 每一遍（循环）转几圈：大约 8 帧一圈
func _ice_cycles() -> int:
	return maxi(1, roundi(frames / 8.0))

# 路径从最老的点到头部，从头部往回量；d < 0 在头部前面、d > 全长在最老的点后面，都沿直线延长
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
	var len0: float = path.len
	var ahead := minf(0.0, d) + maxf(0.0, d - len0)
	d = clampf(d, 0.0, len0)
	var i := 1
	while i < rev.size() - 1 and ds[i] < d: i += 1
	var a := rev[i - 1]
	var b := rev[i]
	var s := ds[i] - ds[i - 1]
	var k := (d - ds[i - 1]) / s if s > 1e-9 else 0.0
	var dir := b - a
	var l := dir.length()
	if l < 1e-9: l = 1.0
	return a + dir * k + dir / l * ahead + Vector2(-dir.y, dir.x) / l * off

# 冰枪（它自己的坐标，x 朝前，尖在 2.6 r）：边缘稍微不平的轮廓，和枪身上的碎冰片
func _ice_lance(r: float, key: int) -> Dictionary:
	var P := Rand.new(key * 97 + 5)
	var xs := [1.4, 0.6, -0.4, -1.8, -3.5, -5.0]
	var hw := [0.2, 0.28, 0.32, 0.28, 0.18, 0.06]
	var up := PackedVector2Array()
	var dn := PackedVector2Array()
	for i in xs.size():
		up.append(Vector2(xs[i] * r, -hw[i] * r * (0.85 + 0.3 * P.next())))
		dn.append(Vector2(xs[i] * r, hw[i] * r * (0.85 + 0.3 * P.next())))
	dn.reverse()
	var outline := PackedVector2Array([Vector2(2.6 * r, 0.0)])
	outline.append_array(up)
	outline.append(Vector2(-5.4 * r, 0.0))
	outline.append_array(dn)
	var shards := []
	for i in 7:
		var x := r * (1.0 - 5.0 * i / 6.0 + (P.next() - 0.5) * 0.4)
		var side := 1.0 if i % 2 else -1.0
		var len0 := r * (0.7 + 0.5 * P.next()) * (1.0 - 0.08 * i)
		shards.append({"at": Vector2(x, side * r * (0.08 + 0.12 * P.next())), "angle": PI + side * (0.25 + 0.25 * P.next()), "len": len0, "width": len0 * 0.2, "alpha": 0.95 - 0.1 * i})
	return {"outline": outline, "tip": Vector2(2.6 * r, 0.0), "back": Vector2(-5.4 * r, 0.0), "shards": shards}

# 一小片菱形的冰，从 at 指向 angle
func _ice_chip(at: Vector2, angle: float, len0: float, width: float) -> PackedVector2Array:
	var xf := Transform2D(angle, at)
	return PackedVector2Array([xf * Vector2.ZERO, xf * Vector2(len0 * 0.35, -width), xf * Vector2(len0, 0.0), xf * Vector2(len0 * 0.35, width)])

func _ice_fill_chip(pts: PackedVector2Array, fill: Color, a_fill: float, a_edge: float, lw: float) -> void:
	_poly_fill(pts, PackedColorArray([_col(fill, a_fill)]))
	var ring0 := pts.duplicate()
	ring0.append(pts[0])
	_line(ring0, PackedColorArray([_col(core_color, a_edge)]), lw)

# 星形闪光：六道细光芒和柔和的中心
func _ice_star(p: Vector2, size0: float, a: float) -> void:
	if a <= 0.01: return
	_blob(p, size0 * 0.8, [[0.0, core_color, 0.8 * a], [1.0, rim_color, 0.0]])
	for k in 6:
		var th := k * PI / 3.0
		var l := size0 * (2.0 if k % 3 == 0 else 1.3)
		_streak(p + Vector2.from_angle(th) * l, p, rim_color, core_color, 0.8 * a, maxf(0.4, size0 * 0.2))

# 两条光带和闪光点（任意一帧都能直接算出来）：光带从枪尖前面一点开始，沿路径往后
func _ice_swirl(len0: float, r: float, t: float, key: int, quantity: float, width: float) -> Dictionary:
	var ph := t * TAU * _ice_cycles()
	var P := Rand.new(key * 173 + 41)
	var ribbons := []
	var glints := []
	var reach := maxf(r * 8.0, minf(len0 + r * 4.0, r * 16.0))
	var M := clampi(roundi(reach / (r * 0.15)), 12, 140)
	for j in 2:
		var pts := []
		for k in M + 1:
			var d := -r * 2.2 + (reach + r * 2.2) * k / M
			var f := clampf((d + r * 2.2) / (reach + r * 2.2), 0.0, 1.0)
			var a := d / (r * 2.4) - ph * 2.0 + j * PI
			var grow := _smooth(0.0, 0.15, f)
			var amp := r * (0.3 + 0.55 * minf(1.0, f * 3.0)) * width
			var near := 0.5 + 0.5 * cos(a)
			pts.append({"d": d, "off": sin(a) * amp, "w": maxf(0.5, r * 0.36 * (0.35 + 0.65 * near) * pow(1.0 - f, 0.7) * grow), "a": (0.4 + 0.6 * near) * pow(1.0 - f, 0.9) * grow})
		ribbons.append(pts)
	for k in roundi(14.0 * maxf(0.0, quantity)):
		var d := -r * 1.5 + P.next() * (reach + r * 1.5)
		var f := maxf(0.0, (d + r * 1.5) / (reach + r * 1.5))
		var off := (P.next() - 0.5) * r * 1.6 * width
		var size0 := r * (0.12 + 0.16 * P.next())
		var tw := P.next() * TAU
		glints.append({"d": d, "off": off, "size": size0, "a": (0.4 + 0.6 * (0.5 + 0.5 * sin(ph * 2.0 + tw))) * (1.0 - f)})
	return {"ribbons": ribbons, "glints": glints, "reach": reach}

# 跟着飞行的部分：光晕、两条光带、闪光点
func _remote_ice_tail(pts: PackedVector2Array, r: float, strength: float, width: float, key: int) -> void:
	if pts.size() < 2: return
	var path := _ice_along(pts)
	var col := _ice_cols()
	var sw := _ice_swirl(path.len, r, _t, key, amount, width)
	var reach: float = sw.reach
	_add = additive
	var N := maxi(4, roundi(reach / (r * 0.4)))
	for k in N + 1:
		var d := reach * k / N
		var f := d / reach
		var a := 0.14 * _smooth(0.0, 0.2, f) * pow(1.0 - f, 0.8) * strength
		_blob(_ice_place(path, d, 0.0), r * (1.2 - 0.6 * f) * width, [[0.0, col.haze, a], [0.5, col.haze, a * 0.5], [1.0, col.haze, 0.0]])
	# 每条光带是一条带子（不重叠，叠加时不会出现一颗颗的亮点）：有颜色的宽带，里面一道亮线
	for j in 2:
		var rb: Array = sw.ribbons[j]
		var tone: Color = col.ribbon_b if j else col.ribbon_a
		for layer in [[1.0, 0.0, 0.9], [0.35, 0.6, 0.6]]:
			var c0 := tone.lerp(core_color, layer[1])
			var vp := PackedVector2Array()
			var vc := PackedColorArray()
			var idx := PackedInt32Array()
			for q in rb:
				var hw: float = float(q.w) * float(layer[0]) / 2.0
				vp.append(_ice_place(path, q.d, float(q.off) - hw))
				vp.append(_ice_place(path, q.d, float(q.off) + hw))
				var cc := _col(c0, float(q.a) * float(layer[2]) * strength)
				vc.append(cc)
				vc.append(cc)
			for k in range(1, rb.size()):
				var b := (k - 1) * 2
				idx.append_array(PackedInt32Array([b, b + 2, b + 3, b, b + 3, b + 1]))
			_tri(idx, vp, vc)
	for g0 in sw.glints:
		_ice_star(_ice_place(path, g0.d, g0.off), g0.size, float(g0.a) * strength)

# 冰枪：在 (0, 0)，朝 +x 飞；still：原地循环时身后自带一段直的飞行轨迹，光带沿着它
func _remote_ice(r: float, key: int, still := false) -> void:
	if still:
		var pts := PackedVector2Array()
		for i in 9: pts.append(Vector2(-r * 12.0 * (1.0 - i / 8.0), 0.0))
		_remote_ice_tail(pts, r, 1.0, 1.0, key)
	var col := _ice_cols()
	var L := _ice_lance(r, key)
	_add = additive
	_blob(Vector2(-1.2 * r, 0.0), 1.6 * r, [[0.0, col.blue, 0.32], [0.5, col.blue, 0.12], [1.0, col.blue, 0.0]], Vector2(3.2, 0.7))
	# 冰本身：尖上是实的，往后渐渐融进速度里
	_add = false
	var outline: PackedVector2Array = L.outline
	var x0: float = (L.back as Vector2).x
	var x1: float = (L.tip as Vector2).x
	var cl := PackedColorArray()
	for p in outline:
		var u := clampf((p.x - x0) / (x1 - x0), 0.0, 1.0)
		var c: Color
		if u < 0.5:
			c = _col((col.blue as Color).lerp(col.pale, u * 2.0), 0.55 * u * 2.0)
		else:
			c = _col((col.pale as Color).lerp(col.core, (u - 0.5) * 2.0), lerpf(0.55, 0.95, (u - 0.5) * 2.0))
		cl.append(c)
	_poly_fill(outline, cl)
	_add = additive
	for s in L.shards:
		_ice_fill_chip(_ice_chip(s.at, s.angle, s.len, s.width), col.blue, 0.55 * float(s.alpha), 0.6 * float(s.alpha), maxf(0.4, r * 0.03))
	var tip: Vector2 = L.tip
	_streak(Vector2((L.back as Vector2).x * 0.8, 0.0), tip, rim_color, core_color, 0.9, maxf(0.5, r * 0.12))
	_blob(tip, 0.55 * r, [[0.0, core_color, 0.75], [1.0, rim_color, 0.0]])
	for d in [Vector2(0.9, 0.0), Vector2(-0.9, 0.0), Vector2(0.0, 0.45), Vector2(0.0, -0.45)]:
		_streak(tip + d * r, tip, rim_color, core_color, 0.7, maxf(0.4, r * 0.06))
`;
