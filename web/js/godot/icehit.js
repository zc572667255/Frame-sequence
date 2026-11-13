// 冰矛 hitting, drawn the same way as vfx/kinds/icehit.js: a flash, crystal
// spikes bursting out and shattering, shards flying off and falling, a frost
// ring, twinkles and mist. All gone by t = 1.
export const ICE_HIT_GD = `
func _ice_ease(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return 1.0 - (1.0 - x) * (1.0 - x)

# 命中的各个部分（和编辑器 iceBurst 一样，任意一帧都能直接算出来）
func _ice_burst(R: float, quantity: float, key: int, t: float, angle: float) -> Dictionary:
	var P := Rand.new(key * 227 + 61)
	var q := clampf(quantity, 0.25, 2.0)
	var grow := _ice_ease(_smooth(0.0, 0.14, t))
	var fade := 1.0 - _smooth(0.42, 0.62, t)
	var spikes := []
	var shards := []
	var sparkles := []
	for j in 7:
		var a := angle + j * TAU / 7.0 + (P.next() - 0.5) * 0.35
		var len0 := R * (0.38 + 0.18 * P.next()) * (0.75 if j % 2 else 1.0)
		spikes.append({"angle": a, "len": len0 * grow, "full": len0, "width": len0 * grow * 0.2, "alpha": fade})
	# 冰矛自己碎开，大多继续往前飞
	for j in roundi(8.0 * q):
		var dir := angle + (P.next() - 0.5) * 2.4 + (PI if P.next() < 0.35 else 0.0)
		var speed := R * (0.9 + 1.2 * P.next())
		var size0 := R * (0.07 + 0.09 * P.next())
		var life := 0.5 + 0.3 * P.next()
		shards.append(_ice_shard(P, Vector2.ZERO, dir, speed, size0, 0.0, life, t, R))
	# 每根冰刺断成两截
	for s in spikes:
		for k in 2:
			var along: float = s.full * (0.3 + 0.5 * P.next())
			var dir: float = s.angle + (P.next() - 0.5) * 0.8
			var speed := R * (0.5 + 0.8 * P.next())
			var size0 := R * (0.05 + 0.06 * P.next())
			var life := 0.4 + 0.15 * P.next()
			shards.append(_ice_shard(P, Vector2.from_angle(s.angle) * along, dir, speed, size0, 0.45, life, t, R))
	for j in roundi(10.0 * q):
		var a := P.next() * TAU
		var reach := R * (0.3 + 0.7 * P.next())
		var born := 0.05 + 0.3 * P.next()
		var size0 := R * (0.06 + 0.05 * P.next())
		var k := clampf((t - born) / 0.4, 0.0, 1.0)
		sparkles.append({"at": Vector2.from_angle(a) * reach * _ice_ease(t), "size": size0, "alpha": 0.0 if t < born or k >= 1.0 else sin(PI * k)})
	return {"flash": 1.0 - _smooth(0.0, 0.16, t), "spikes": spikes, "shards": shards, "sparkles": sparkles,
		"ring_radius": R * (0.25 + 0.75 * _ice_ease(_smooth(0.0, 0.5, t))), "ring_alpha": 0.2 * (1.0 - _smooth(0.2, 0.75, t))}

func _ice_shard(P: Rand, origin: Vector2, dir: float, speed: float, size0: float, born: float, life: float, t: float, R: float) -> Dictionary:
	var rot := P.next() * TAU
	var spin := (P.next() - 0.5) * 14.0
	var age := t - born
	if age < 0.0:
		return {"at": origin, "rot": rot, "size": size0, "alpha": 0.0}
	var d := speed * age * (1.0 - 0.45 * age)
	return {"at": origin + Vector2.from_angle(dir) * d + Vector2(0.0, R * 0.9 * age * age), "rot": rot + spin * age, "size": size0, "alpha": 1.0 - _smooth(life * 0.55, life, age)}

func _ice_tri(a: Vector2, b: Vector2, c: Vector2, col: Color, alpha: float) -> void:
	_poly_fill(PackedVector2Array([a, b, c]), PackedColorArray([_col(col, alpha)]))

func _remote_ice_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var P := Rand.new(key * 331 + 19)
	var hit := _ice_burst(radius, amount, key, t, angle)
	var deep: Color = colors[0].lerp(Color8(6, 14, 40), 0.45)
	var cyan: Color = colors[1] if colors.size() > 1 else rim_color
	var lit_col := cyan.lerp(core_color, 0.4)
	var dark_col := deep.lerp(colors[0], 0.6)
	for j in 3:
		var a := P.next() * TAU
		_remote_puff(Vector2(cos(a) * radius * t * 0.6, sin(a) * radius * t * 0.3), radius * (0.18 + t * 0.3), a, rim_color, _smooth(0.0, 0.1, t) * pow(1.0 - t, 2.0) * 0.14 * minf(1.5, amount), j + key, 1.6)
	_add = additive
	_ring(Vector2.ZERO, hit.ring_radius, maxf(0.6, radius * 0.05), 0.6, rim_color, hit.ring_alpha)
	_add = false
	for sp in hit.spikes:
		if sp.alpha <= 0.005 or sp.len < 0.5: continue
		var d := Vector2.from_angle(sp.angle)
		var nv := Vector2(-d.y, d.x) * float(sp.width)
		var b := d * radius * 0.05
		var tip: Vector2 = d * float(sp.len)
		var m: Vector2 = d * float(sp.len) * 0.35
		_ice_tri(b, m + nv, tip, lit_col, 0.92 * sp.alpha)
		_ice_tri(b, tip, m - nv, dark_col, 0.9 * sp.alpha)
	for sh in hit.shards:
		if sh.alpha <= 0.005: continue
		var s: float = sh.size
		var xs := Transform2D(float(sh.rot), sh.at as Vector2)
		_ice_tri(xs * Vector2(-0.6 * s, 0.0), xs * Vector2(0.0, -0.35 * s), xs * Vector2(s, 0.0), lit_col, 0.95 * sh.alpha)
		_ice_tri(xs * Vector2(-0.6 * s, 0.0), xs * Vector2(s, 0.0), xs * Vector2(0.0, 0.3 * s), dark_col, 0.9 * sh.alpha)
	_add = additive
	for sp in hit.spikes:
		if sp.alpha <= 0.005 or sp.len < 0.5: continue
		var d := Vector2.from_angle(sp.angle)
		_streak(d * radius * 0.05, d * float(sp.len), rim_color, core_color, 0.6 * sp.alpha, maxf(0.5, float(sp.width) * 0.35))
	for k in hit.sparkles:
		if k.alpha <= 0.01: continue
		var p: Vector2 = k.at
		var s: float = k.size
		_blob(p, s, [[0.0, core_color, 0.8 * k.alpha], [1.0, rim_color, 0.0]])
		for d in [Vector2(-1, 0), Vector2(1, 0), Vector2(0, -1), Vector2(0, 1)]:
			_streak(p + d * s * 1.6, p, rim_color, core_color, 0.7 * k.alpha, maxf(0.4, s * 0.25))
	_blob(Vector2.ZERO, radius * 0.9, [[0.0, rim_color, 0.35 * hit.flash], [1.0, rim_color, 0.0]])
	_blob(Vector2.ZERO, radius * 0.55, [[0.0, core_color, 0.85 * hit.flash], [0.4, core_color, 0.4 * hit.flash], [1.0, rim_color, 0.0]])
	_xf = xf
`;
