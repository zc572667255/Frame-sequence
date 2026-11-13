// The ice meteor smashing, drawn the same way as vfx/kinds/icehit.js: a flash,
// freezing mist, a faint frost ring, chunks of ice flung up and out, tumbling
// and falling, fast small chips and a few glints. All gone by t = 1.
export const ICE_HIT_GD = `
func _ice_ease(x: float) -> float:
	x = clampf(x, 0.0, 1.0)
	return 1.0 - (1.0 - x) * (1.0 - x)

# 命中的各个部分（和编辑器 iceBurst 一样，任意一帧都能直接算出来）
func _ice_burst(R: float, quantity: float, key: int, t: float) -> Dictionary:
	var P := Rand.new(key * 227 + 61)
	var q := clampf(quantity, 0.25, 2.0)
	var e := _ice_ease(t)
	var mist := []
	var pieces := []
	var sparkles := []
	for j in 6:
		var a := j * TAU / 6.0 + P.next() * 0.8
		var reach := R * (0.25 + 0.3 * P.next())
		var r0 := R * (0.25 + 0.45 * e) * (0.8 + 0.4 * P.next())
		mist.append({"at": Vector2.from_angle(a) * reach * e, "r": r0, "alpha": pow(1.0 - t, 1.5) * 0.22 * _smooth(0.0, 0.06, t)})
	# 大冰块（大、慢、往上抛）和小碎冰（小、快）
	for g in [[9, 0.11, 0.1, 0.8, 1.0, 0.55, 0.35, 5], [14, 0.035, 0.04, 1.4, 1.6, 0.35, 0.3, 3]]:
		var n := roundi(float(g[0]) * q)
		for j in n:
			var a := j * TAU / n + (P.next() - 0.5) * 0.7
			var speed := R * (float(g[3]) + float(g[4]) * P.next())
			var size0 := R * (float(g[1]) + float(g[2]) * P.next())
			var spin := (P.next() - 0.5) * 12.0
			var rot := P.next() * TAU
			var life := float(g[5]) + float(g[6]) * P.next()
			var at := Vector2(cos(a) * speed * t * (1.0 - 0.4 * t), sin(a) * speed * t * (1.0 - 0.4 * t) - R * 0.5 * t + R * 1.6 * t * t)
			pieces.append({"at": at, "size": size0, "rot": rot + spin * t, "sides": int(g[7]), "key": key * 13 + pieces.size() * 71 + 7, "alpha": 1.0 - _smooth(life * 0.6, life, t)})
	for j in roundi(6.0 * q):
		var a := P.next() * TAU
		var reach := R * (0.3 + 0.7 * P.next())
		var born := 0.03 + 0.3 * P.next()
		var size0 := R * (0.05 + 0.04 * P.next())
		var k := clampf((t - born) / 0.4, 0.0, 1.0)
		sparkles.append({"at": Vector2(cos(a) * reach * e, sin(a) * reach * e * 0.8), "size": size0, "alpha": 0.0 if t < born or k >= 1.0 else sin(PI * k)})
	return {"flash": 1.0 - _smooth(0.0, 0.15, t), "mist": mist, "pieces": pieces, "sparkles": sparkles,
		"ring_radius": R * (0.2 + 0.8 * e), "ring_alpha": 0.3 * (1.0 - _smooth(0.05, 0.45, t))}

func _remote_ice_hit(at0: Vector2, t: float, _angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var hit := _ice_burst(radius, amount, key, t)
	var col := _ice_cols()
	_add = additive
	for m in hit.mist:
		_blob(m.at, m.r, [[0.0, col.vapor, m.alpha], [1.0, col.vapor, 0.0]])
	_ring(Vector2.ZERO, hit.ring_radius, maxf(0.6, radius * 0.04), 0.6, rim_color, hit.ring_alpha)
	for p in hit.pieces:
		if p.alpha <= 0.005: continue
		_ice_draw_lump(_ice_lump(Rand.new(p.key), p.at, p.size, p.rot, p.sides), p.alpha, maxf(0.5, float(p.size) * 0.18))
	_add = additive
	for k in hit.sparkles:
		_ice_twinkle(k.at, k.size, k.alpha)
	_blob(Vector2.ZERO, radius * 0.8, [[0.0, rim_color, 0.35 * hit.flash], [1.0, rim_color, 0.0]])
	_blob(Vector2.ZERO, radius * 0.45, [[0.0, core_color, 0.9 * hit.flash], [0.4, core_color, 0.45 * hit.flash], [1.0, rim_color, 0.0]])
	_xf = xf
`;
