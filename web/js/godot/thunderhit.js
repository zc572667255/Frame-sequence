// Native counterpart of vfx/kinds/thunderhit.js. The channels hold their shape
// through the return strokes; sparks have seeded ballistic trajectories.
export const THUNDER_HIT_GD = `
func _electric_channel(from: Vector2, to: Vector2, key: int) -> PackedVector2Array:
	var P := Rand.new(key)
	var d := to - from
	var points := PackedVector2Array([from, to])
	for level in 4:
		var next := PackedVector2Array([points[0]])
		var amplitude := 0.24 / pow(2.0, level)
		for k in range(1, points.size()):
			var offset := (P.next() * 2.0 - 1.0) * amplitude
			next.append((points[k - 1] + points[k]) / 2.0 + Vector2(-d.y, d.x) * offset)
			next.append(points[k])
		points = next
	return points

func _thunder_discharge(r: float, quantity: float, key: int, t: float) -> Dictionary:
	var P := Rand.new(key * 263 + 19)
	var arcs := []
	var scars := []
	var sparks := []
	var pulse := 0.0
	for start: float in [0.0, 0.08, 0.19, 0.32]:
		if t >= start: pulse = maxf(pulse, exp(-(t - start) / 0.045))
	var energy := maxf(pulse, 0.14) * (1.0 - _smooth(0.18, 0.52, t))
	var count := roundi(5.0 + minf(2.0, quantity) * 4.0)
	for j in count:
		var a := j * TAU / count + (P.next() - 0.5) * 0.7
		var reach := r * (0.7 + P.next() * 0.8)
		var points := _electric_channel(Vector2.ZERO, Vector2(cos(a), sin(a) * 0.8) * reach, key * 13 + j * 67)
		var Q := Rand.new(key * 271 + floori(t * 24.0) * 97 + j)
		var alpha := energy * (0.55 + Q.next() * 0.45)
		arcs.append({"points": points, "width": r * 0.026, "alpha": alpha})
		var sign0 := 1.0 if P.next() > 0.5 else -1.0
		var branch := a + sign0 * (0.65 + P.next() * 0.6)
		var from := points[9]
		arcs.append({"points": _electric_channel(from, from + Vector2(cos(branch), sin(branch) * 0.8) * reach * 0.4, key * 17 + j * 73), "width": r * 0.014, "alpha": alpha * 0.65})
	var C := Rand.new(key * 283 + 23)
	var growth := _smooth(0.0, 0.12, t)
	for j in 7:
		var a := j * TAU / 7.0 + (C.next() - 0.5) * 0.5
		var reach := r * (0.7 + C.next() * 0.65)
		var points := _electric_channel(Vector2.ZERO, Vector2.from_angle(a) * reach, key * 19 + j * 83)
		for k in points.size(): points[k].y *= 0.23
		var stop := growth * (points.size() - 1)
		var end := floori(stop)
		var clipped := points.slice(0, end + 1)
		if end < points.size() - 1: clipped.append(points[end].lerp(points[end + 1], stop - end))
		scars.append({"points": clipped, "width": r * 0.012, "alpha": (1.0 - _smooth(0.22, 0.92, t)) * 0.38})
	var S := Rand.new(key * 293 + 29)
	for j in roundi(30.0 * minf(2.0, quantity)):
		var a := -PI / 2.0 + (S.next() - 0.5) * 4.6
		var speed0 := r * (2.2 + S.next() * 3.0)
		var life := 0.4 + S.next() * 0.6
		var width := r * (0.008 + S.next() * 0.012)
		var back := maxf(0.0, t - 0.025)
		var v := Vector2.from_angle(a) * speed0
		sparks.append({"at": v * t + Vector2(0, r * t * t * 1.7), "back": v * back + Vector2(0, r * back * back * 1.7), "width": width, "alpha": pow(maxf(0.0, 1.0 - t / life), 1.5)})
	return {"arcs": arcs, "scars": scars, "sparks": sparks, "flash": exp(-t / 0.055), "halo": exp(-t / 0.18), "wave": 1.0 - pow(1.0 - minf(1.0, t / 0.28), 2.5), "wave_alpha": maxf(0.0, 1.0 - t / 0.28) * 0.3}

func _electric_draw(path: Dictionary) -> void:
	var points: PackedVector2Array = path.points
	var alpha: float = path.alpha
	if points.size() < 2 or alpha < 0.005 or points[0].distance_to(points[-1]) < 0.1: return
	for pass0 in [[6.0, rim_color, 0.12], [2.6, rim_color, 0.38], [1.0, core_color, 1.0]]:
		var widths := PackedFloat32Array()
		var tones := PackedColorArray()
		for i in points.size():
			var u := float(i) / (points.size() - 1)
			widths.append(maxf(0.15, path.width) * float(pass0[0]) * (1.0 - u * 0.92))
			var tone: Color = (pass0[1] as Color).lerp(rim_color, u)
			tones.append(_col(tone, alpha * float(pass0[2]) * (1.0 - u)))
		_line(points, tones, maxf(0.15, path.width) * float(pass0[0]), widths)

func _remote_thunder_hit(at0: Vector2, t: float, key: int, r: float) -> void:
	var hit := _thunder_discharge(r, amount, key, t)
	var old := _xf
	_xf = old * Transform2D(0.0, at0)
	_add = additive
	_blob(Vector2.ZERO, r * 1.65, [[0.0, rim_color, hit.halo * 0.42], [0.5, rim_color, hit.halo * 0.13], [1.0, rim_color, 0.0]])
	for path in hit.scars + hit.arcs: _electric_draw(path)
	_ring(Vector2.ZERO, maxf(0.1, hit.wave * r * 1.6), r * 0.026, 0.8, rim_color, hit.wave_alpha)
	for p in hit.sparks:
		if p.alpha > 0.005: _streak(p.back, p.at, rim_color, core_color, p.alpha, maxf(0.45, p.width))
	_xf = old * Transform2D(0.0, at0) * Transform2D(0.0, Vector2(1, 0.055), 0.0, Vector2.ZERO)
	_blob(Vector2.ZERO, r * 1.6, [[0.0, core_color, hit.flash * 0.9], [0.25, rim_color, hit.flash * 0.4], [1.0, rim_color, 0.0]])
	_xf = old * Transform2D(0.0, at0)
	_blob(Vector2.ZERO, r * (0.12 + hit.flash * 0.42), [[0.0, core_color, hit.flash], [0.35, core_color, hit.flash * 0.8], [1.0, rim_color, 0.0]])
	_xf = old
`;
