// The ice lance striking, drawn the same way as vfx/kinds/icehit.js: a white
// flash, the lance bursting into ice chips flung mostly onward, its two
// ribbons whipping out into curls, a haze, a faint ring and star glints. All
// gone by t = 1.
export const ICE_HIT_GD = `
func _ice_ease(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return 1.0 - (1.0 - x) * (1.0 - x)

# 命中的各个部分（和编辑器 iceBurst 一样，任意一帧都能直接算出来）
func _ice_burst(R: float, quantity: float, key: int, t: float, angle: float) -> Dictionary:
	var P := Rand.new(key * 227 + 61)
	var q := clampf(quantity, 0.25, 2.0)
	var e := _ice_ease(t)
	var haze := []
	var chips := []
	var curls := []
	var glints := []
	for j in 5:
		var a := j * TAU / 5.0 + P.next() * 0.8
		var reach := R * (0.2 + 0.3 * P.next())
		var r0 := R * (0.3 + 0.4 * e) * (0.8 + 0.4 * P.next())
		haze.append({"at": Vector2.from_angle(a) * reach * e, "r": r0, "alpha": pow(1.0 - t, 1.5) * 0.2 * _smooth(0.0, 0.06, t)})
	for j in roundi(18.0 * q):
		var a := angle + (P.next() - 0.5) * (2.2 if P.next() < 0.7 else TAU)
		var len0 := R * (0.12 + 0.2 * P.next())
		var speed := R * (0.8 + 1.2 * P.next())
		var rot := P.next() * TAU
		var spin := (P.next() - 0.5) * 10.0
		var life := 0.45 + 0.4 * P.next()
		var d := speed * t * (1.0 - 0.45 * t)
		chips.append({"at": Vector2(cos(a) * d, sin(a) * d + R * 0.4 * t * t), "angle": rot + spin * t, "len": len0 * (1.0 - 0.3 * t), "width": len0 * 0.22, "alpha": 1.0 - _smooth(life * 0.5, life, t)})
	# 两条光带从命中点卷出去，淡去时松开
	for j in 2:
		var a0 := angle + PI + (0.6 if j else -0.6)
		var pts := PackedVector2Array()
		for k in 25:
			var u := k / 24.0
			var th := a0 + (1.0 if j else -1.0) * u * 3.4 * (0.6 + 0.4 * e)
			var rad := R * (0.15 + 0.75 * e) * (0.3 + 0.7 * u)
			pts.append(Vector2.from_angle(th) * rad)
		curls.append({"pts": pts, "alpha": _smooth(0.0, 0.08, t) * (1.0 - _smooth(0.25, 0.75, t)), "width": R * 0.07 * (1.0 - 0.5 * t)})
	for j in roundi(10.0 * q):
		var a := P.next() * TAU
		var reach := R * (0.3 + 0.8 * P.next())
		var born := 0.04 + 0.35 * P.next()
		var size0 := R * (0.05 + 0.05 * P.next())
		var k := clampf((t - born) / 0.45, 0.0, 1.0)
		glints.append({"at": Vector2.from_angle(a) * reach * e, "size": size0, "alpha": 0.0 if t < born or k >= 1.0 else sin(PI * k)})
	return {"flash": 1.0 - _smooth(0.0, 0.16, t), "haze": haze, "chips": chips, "curls": curls, "glints": glints,
		"ring_radius": R * (0.2 + 0.8 * e), "ring_alpha": 0.3 * (1.0 - _smooth(0.1, 0.55, t))}

func _remote_ice_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var hit := _ice_burst(radius, amount, key, t, angle)
	var col := _ice_cols()
	_add = additive
	for m in hit.haze:
		_blob(m.at, m.r, [[0.0, col.haze, m.alpha], [1.0, col.haze, 0.0]])
	_ring(Vector2.ZERO, hit.ring_radius, maxf(0.6, radius * 0.035), 1.0, rim_color, hit.ring_alpha)
	for j in 2:
		var cu: Dictionary = hit.curls[j]
		if cu.alpha <= 0.01: continue
		var tone: Color = col.ribbon_b if j else col.ribbon_a
		_line(cu.pts, PackedColorArray([_col(tone, 0.85 * cu.alpha)]), maxf(0.5, cu.width))
		_line(cu.pts, PackedColorArray([_col(tone.lerp(core_color, 0.6), 0.6 * cu.alpha)]), maxf(0.5, float(cu.width) * 0.35))
	for k in hit.chips:
		if k.alpha <= 0.005: continue
		_ice_fill_chip(_ice_chip(k.at, k.angle, k.len, k.width), col.pale, 0.6 * float(k.alpha), 0.7 * float(k.alpha), maxf(0.4, radius * 0.012))
	for g0 in hit.glints:
		_ice_star(g0.at, g0.size, g0.alpha)
	_blob(Vector2.ZERO, radius * 0.9, [[0.0, col.blue, 0.45 * hit.flash], [1.0, col.blue, 0.0]])
	_blob(Vector2.ZERO, radius * 0.5, [[0.0, core_color, 0.95 * hit.flash], [0.4, core_color, 0.5 * hit.flash], [1.0, col.pale, 0.0]])
	_xf = xf
`;
