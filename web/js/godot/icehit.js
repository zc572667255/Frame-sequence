// The ice lance striking, drawn the same way as vfx/kinds/icehit.js, in flat
// cel shading: a white sparkle flash, a fan of ice spikes shooting out of the
// point it hit that hold a moment and then shatter into tumbling, falling
// pieces, small chips, a thin ring. All gone by t = 1.
export const ICE_HIT_GD = `
func _ice_ease(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return 1.0 - (1.0 - x) * (1.0 - x)

# 命中的各个部分（和编辑器 iceBurst 一样，任意一帧都能直接算出来）
func _ice_burst(R: float, quantity: float, key: int, t: float, angle: float) -> Dictionary:
	var P := Rand.new(key * 227 + 61)
	var q := clampf(quantity, 0.25, 2.0)
	var e := _ice_ease(t)
	var fade := 1.0 - _smooth(0.62, 0.97, t)
	var pieces := []
	# 冰刺：从命中点朝飞行方向扇形射出，停一下后各碎成三块，翻滚着飞开、往下掉
	var n := roundi(6.0 + 2.0 * q)
	for j in n:
		var k := (float(j) / (n - 1) - 0.5) if n > 1 else 0.0
		var a := angle + k * 2.8 + (P.next() - 0.5) * 0.25
		var L := R * (0.7 + 0.55 * P.next()) * (1.0 - 0.35 * absf(k) * 2.0)
		var w := L * (0.12 + 0.06 * P.next())
		var tb := 0.36 + 0.12 * P.next()
		var dir := Vector2.from_angle(a)
		var grow := _ice_ease(minf(1.0, t / 0.16))
		var back := -dir * w * 0.8
		var full := L * grow + w * 0.8
		var shards := []
		for m in 3:
			var u0 := m / 3.0
			var u1 := (m + 1) / 3.0
			# 往外的速度加一点横向的偏移（顺序和编辑器一样：x 的快慢、x 的横偏、y 的快慢、y 的横偏）
			var fx := dir.x * R * (0.5 + 0.8 * P.next())
			var sx := P.next() - 0.5
			var fy := dir.y * R * (0.5 + 0.8 * P.next())
			var sy := P.next() - 0.5
			shards.append({"um": (u0 + u1) / 2.0, "len": (u1 - u0) * full * 1.1, "width": w * (0.55 if m == 2 else 1.0 - 0.3 * m),
				"v": Vector2(fx - dir.y * sx * R * 0.6, fy + dir.x * sy * R * 0.6), "spin": (P.next() - 0.5) * 8.0})
		if t < tb:
			if grow > 0.001: pieces.append(_ice_crystal(_ice_chip(back, a, full, w), 1.0))
			continue
		var dt := t - tb
		for s in shards:
			var c: Vector2 = back + dir * full * float(s.um) + (s.v as Vector2) * dt + Vector2(0.0, R * 1.4 * dt * dt)
			var ang: float = a + float(s.spin) * dt
			pieces.append(_ice_crystal(_ice_chip(c - Vector2.from_angle(ang) * float(s.len) * 0.5, ang, s.len, s.width), fade))
	# 小冰屑：一开始就飞散
	for j in roundi(10.0 * q):
		var a := angle + (P.next() - 0.5) * (2.2 if P.next() < 0.7 else TAU)
		var len0 := R * (0.08 + 0.12 * P.next())
		var speed := R * (0.9 + 1.2 * P.next())
		var rot := P.next() * TAU
		var spin := (P.next() - 0.5) * 10.0
		var life := 0.45 + 0.4 * P.next()
		var d := speed * t * (1.0 - 0.45 * t)
		pieces.append(_ice_crystal(_ice_chip(Vector2(cos(a) * d, sin(a) * d + R * 0.6 * t * t), rot + spin * t, len0 * (1.0 - 0.3 * t), len0 * 0.3), 1.0 - _smooth(life * 0.5, life, t)))
	return {"flash_size": R * 0.55 * sin(PI * minf(1.0, t / 0.18)), "flash_alpha": 1.0 if t < 0.18 else 0.0,
		"ring_radius": R * (0.25 + 0.85 * e), "ring_alpha": 0.45 * (1.0 - _smooth(0.05, 0.4, t)), "pieces": pieces}

func _remote_ice_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var hit := _ice_burst(radius, amount, key, t, angle)
	var T := _ice_tones()
	_add = false
	if hit.ring_alpha > 0.005:
		var ring0 := PackedVector2Array()
		for i in 49: ring0.append(Vector2.from_angle(TAU * i / 48.0) * float(hit.ring_radius))
		_line(ring0, PackedColorArray([_col(T.light, hit.ring_alpha)]), maxf(0.6, radius * 0.03))
	_ice_pieces(hit.pieces, T, maxf(0.5, radius * 0.018))
	if hit.flash_alpha > 0.0 and hit.flash_size > 0.3:
		_poly_fill(_ice_sparkle(Vector2.ZERO, hit.flash_size), PackedColorArray([_col(T.hi, hit.flash_alpha)]))
	_xf = xf
`;
