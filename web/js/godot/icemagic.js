// 冰矛的魔法层（vfx/kinds/icemagic.js 的同一套公式）：白芯、交织彩带、沿路冰刺、
// 霜尘闪光、出手月牙光环和命中冰晶爆发。
export const ICE_MAGIC_GD = `
const _ICE_RIBBONS := [[0.4, 0.9, 0.3, 1.2, 1.0], [2.5, 1.3, -0.22, 0.95, 0.9], [4.5, 0.7, 0.18, 1.35, 1.1], [1.3, 1.8, 0.4, 0.6, 0.55]]

func _ice_hue(c: Color, deg: float, boost := 1.25) -> Color:
	return Color.from_hsv(fposmod(c.h + deg / 360.0, 1.0), minf(1.0, c.s * boost + 0.1), c.v)

func _ice_ribbon_colors() -> Array:
	return [_ice_hue(rim_color, 0.0), _ice_hue(rim_color, 42.0), _ice_hue(rim_color, 105.0), rim_color.lerp(Color.WHITE, 0.55)]

func _ice_spread(r: float, width: float, strength: float) -> float:
	return maxf(0.0, r) * (0.35 + 0.7 * clampf(width, 0.0, 180.0) / 100.0) * sqrt(maxf(0.0, strength)) * 1.6

func _ice_envelope(u: float) -> float:
	return pow(clampf(u, 0.0, 1.0), 0.55) * pow(clampf(1.0 - u, 0.0, 1.0), 0.35) * 1.9

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

func _ice_kite(root: Vector2, angle: float, length0: float, width0: float, alpha: float) -> void:
	if alpha <= 0.004 or length0 <= 0.4: return
	var d := Vector2.from_angle(angle)
	var nv := Vector2(-d.y, d.x) * width0
	var tip := root + d * length0
	var mid := root + d * length0 * 0.3
	var c0 := _col(rim_color, alpha * 0.35)
	var c1 := _col(core_color.lerp(rim_color, 0.2), alpha * 0.95)
	_poly_fill(PackedVector2Array([root - d * width0 * 0.6, mid + nv, tip, mid - nv]), PackedColorArray([c0, c0.lerp(c1, 0.3), c1, c0.lerp(c1, 0.3)]))
	_line(PackedVector2Array([mid + nv, tip]), PackedColorArray([_col(core_color, alpha * 0.85)]), maxf(0.5, width0 * 0.22))

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
		ha.append(strength * _smooth(0.0, 0.4, u) * 0.16)
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
	var step := 0.5 / rate
	for m in range(ceili(oldest / step), floori(newest / step + 0.000001) + 1):
		var born := m * step
		var u := clampf((born - oldest) / span, 0.0, 1.0)
		var age := newest - born
		var i := roundi(u * (n - 1))
		var P := Rand.new(seed * 613 + m * 131)
		P.next()
		var side := -1.0 if P.next() < 0.5 else 1.0
		var off := side * W * (0.12 + P.next() * 0.5) * (0.35 + _ice_envelope(u) * 0.65)
		var tilt := 0.5 + P.next() * 0.7
		var ang := d[i].angle() + side * (PI - tilt)
		var length0 := r * (0.35 + P.next() * 0.75) * (0.4 + 0.6 * u) * _smooth(0.0, 1.2, age)
		var width0 := length0 * (0.16 + P.next() * 0.1)
		var alpha := strength * _smooth(0.0, 0.25, u) * (0.6 + 0.4 * P.next())
		if length0 > 0.4: _ice_kite(p[i] + Vector2(-d[i].y, d[i].x) * off, ang, length0, width0, alpha)
	step = 0.12 / rate
	for m in range(ceili(oldest / step), floori(newest / step + 0.000001) + 1):
		var born := m * step
		var u := clampf((born - oldest) / span, 0.0, 1.0)
		var age := newest - born
		var i := roundi(u * (n - 1))
		var P := Rand.new(seed * 733 + m * 53)
		P.next()
		var side := P.next() * 2.0 - 1.0
		var off := side * W * (0.25 + 0.75 * _ice_envelope(u)) + side * r * 0.08 * age
		var size0 := maxf(0.6, r * (0.025 + P.next() * 0.045))
		var star := P.next() < 0.12
		var twinkle := 0.55 + 0.45 * sin(frame * 1.7 + P.next() * TAU)
		var alpha := strength * _smooth(0.0, 0.2, u) * (0.35 + 0.65 * P.next()) * twinkle
		var tone := P.next()
		var at0 := p[i] + Vector2(-d[i].y, d[i].x) * off + Vector2(0.0, r * 0.02 * age)
		var col := rim_color.lerp(Color.WHITE, 0.4 + tone * 0.6)
		if star: _ice_glint(at0, size0, col, alpha, tone)
		elif alpha > 0.004: _tri_rect(Rect2(at0 - Vector2.ONE * size0 * 0.5, Vector2.ONE * size0), _col(col, alpha))

func _ice_head_back(r: float, key: int) -> void:
	var cols := _ice_ribbon_colors()
	_add = additive
	_blob(Vector2(-r * 0.1 * 2.6, 0.0), r * 2.3, [[0.0, rim_color, 0.42], [0.5, cols[1], 0.14], [1.0, cols[1], 0.0]], Vector2(2.6, 0.7))
	_blob(Vector2(-r * 0.55 * 3.2, 0.0), r * 2.2, [[0.0, cols[2], 0.16], [1.0, cols[2], 0.0]], Vector2(3.2, 0.5))
	var P := Rand.new(key * 977 + 5)
	for j in 6:
		var side := -1.0 if j % 2 else 1.0
		var x := -r * (1.3 - P.next() * 2.1)
		var tilt := 0.45 + P.next() * 0.55
		var len0 := r * (0.8 + P.next() * 0.9) * (0.92 + 0.08 * sin(_t * TAU * 2.0 + j))
		_ice_kite(Vector2(x, side * r * 0.25), side * (PI - tilt), len0, len0 * 0.2, 0.75)

func _ice_head_front(r: float, tip: Vector2) -> void:
	_add = additive
	var back := Vector2(-r * 1.6, 0.0)
	var ctrl := r * 0.6
	var upper := PackedVector2Array()
	var lower := PackedVector2Array()
	for k in 13:
		var s := float(k) / 12.0
		var a := back.lerp(Vector2(ctrl, -r * 0.34), s)
		var b := Vector2(ctrl, -r * 0.34).lerp(tip, s)
		upper.append(a.lerp(b, s))
		var c := back.lerp(Vector2(ctrl, r * 0.34), s)
		var e := Vector2(ctrl, r * 0.34).lerp(tip, s)
		lower.append(c.lerp(e, s))
	var poly := PackedVector2Array()
	poly.append_array(upper)
	for k in range(lower.size() - 2, 0, -1): poly.append(lower[k])
	var pc := PackedColorArray()
	for q in poly:
		var g := clampf((q.x - back.x) / maxf(0.000001, tip.x - back.x), 0.0, 1.0)
		pc.append(_col(rim_color, 0.0).lerp(_col(Color.WHITE, 0.75), g / 0.45) if g < 0.45 else _col(Color.WHITE, 0.75).lerp(_col(Color.WHITE, 0.95), (g - 0.45) / 0.55))
	_poly_fill(poly, pc)
	var pulse := 0.85 + 0.15 * sin(_t * TAU * 3.0)
	_blob(tip, r * 1.1 * pulse, [[0.0, Color.WHITE, 0.95], [0.25, rim_color, 0.45], [1.0, rim_color, 0.0]])
	_ice_glint(tip, r * 0.32 * pulse, rim_color.lerp(Color.WHITE, 0.5), 0.9, 0.0)
	_line(PackedVector2Array([tip - Vector2(r * 2.6, 0.0), tip + Vector2(r * 1.4, 0.0)]), PackedColorArray([_col(Color.WHITE, 0.55)]), maxf(0.6, r * 0.05))

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
		var len0 := radius * (0.45 + P.next() * 0.6) * grow
		var w := len0 * (0.16 + P.next() * 0.08)
		_ice_kite(Vector2.ZERO, a, len0, w, fade * (0.7 + 0.3 * P.next()))
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
