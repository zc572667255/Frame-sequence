// 冰矛的魔法层（vfx/kinds/icemagic.js 的同一套公式）：光刃弹头、交织彩带、霜线雾带、
// 霜尘闪光、出手月牙光环和命中冰晶爆发。
export const ICE_MAGIC_GD = `
const _ICE_STRANDS := [[-1.0, 0.85, 0.3, 0.29, 0.7], [1.0, 1.15, 0.35, 0.21, 2.1], [-1.0, 0.16, 0.14, 0.43, 4.0]]
const _ICE_RIBBONS := [[0.4, 0.9, 0.3, 1.2, 1.0], [2.5, 1.3, -0.22, 0.95, 0.9], [4.5, 0.7, 0.18, 1.35, 1.1], [1.3, 1.8, 0.4, 0.6, 0.55]]

func _ice_hue(c: Color, deg: float, boost := 1.25) -> Color:
	return Color.from_hsv(fposmod(c.h + deg / 360.0, 1.0), minf(1.0, c.s * boost + 0.1), c.v)

func _ice_ribbon_colors() -> Array:
	return [_ice_hue(rim_color, 0.0), _ice_hue(rim_color, 42.0), _ice_hue(rim_color, 105.0), rim_color.lerp(Color.WHITE, 0.55)]

func _ice_spread(r: float, width: float, strength: float) -> float:
	return maxf(0.0, r) * (0.35 + 0.7 * clampf(width, 0.0, 180.0) / 100.0) * sqrt(maxf(0.0, strength)) * 1.6

func _ice_envelope(u: float) -> float:
	return pow(clampf(u, 0.0, 1.0), 0.55) * pow(clampf(1.0 - u, 0.0, 1.0), 0.75) * 2.3

func _ice_line(points: PackedVector2Array, n := 40) -> Dictionary:
	var pts := PackedVector2Array()
	for p in points:
		if pts.is_empty() or pts[pts.size() - 1].distance_to(p) > 0.35: pts.append(p)
	if pts.size() < 2: return {}
	var lengths := PackedFloat32Array([0.0])
	for i in range(1, pts.size()): lengths.append(lengths[i - 1] + pts[i - 1].distance_to(pts[i]))
	var total := lengths[pts.size() - 1]
	if total < 0.5: return {}
	var at := PackedVector2Array()
	var dirs := PackedVector2Array()
	var us := PackedFloat32Array()
	var i := 1
	for k in n + 1:
		var u := float(k) / float(n)
		var dist := u * total
		while i < pts.size() - 1 and lengths[i] < dist: i += 1
		var seg := maxf(0.000001, lengths[i] - lengths[i - 1])
		var f := clampf((dist - lengths[i - 1]) / seg, 0.0, 1.0)
		var d := pts[i] - pts[i - 1]
		at.append(pts[i - 1] + d * f)
		dirs.append(d / maxf(0.000001, d.length()))
		us.append(u)
	return {"p": at, "d": dirs, "u": us}

func _ice_strand(k: int, born: float, seed: int) -> float:
	var st: Array = _ICE_STRANDS[k]
	return st[0] * (st[1] + st[2] * sin(born * st[3] + st[4] + seed * 0.37))

func _ice_open(age: float) -> float:
	return 0.45 + 0.55 * _smooth(0.0, 6.0, age)

# 两色线性渐变填充（顶点色按到渐变轴的投影算，和 Canvas 的 createLinearGradient 一样）
func _ice_grad_fill(poly: PackedVector2Array, from: Vector2, to: Vector2, c0: Color, a0: float, c1: Color, a1: float) -> void:
	var axis := to - from
	var l2 := maxf(0.000001, axis.length_squared())
	var k0 := _col(c0, a0)
	var k1 := _col(c1, a1)
	var cols := PackedColorArray()
	for q in poly: cols.append(k0.lerp(k1, clampf((q - from).dot(axis) / l2, 0.0, 1.0)))
	_poly_fill(poly, cols)

func _ice_crystal_shape(root: Vector2, angle: float, length0: float, width0: float) -> PackedVector2Array:
	var d := Vector2.from_angle(angle)
	var nv := Vector2(-d.y, d.x)
	return PackedVector2Array([root + d * (-length0 * 0.04) + nv * width0 * 0.45, root + d * length0 * 0.2 + nv * width0, root + d * length0, root + d * length0 * 0.13 - nv * width0 * 0.8, root + d * (-length0 * 0.04) - nv * width0 * 0.5])

func _ice_crystal(root: Vector2, angle: float, length0: float, width0: float, alpha: float) -> void:
	if alpha <= 0.004 or length0 <= 0.4: return
	var d := Vector2.from_angle(angle)
	var groot := root - d * length0 * 0.04
	var glow := _ice_crystal_shape(groot, angle, length0 * 1.08, width0 * 2.0)
	var c := _ice_crystal_shape(root, angle, length0, width0)
	var body := _ice_hue(rim_color, 12.0)
	var edge := rim_color.lerp(Color.WHITE, 0.6)
	_ice_grad_fill(glow, root, glow[2], body, alpha * 0.12, body, alpha * 0.04)
	_ice_grad_fill(c, root, c[2], body, alpha * 0.3, body.lerp(Color.WHITE, 0.4), alpha * 0.9)
	_line(PackedVector2Array([root + d * length0 * 0.08, root + d * length0 * 0.9]), PackedColorArray([_col(Color.WHITE, alpha * 0.3)]), maxf(0.5, width0 * 0.25))
	_line(PackedVector2Array([c[0], c[1], c[2]]), PackedColorArray([_col(edge, alpha * 0.95)]), maxf(0.5, width0 * 0.2))
	_line(PackedVector2Array([c[3], c[2]]), PackedColorArray([_col(edge, alpha * 0.4)]), maxf(0.4, width0 * 0.12))

func _ice_glint(at0: Vector2, size0: float, col: Color, alpha: float, turn := 0.0) -> void:
	if alpha <= 0.004: return
	for j in 2:
		var d := Vector2.from_angle(turn + j * PI / 2.0) * size0 * (2.2 if j else 3.4)
		_line(PackedVector2Array([at0 - d, at0 + d]), PackedColorArray([_col(col, alpha)]), maxf(0.5, size0 * 0.35))
	_blob(at0, size0 * 1.6, [[0.0, Color.WHITE, alpha], [1.0, col, 0.0]])

func _ice_taper(line: Dictionary, offsets: PackedFloat32Array, widths: PackedFloat32Array, alphas: PackedFloat32Array, col: Color, scale0: float, amul: float) -> void:
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var ws := PackedFloat32Array()
	var p: PackedVector2Array = line.p
	var d: PackedVector2Array = line.d
	for i in p.size():
		pts.append(p[i] + Vector2(-d[i].y, d[i].x) * offsets[i])
		cols.append(_col(col, alphas[i] * amul))
		ws.append(widths[i] * scale0)
	_line(pts, cols, 1.0, ws)

func _ice_magic_wake(pts: PackedVector2Array, r: float, strength: float, frame: float, index: int) -> void:
	var line := _ice_line(pts)
	if line.is_empty() or strength <= 0.001: return
	var cols := _ice_ribbon_colors()
	var us: PackedFloat32Array = line.u
	var p: PackedVector2Array = line.p
	var d: PackedVector2Array = line.d
	var n := us.size()
	var W := _ice_spread(r, trail_width, strength)
	var zero := PackedFloat32Array()
	zero.resize(n)
	zero.fill(0.0)
	_add = additive
	var hw := PackedFloat32Array()
	var ha := PackedFloat32Array()
	for u in us:
		hw.append(W * (0.35 + 1.5 * _ice_envelope(u)))
		ha.append(strength * _smooth(0.0, 0.4, u) * (1.0 - _smooth(0.75, 1.0, u)) * 0.16)
	_ice_taper(line, zero, hw, ha, colors[0], 1.0, 1.0)
	for k in _ICE_RIBBONS.size():
		var rb: Array = _ICE_RIBBONS[k]
		var offs := PackedFloat32Array()
		var ws := PackedFloat32Array()
		var al := PackedFloat32Array()
		var hot := PackedFloat32Array()
		for u in us:
			offs.append(W * rb[3] * _ice_envelope(u) * sin(rb[0] + (1.0 - u) * rb[1] * PI + frame * rb[2]))
			ws.append(maxf(0.6, r * (0.05 + 0.13 * u) * rb[4]))
			var a := strength * _smooth(0.0, 0.35, u) * (0.55 + 0.45 * u)
			al.append(a)
			hot.append(a * u)
		_ice_taper(line, offs, ws, al, cols[k], 3.2, 0.28)
		_ice_taper(line, offs, ws, al, cols[k].lerp(Color.WHITE, 0.3), 1.0, 0.9)
		_ice_taper(line, offs, ws, hot, Color.WHITE, 0.3, 0.7)
	var cw := PackedFloat32Array()
	var ca := PackedFloat32Array()
	for u in us:
		cw.append(r * 0.42 * pow(u, 1.6) + 0.6)
		ca.append(strength * _smooth(0.25, 0.9, u))
	_ice_taper(line, zero, cw, ca, rim_color, 2.6, 0.35)
	_ice_taper(line, zero, cw, ca, Color.WHITE, 1.0, 0.95)
	var window := _remote_window(frame, index)
	var oldest := window.x
	var newest := window.y
	var span := maxf(0.001, newest - oldest)
	var seed := random_seed + index * 31
	var rate := maxf(0.25, minf(2.0, amount))
	# 霜线上的雾带
	var mist := rim_color.lerp(Color.WHITE, 0.6)
	for k in 2:
		var offs := PackedFloat32Array()
		var ws := PackedFloat32Array()
		var al := PackedFloat32Array()
		for u in us:
			var born := oldest + u * span
			offs.append(_ice_strand(k, born, seed) * W * _ice_open(newest - born))
			ws.append(r * (0.16 + 0.42 * _smooth(0.0, 0.5, u)))
			al.append(strength * _smooth(0.0, 0.4, u) * (1.0 - _smooth(0.8, 1.0, u)))
		_ice_taper(line, offs, ws, al, mist, 2.4, 0.09)
		_ice_taper(line, offs, ws, al, mist, 0.8, 0.2)
	var step := 0.03 / rate
	for m in range(ceili(oldest / step), floori(newest / step + 0.000001) + 1):
		var born := m * step
		var u := clampf((born - oldest) / span, 0.0, 1.0)
		var age := newest - born
		var i := roundi(u * (n - 1))
		var P := Rand.new(seed * 733 + m * 53)
		P.next()
		var pick := P.next()
		var k := 0 if pick < 0.36 else (1 if pick < 0.72 else (2 if pick < 0.84 else 3))
		var j1 := P.next()
		var j2 := P.next()
		var star := P.next() < 0.13
		var tw := P.next()
		var a := P.next()
		var tone := P.next()
		var off := 0.0
		if k < 3: off = (_ice_strand(k, born, seed) + (j1 - 0.5) * 0.14) * W * _ice_open(age) + (j2 - 0.5) * r * 0.06 * age
		else: off = (j1 * 2.0 - 1.0) * W * (0.25 + 0.75 * _ice_envelope(u)) + (j1 * 2.0 - 1.0) * r * 0.08 * age
		var size0 := maxf(0.7, r * (0.022 + j2 * 0.04))
		var twinkle := 0.55 + 0.45 * sin(frame * 1.7 + tw * TAU)
		var alpha := strength * _smooth(0.0, 0.2, u) * (0.3 + 0.7 * a) * twinkle * (1.2 if k < 3 else 0.6)
		var at0 := p[i] + Vector2(-d[i].y, d[i].x) * off + Vector2(0.0, r * 0.02 * age)
		var col := rim_color.lerp(Color.WHITE, 0.5 + tone * 0.5)
		if star: _ice_glint(at0, size0, col, alpha, tone)
		elif alpha > 0.004: _tri_rect(Rect2(at0 - Vector2.ONE * size0 * 0.5, Vector2.ONE * size0), _col(col, alpha))

# 弹头的光刃：[上缘, 下缘] 两串点（r 的倍数，+x 朝前）
func _ice_blade(r: float, scale0 := 1.0, n := 16) -> PackedVector2Array:
	var back := -2.6
	var tip := 4.2
	var top := PackedVector2Array()
	var bottom := PackedVector2Array()
	for k in n + 1:
		var s := float(k) / float(n)
		var x := (back + (tip - back) * s) * r
		var f := pow(s, 0.35) * pow(1.0 - s, 1.2) * 2.29
		var y := -r * 0.16 * sin(PI * s)
		top.append(Vector2(x, y - r * 0.36 * f * scale0))
		bottom.append(Vector2(x, y + r * 0.2 * f * scale0))
	var poly := PackedVector2Array(top)
	for k in range(n - 1, 0, -1): poly.append(bottom[k])
	return poly

func _ice_spear(r: float, key: int) -> void:
	var cols := _ice_ribbon_colors()
	var pulse := 0.9 + 0.1 * sin(_t * TAU * 3.0)
	_add = additive
	_blob(Vector2(-r * 0.12 * 3.4, 0.0), r * 2.2, [[0.0, rim_color, 0.65], [0.45, cols[1], 0.22], [1.0, cols[1], 0.0]], Vector2(3.4, 0.6))
	var P := Rand.new(key * 977 + 5)
	for j in 7:
		var side := -1.0 if P.next() < 0.62 else 1.0
		var x := -r * (0.4 + P.next() * 1.8)
		var lean := 0.22 + P.next() * 0.4
		var lr := P.next()
		var wr := P.next()
		var len0 := r * (0.7 + 1.1 * pow(lr, 1.4)) * (0.94 + 0.06 * sin(_t * TAU * 2.0 + j))
		_ice_crystal(Vector2(x, -r * 0.12 + side * r * 0.12), PI - side * lean, len0, len0 * (0.07 + 0.05 * wr) + r * 0.025, 0.42)
	_blob(Vector2(r * 0.15 * 3.6, -r * 0.3 * 0.4), r * 1.2, [[0.0, rim_color, 0.55], [1.0, rim_color, 0.0]], Vector2(3.6, 0.4))
	var back := Vector2(-2.6 * r, 0.0)
	var tip := Vector2(4.2 * r, 0.0)
	var blade := _ice_blade(r)
	_ice_grad_fill(blade, back, tip, rim_color, 0.0, rim_color.lerp(Color.WHITE, 0.55), 0.9)
	_ice_grad_fill(_ice_blade(r, 0.4), back, tip, Color.WHITE, 0.2, Color.WHITE, 1.0)
	_line(blade.slice(2, 17), PackedColorArray([_col(rim_color.lerp(Color.WHITE, 0.7), 0.75)]), maxf(0.6, r * 0.05))
	_blob(Vector2(-r * 0.3, -r * 0.08), r * 0.8 * pulse, [[0.0, Color.WHITE, 0.8], [0.4, rim_color, 0.3], [1.0, rim_color, 0.0]])
	_line(PackedVector2Array([tip - Vector2(r * 0.2, 0.0), tip + Vector2(r * 0.9, 0.0)]), PackedColorArray([_col(Color.WHITE, 0.75), _col(Color.WHITE, 0.0)]), maxf(0.6, r * 0.06))

func _ice_muzzle(at0: Vector2, angle: float, r: float, age: float) -> void:
	var life := 9.0
	if age < 0.0 or age >= life: return
	var f := age / life
	var a := pow(1.0 - f, 1.5)
	var R := r * (1.0 + f * 2.2)
	var cols := _ice_ribbon_colors()
	var xf := _xf
	_xf = xf * Transform2D(angle, at0)
	_add = additive
	_ring(Vector2.ZERO, R, maxf(0.6, r * 0.09), 1.0, Color.WHITE, a * 0.9, 0.3)
	_ring(Vector2.ZERO, R * 1.18, maxf(0.6, r * 0.14), 1.0, cols[0], a * 0.55, 0.32)
	_ring(Vector2.ZERO, R * 0.8, maxf(0.6, r * 0.1), 1.0, cols[2], a * 0.35, 0.28)
	_blob(Vector2.ZERO, r * 1.4 * (1.0 - f), [[0.0, Color.WHITE, a * 0.8], [1.0, rim_color, 0.0]])
	_xf = xf

func _ice_burst(radius: float, key: int, t: float, angle: float) -> void:
	var P := Rand.new(key * 1009 + 17)
	var grow := 1.0 - pow(1.0 - clampf(t / 0.12, 0.0, 1.0), 3.0)
	var fade := 1.0 - _smooth(0.55, 1.0, t)
	var cols := _ice_ribbon_colors()
	var wave := 1.0 - pow(1.0 - clampf(t / 0.5, 0.0, 1.0), 2.0)
	_add = additive
	_ring(Vector2.ZERO, maxf(0.6, wave * radius * 1.05), maxf(0.8, radius * 0.05), 0.55, cols[1], (1.0 - t) * 0.6)
	_ring(Vector2.ZERO, maxf(0.6, wave * radius * 1.4), maxf(0.6, radius * 0.025), 0.55, cols[2], (1.0 - t) * 0.45)
	for j in 9:
		var a := angle + PI + (j - 4) * 0.62 + (P.next() - 0.5) * 0.4
		var len0 := radius * (0.45 + P.next() * 0.75) * grow
		var w := len0 * (0.08 + P.next() * 0.05) + radius * 0.015
		_ice_crystal(Vector2.ZERO, a, len0, w, fade * (0.7 + 0.3 * P.next()))
	var move := 1.0 - pow(1.0 - clampf(t / 0.7, 0.0, 1.0), 2.0)
	var col := rim_color.lerp(Color.WHITE, 0.6)
	for j in roundi(16.0 * maxf(0.25, minf(2.0, amount))):
		var a := P.next() * TAU
		var dd := radius * (0.2 + P.next() * 0.95) * move
		var life := 0.55 + P.next() * 0.45
		var tw := 0.6 + 0.4 * sin(t * 40.0 + j * 2.3)
		var at0 := Vector2(cos(a) * dd, sin(a) * dd * 0.75 + radius * 0.15 * t * t)
		var size0 := maxf(0.6, radius * (0.02 + P.next() * 0.03))
		var alpha := (1.0 - _smooth(life * 0.5, life, t)) * tw
		if j % 3 == 0: _ice_glint(at0, size0, col, alpha, t * 3.0)
		elif alpha > 0.004: _tri_rect(Rect2(at0 - Vector2.ONE * size0 * 0.5, Vector2.ONE * size0), _col(col, alpha))
	var flash := 1.0 - _smooth(0.0, 0.18, t)
	_blob(Vector2.ZERO, radius * 1.1, [[0.0, Color.WHITE, flash * 0.9], [0.3, rim_color, flash * 0.45], [1.0, cols[1], 0.0]])
`;
