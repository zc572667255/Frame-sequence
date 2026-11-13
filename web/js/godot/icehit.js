// The frost bolt bursting, drawn the same way as vfx/kinds/icehit.js: a white
// flash, spreading frost mist, a ring of cold light, ice shards flung out,
// twinkles and snowflakes. All gone by t = 1.
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
	var shards := []
	var sparkles := []
	var flakes := []
	for j in 6:
		var a := j * TAU / 6.0 + P.next() * 0.8
		var reach := R * (0.25 + 0.3 * P.next())
		var r0 := R * (0.25 + 0.45 * e) * (0.8 + 0.4 * P.next())
		mist.append({"at": Vector2.from_angle(a) * reach * e, "r": r0, "alpha": pow(1.0 - t, 1.5) * 0.25 * _smooth(0.0, 0.08, t)})
	var n := roundi(10.0 * q)
	for j in n:
		var a := j * TAU / n + (P.next() - 0.5) * 0.5
		var len0 := R * (0.25 + 0.3 * P.next())
		var dist := R * (0.15 + 0.75 * e) * (0.75 + 0.35 * P.next())
		var k := 1.0 - 0.35 * t
		shards.append({"angle": a, "at": Vector2.from_angle(a) * dist, "len": len0 * k, "width": len0 * k * 0.14, "alpha": 1.0 - _smooth(0.35, 0.85, t)})
	for j in roundi(12.0 * q):
		var a := P.next() * TAU
		var reach := R * (0.3 + 0.8 * P.next())
		var born := 0.04 + 0.35 * P.next()
		var size0 := R * (0.05 + 0.05 * P.next())
		var k := clampf((t - born) / 0.45, 0.0, 1.0)
		sparkles.append({"at": Vector2(cos(a) * reach * e, sin(a) * reach * e * 0.8 + R * 0.25 * t * t), "size": size0, "alpha": 0.0 if t < born or k >= 1.0 else sin(PI * k)})
	for j in 5:
		var a := P.next() * TAU
		var reach := R * (0.4 + 0.5 * P.next())
		var size0 := R * (0.07 + 0.05 * P.next())
		var spin := P.next() * TAU + t * 2.0
		flakes.append({"at": Vector2(cos(a) * reach * e, sin(a) * reach * e * 0.7 + R * 0.4 * t), "size": size0, "spin": spin, "alpha": _smooth(0.05, 0.2, t) * (1.0 - _smooth(0.6, 1.0, t)) * 0.8})
	return {"flash": 1.0 - _smooth(0.0, 0.18, t), "mist": mist, "shards": shards, "sparkles": sparkles, "flakes": flakes,
		"ring_radius": R * (0.2 + 0.9 * e), "ring_alpha": 0.6 * (1.0 - _smooth(0.1, 0.6, t))}

func _remote_ice_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var hit := _ice_burst(radius, amount, key, t)
	var col := _frost_cols()
	var lit_col := (col.blue as Color).lerp(col.core, 0.7)
	var dark_col := (col.deep as Color).lerp(col.blue, 0.55)
	_add = additive
	for m in hit.mist:
		_blob(m.at, m.r, [[0.0, col.mist, m.alpha], [1.0, col.mist, 0.0]])
	_ring(Vector2.ZERO, hit.ring_radius, maxf(0.6, radius * 0.04), 1.0, rim_color, hit.ring_alpha)
	_add = false
	for sh in hit.shards:
		if sh.alpha <= 0.005: continue
		var d := Vector2.from_angle(sh.angle)
		var nv := Vector2(-d.y, d.x) * float(sh.width)
		var c: Vector2 = sh.at
		var b := c - d * float(sh.len) * 0.4
		var tip := c + d * float(sh.len) * 0.6
		_poly_fill(PackedVector2Array([b, c + nv, tip]), PackedColorArray([_col(lit_col, 0.92 * sh.alpha)]))
		_poly_fill(PackedVector2Array([b, tip, c - nv]), PackedColorArray([_col(dark_col, 0.8 * sh.alpha)]))
	_add = additive
	for sh in hit.shards:
		if sh.alpha <= 0.005: continue
		var d := Vector2.from_angle(sh.angle)
		var c: Vector2 = sh.at
		_streak(c - d * float(sh.len) * 0.4, c + d * float(sh.len) * 0.6, rim_color, core_color, 0.55 * sh.alpha, maxf(0.5, float(sh.width) * 0.5))
	for k in hit.sparkles:
		_frost_twinkle(k.at, k.size, k.alpha)
	for f in hit.flakes:
		if f.alpha <= 0.01: continue
		var p: Vector2 = f.at
		var s: float = f.size
		for arm in 6:
			var a: float = f.spin + arm * PI / 3.0
			_line(PackedVector2Array([p, p + Vector2.from_angle(a) * s]), PackedColorArray([_col(core_color, f.alpha)]), maxf(0.5, s * 0.18))
	_blob(Vector2.ZERO, radius * 0.9, [[0.0, rim_color, 0.4 * hit.flash], [1.0, col.mist, 0.0]])
	_blob(Vector2.ZERO, radius * 0.5, [[0.0, core_color, 0.95 * hit.flash], [0.4, core_color, 0.5 * hit.flash], [1.0, rim_color, 0.0]])
	_xf = xf
`;
