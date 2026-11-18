// 水球, drawn the same way as vfx/kinds/water.js (after pixelfx's water orb
// and splash, https://github.com/patch-gg/pixelfx, MIT): the see-through
// body in the noise shader (mode 11, per pixel, exactly as orbShade), the
// rest as shapes on top of it; the beads, mist and spray it sheds; the splash.

// the body in the field shader: ea[i] = (centre x, y, radius, angle of
// flight), eb[i] = (drawn out along it 0/1, skin phase 1, skin phase 2, 0)
export const WATER_FIELD = `
	} else if (mode == 11) {
		vec3 acc = vec3(0.0);
		float aa = 0.0;
		for (int i = 0; i < ne; i++) {
			vec4 head = ea[i];
			vec4 st = eb[i];
			vec2 delta = UV - head.xy;
			float ca = cos(head.w), si = sin(head.w);
			vec2 kk = st.x > 0.5 ? vec2(1.07, 0.95) : vec2(1.0);
			float lx = (delta.x * ca + delta.y * si) / kk.x, ly = (-delta.x * si + delta.y * ca) / kk.y;
			vec2 e = vec2(lx * ca - ly * si, lx * si + ly * ca);
			float d = length(e);
			float an = atan(e.y, e.x);
			float r = head.z * (1.0 + 0.032 * sin(an * 3.0 + st.y) + 0.018 * sin(an * 5.0 - st.z));
			if (d > r) { continue; }
			float q = d / r, lit = (-e.x - e.y) / 1.41421356 / max(0.5, d);
			int k = 1;
			float fa = 1.0;
			if (q > 0.9) {
				k = lit > 0.35 ? 7 : (lit > -0.2 ? 5 : 3);
				fa = 1.0;
			} else {
				float gather = max(0.0, (e.x + e.y) / 1.41421356 / r) * q;
				k = gather > 0.45 ? 4 : (gather > 0.25 ? 3 : (q > 0.7 ? 2 : 1));
				fa = gather > 0.25 ? 0.7 : 0.35 + 0.3 * q;
			}
			// the 8 steps along the flame ramp (vfx/kinds/water.js WATER_V)
			float wv = k == 1 ? 0.1 : (k == 2 ? 0.25 : (k == 3 ? 0.42 : (k == 4 ? 0.58 : (k == 5 ? 0.7 : 1.0))));
			vec3 fc = texture(ramp_flame, vec2(wv, 0.5)).rgb;
			acc = fc * fa + acc * (1.0 - fa);
			aa = fa + aa * (1.0 - fa);
		}
		if (aa < 0.004) { discard; }
		col = acc / aa; a = aa;
`;

export const WATER_GD = `
# 水的 8 档颜色（深 → 白），沿配色的火焰色带（最深的颜色 … 核心色）取
const WATER_V := [0.02, 0.1, 0.25, 0.42, 0.58, 0.7, 0.84, 1.0]
func _water_ramp() -> Array:
	var stops := [colors[0]] + Array(colors) + [core_color]
	var out := []
	for v in WATER_V:
		var x := clampf(float(v) * 0.999, 0.0, 1.0) * (stops.size() - 1)
		var j := mini(stops.size() - 2, int(floor(x)))
		out.append((stops[j] as Color).lerp(stops[j + 1], x - j))
	return out

# pixelfx 的 3 秒一圈（这里当 36 帧）里发生 k 次的事，在 frames 帧一圈里发生几次（整数，首尾相接）
func _water_cycles(k: float) -> int:
	return maxi(1, roundi(k * frames / 36.0))

# 水球身上画在本体上面的东西（和编辑器 waterOrb 一样）：水流的一段段、气泡、高光、亮点、光、水雾
func _water_orb(R: float, t: float, key: int) -> Dictionary:
	var u := R / 19.0
	var T := t * TAU
	var P := Rand.new(key * 113 + 9)
	var dashes := []
	for k in 3:
		var rr := R * (0.38 + 0.2 * k)
		var tilt := -0.5 + k * 0.35
		var spin := T * (-_water_cycles(2) if k % 2 else _water_cycles(3)) + k * 2.0
		var has := false
		var run_pts := PackedVector2Array()
		var run_tone := 0
		for i in 84:
			var s := i * 0.012
			var a := spin + s * TAU
			var x := cos(a) * rr
			var z := sin(a)
			var dash := fmod(s * 3.0 + k * 0.3, 1.0)
			var tone := -1
			if dash <= 0.62:
				tone = (7 if dash < 0.1 else (6 if dash < 0.4 else 5)) if z > 0.0 else 3
			var p := Vector2(x * cos(tilt), x * sin(tilt) * 0.6 + z * rr * 0.62)
			if has and run_tone == tone:
				run_pts.append(p)
				continue
			if has:
				run_pts.append(p)
				if run_tone >= 0: dashes.append({"pts": run_pts, "tone": run_tone, "w": u})
			has = true
			run_pts = PackedVector2Array([p])
			run_tone = tone
		if has and run_tone >= 0 and run_pts.size() > 1:
			dashes.append({"pts": run_pts, "tone": run_tone, "w": u})
	var bubbles := []
	for k in 8:
		var life := 1.0 + 0.8 * P.next()
		var m := _water_cycles(3.0 / life)
		var ph := P.next()
		var x0 := (P.next() - 0.5) * R
		var wob := P.next() * TAU
		var two := P.next() < 0.35
		var f := fmod(t * m + ph, 1.0)
		var x := x0 + sin(f * life * 4.0 + wob) * 1.5 * u
		var y := R * 0.6 - f * R * 1.2
		if Vector2(x, y).length() > R * 0.8: continue
		bubbles.append({"at": Vector2(x, y), "r": u * 0.6, "tone": 6 if f < 0.8 else 7})
		if two: bubbles.append({"at": Vector2(x + u, y), "r": u * 0.55, "tone": 5})
	var pulse := 0.8 + 0.2 * sin(T * _water_cycles(4))
	var glows := [
		{"at": Vector2(R * 0.36, R * 0.4), "r": 9.0 * u, "tone": 5, "a": 0.45 * pulse},
		{"at": Vector2.ZERO, "r": R * 1.4, "tone": 5, "a": 0.22},
		{"at": Vector2(-R * 0.4, -R * 0.5), "r": 6.0 * u, "tone": 7, "a": 0.25},
	]
	var motes := []
	for i in 7:
		var a := float(i) / 7.0 * TAU + T * _water_cycles(1) * (1.0 if i % 2 else -1.0)
		var r := R + 5.0 * u + (i % 3) * 3.0 * u
		var tilt := (i - 3) * 0.22
		var x := cos(a) * r
		var z := sin(a)
		motes.append({"at": Vector2(x * cos(tilt), x * sin(tilt) + z * r * 0.28), "front": z >= 0.0, "i": i})
	return {"u": u, "w1": T * _water_cycles(2), "w2": T * _water_cycles(3), "dashes": dashes, "bubbles": bubbles, "glows": glows, "motes": motes,
		"back_r": R * 3.2, "back_a": 0.3 + 0.05 * sin(T * _water_cycles(2)),
		"specks": [[Vector2(-R * 0.45, -R * 0.62), 7], [Vector2(R * 0.48, R * 0.5), 6], [Vector2(R * 0.48 + u, R * 0.5), 5]],
		"fleck": Vector2(R * 0.36, R * 0.4), "fleck_r": 1.6 * u}

# 柔和的光（pixelfx：按 (1 - d)² 变淡），叠加
func _water_glow(p: Vector2, r: float, c: Color, a: float) -> void:
	if r < 0.5 or a <= 0.004: return
	var was := _add
	_add = additive
	_blob(p, r, [[0.0, c, a], [0.25, c, a * 0.5625], [0.5, c, a * 0.25], [0.75, c, a * 0.0625], [1.0, c, 0.0]])
	_add = was

func _water_dot(p: Vector2, r: float, c: Color, a := 1.0) -> void:
	_add = false
	_tri_circle(p, maxf(0.35, r), _col(c, a))

func _water_line(pts: PackedVector2Array, c: Color, w: float, a := 1.0) -> void:
	_add = false
	_line(pts, PackedColorArray([_col(c, a)]), maxf(0.6, w))

# 圆心在 (0, 0)、外半径 r、宽 w 的一段弧（a0 → a1）
func _water_band(r: float, w: float, a0: float, a1: float, c: Color, a := 1.0) -> void:
	var pts := PackedVector2Array()
	for i in 13: pts.append(Vector2.from_angle(lerpf(a0, a1, i / 12.0)) * r)
	for i in range(12, -1, -1): pts.append(Vector2.from_angle(lerpf(a0, a1, i / 12.0)) * maxf(0.0, r - w))
	_add = false
	_poly_fill(pts, PackedColorArray([_col(c, a)]))

# 一颗水珠（pixelfx 的大小：1 一点，2 小水珠，3 带高光的圆水珠），尾巴沿运动方向往后拖，越快越长
func _water_bead(p: Vector2, v: Vector2, s: int, C: Array, u: float, a := 1.0) -> void:
	if a <= 0.01: return
	var sp := v.length()
	if sp < 1e-9: sp = 1.0
	var d := v / sp
	var tail := minf(5.0 * u, sp * 0.9)
	if tail >= u:
		var p0 := p - d * (tail + u)
		var p1 := p - d * 1.2 * u
		var pm := p0.lerp(p1, 0.45)
		_water_line(PackedVector2Array([p0, pm]), C[3], u * 0.9, a)
		_water_line(PackedVector2Array([pm, p1]), C[5] if s > 1 else C[4], u * 0.9, a)
	if s >= 3:
		_water_dot(p, 1.75 * u, C[4], a)
		_water_dot(p - Vector2(0.25, 0.25) * u, 1.15 * u, C[6], a)
		_water_dot(p - Vector2(0.7, 0.7) * u, 0.5 * u, C[7], a)
	elif s >= 2:
		_water_dot(p, 1.1 * u, C[5], a)
		_water_dot(p - Vector2(0.35, 0.35) * u, 0.5 * u, C[7], a)
	else:
		_water_dot(p, 0.55 * u, C[6] if sp > 2.4 * u else C[5], a)
	_water_glow(p, (2.5 + s) * u, C[5], (0.1 + 0.05 * s) * a)

# 一团水雾（pixelfx Mist）：柔和的圆，上面亮一点，带一点光
func _water_mist(p: Vector2, r: float, c: Color, a: float, C: Array) -> void:
	if a < 0.01 or r < 0.3: return
	_add = false
	_blob(p, r, [[0.0, c, a * 0.75], [0.5, c, a * 0.56], [1.0, c, 0.0]])
	_blob(p + Vector2(-r * 0.2, -r * 0.32), r * 0.55, [[0.0, C[7], a * 0.25], [1.0, C[7], 0.0]])
	_water_glow(p, r * 1.5, C[5], 0.16 * a)

# 闪光点（pixelfx sparkle）：十字，n 个像素长，尖上颜色浅一点，够大时加斜角，白色中心，带光
func _water_sparkle(p: Vector2, arm: float, c: Color, tip: Color, u: float, a := 1.0) -> void:
	var n := roundi(arm)
	if n < 1 or a <= 0.01: return
	for d in range(1, n + 1):
		for q in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
			_water_dot(p + q * d * u, 0.55 * u, tip if d > n * 0.6 else c, a)
	if n >= 3:
		for q in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			_water_dot(p + q * u, 0.55 * u, c, a)
	_water_dot(p, 0.6 * u, Color(1, 1, 1), a)
	_water_glow(p, (4.0 + n * 2.0) * u, c, 0.6 * a)

# 水球：在 (0, 0)（变换可能转到飞行方向，这里转回屏幕方向，光从左上来）；本体在噪声层画，
# 这里画它后面的光和后面的水雾，以及盖在本体上面的水流、气泡、高光、亮点、光和前面的水雾
func _remote_water(R: float, key: int) -> void:
	var o := _water_orb(R, _t, key)
	var C := _water_ramp()
	var u: float = o.u
	var xf := _xf
	_xf = xf * Transform2D(-xf.get_rotation(), Vector2.ZERO)
	if soft_light: _water_glow(Vector2.ZERO, o.back_r, C[4], o.back_a)  # 像素风不画大片的光（会变成一块平的圆）
	for q in o.motes:
		if not q.front: _water_dot(q.at, 0.6 * u, C[4])
	_over = true
	for d in o.dashes: _water_line(d.pts, C[d.tone], d.w)
	for b in o.bubbles: _water_dot(b.at, b.r, C[b.tone])
	var a0 := PI * 1.12
	var a1 := PI * 1.4
	_water_band(R * 0.74, 1.8 * u, a0, a1, C[6])
	_water_band(R * 0.74, 1.8 * u * 0.6, a0 + (a1 - a0) * 0.25, a0 + (a1 - a0) * 0.75, C[7])
	for sp in o.specks: _water_dot(sp[0], 0.6 * u, C[sp[1]])
	_water_dot(o.fleck, o.fleck_r, C[6])
	_water_dot(o.fleck, 0.6 * u, C[7])
	for g in o.glows:
		if soft_light or float(g.r) <= 20.0 * u: _water_glow(g.at, g.r, C[g.tone], g.a)
	for q in o.motes:
		if q.front:
			_water_dot(q.at, 0.6 * u, C[7])
			_water_dot(q.at - Vector2((-1.0 if q.i % 2 else 1.0) * u, 0.0), 0.6 * u, C[5])
			_water_glow(q.at, 4.0 * u, C[5], 0.35)
	_over = false
	_xf = xf

# 噪声层：水球的本体（每个在飞的、或原地的那一个）
func _water_field(m: ShaderMaterial) -> void:
	var ea := []
	var eb := []
	var R := _remote_radius()
	if not _remote_active():
		ea.append(Vector4(_cx, _cy, R, 0.0))
		var o0 := _water_orb(R, _t, random_seed)
		eb.append(Vector4(0.0, o0.w1, o0.w2, 0.0))
	else:
		for index in flight_count:
			var state := _remote_state(_t * frames, index)
			if not state.born or state.finished or not state.body: continue
			var scale0: float = 1.0 if state.launched else 0.15 + state.charge * 0.85
			var o := _water_orb(R * scale0, _t, random_seed + index * 31)
			ea.append(Vector4(state.at.x, state.at.y, R * scale0, state.angle))
			eb.append(Vector4(1.0, o.w1, o.w2, 0.0))
	if ea.is_empty(): return
	var count := ea.size()
	while ea.size() < 240: ea.append(Vector4.ZERO)
	while eb.size() < 240: eb.append(Vector4.ZERO)
	m.set_shader_parameter("mode", 11)
	m.set_shader_parameter("ne", count)
	m.set_shader_parameter("ea", PackedVector4Array(ea))
	m.set_shader_parameter("eb", PackedVector4Array(eb))
	_field_quad(0, 0, _w, _h)

func _water_lot(lot: Dictionary, C: Array, u: float) -> void:
	for m in lot.mists: _water_mist(m.at, m.r, C[m.tone], m.a, C)
	for b in lot.beads: _water_bead(b.at, b.v, b.s, C, u, b.a)
	for f in lot.flecks: _water_dot(f.at, 0.55 * u, C[f.tone], f.a)

# 飞的时候甩出来的东西，都留在甩出来的地方（和 _remote_shed 一样按出生时间算）：从后面甩出的水珠往下掉，
# 每三颗带一团水雾，每两颗带一点水花；拖尾保留调多久，粒子调多少
func _water_trail(state: Dictionary, index: int, R: float, key: int) -> Dictionary:
	var out := {"beads": [], "mists": [], "flecks": []}
	if amount <= 0.0 or trail_frames <= 0.0: return out
	var u := R / 19.0
	var life := minf(14.0, maxf(4.0, trail_frames))
	var rate := maxf(0.3, minf(3.0, amount * 1.5))
	var G := u * 0.09
	var post_fade := 1.0 - _smooth(0.0, maxf(1.0, minf(life, impact_frames)), maxf(0.0, state.time - charge_frames - travel_frames))
	var oldest := maxf(charge_frames, state.time - life)
	var newest := minf(state.time, charge_frames + travel_frames)
	for j in range(ceili(oldest * rate), floori(newest * rate) + 1):
		var P := Rand.new(key * 211 + j * 577 + index * 41)
		var born := j / rate
		var age: float = state.time - born
		var span := life * (0.6 + 0.4 * P.next())
		if age < 0.0 or age >= span: continue
		var pu := _remote_progress((born - charge_frames) / maxf(1.0, travel_frames))
		var p := _remote_path(pu, index)
		var q := _remote_path(minf(1.0, pu + 0.005), index)
		var dir := Vector2.from_angle((q - p).angle())
		var nrm := Vector2(-dir.y, dir.x)
		var side := P.next() * 2.0 - 1.0
		var f := age / span
		var at0 := p - dir * R * 0.75 + nrm * side * R * 0.55
		var back := u * (0.6 + 1.2 * P.next())
		var up := u * 1.2 * P.next()
		var v0 := -dir * back + nrm * side * u * 0.8 - Vector2(0.0, up)
		var sz := P.next()
		var size := 3 if sz < 0.15 else (2 if sz < 0.55 else 1)
		var fade := minf(1.0, (span - age) / 2.0) * post_fade
		out.beads.append({"at": at0 + v0 * age + Vector2(0.0, 0.5 * G * age * age), "v": v0 + Vector2(0.0, G * age), "s": size, "a": fade})
		if j % 3 == 0:
			var r0 := (2.5 + 1.5 * P.next()) * u
			var r1 := (7.0 + 4.0 * P.next()) * u
			var e := 1.0 - pow(1.0 - f, 2.2)
			out.mists.append({"at": at0 - dir * u * 2.0 * age * 0.3 - Vector2(0.0, u * 0.25 * age), "r": r0 + (r1 - r0) * e, "tone": 6 if P.next() < 0.5 else 5, "a": 0.3 * minf(1.0, f / 0.12) * pow(1.0 - f, 1.4) * post_fade})
		if j % 2 == 0:
			var sx := (P.next() - 0.5) * u * 3.0
			var sy := -u * (1.0 + 2.0 * P.next())
			out.flecks.append({"at": at0 + Vector2(sx * age, sy * age + 0.5 * G * 0.6 * age * age), "tone": 7 if P.next() < 0.5 else 6, "a": (1.0 - f) * post_fade})
	return out

func _remote_water_trail(state: Dictionary, index: int, R: float) -> void:
	_water_lot(_water_trail(state, index, R, random_seed + index * 31), _water_ramp(), R / 19.0)

# 水花（和编辑器 waterSplash 一样，任意一帧都能直接算出来，t = 1 时全都没了）
const SPLASH_LANES := 14
const SPLASH_FINGERS := 9
const SPLASH_TEAR := 0.11
const SPLASH_ARC := 1.35
const SPLASH_DRAG := 1.2
func _splash_flown(dt: float) -> float:
	return (1.0 - exp(-SPLASH_DRAG * dt)) / SPLASH_DRAG
func _eoc(x: float) -> float:
	return 1.0 - pow(1.0 - clampf(x, 0.0, 1.0), 3.0)
func _eiq(x: float) -> float:
	return pow(clampf(x, 0.0, 1.0), 2.0)
func _splash_height(x: float, u: float) -> float:
	return 19.0 * u * _eoc(x / 0.09) * (1.0 - _eiq((x - 0.12) / 0.3))
func _splash_lip(x: float, u: float) -> float:
	return (3.0 + 7.5 * _eoc(x / 0.45)) * u + _splash_height(x, u) * 0.42 + 3.0 * u * _eoc(x / 0.25)

func _water_splash(Rh: float, quantity: float, key: int, t: float, angle: float) -> Dictionary:
	var P := Rand.new(key * 229 + 71)
	var u := Rh / 25.0
	var q := clampf(quantity, 0.25, 2.0)
	var end := 1.0 - _smooth(0.75, 1.0, t)
	var G := 150.0 * u
	var out := {"glows": [], "flash": {}, "lip": [], "fingers": [], "beads": [], "flecks": [], "stars": [], "mists": []}
	out.glows.append({"at": Vector2(0.0, -u), "r": 52.0 * u, "tone": 5, "a": 0.6 * (1.0 - _smooth(0.0, 0.45, t))})
	out.glows.append({"at": Vector2.ZERO, "r": 16.0 * u, "tone": 7, "a": 0.5 * (1.0 - _smooth(0.0, 0.08, t))})
	out.glows.append({"at": Vector2.ZERO, "r": 34.0 * u, "tone": 4, "a": 0.2 * (1.0 - _smooth(0.0, 1.0, t))})
	if t < 0.07: out.flash = {"r": 7.0 * u * (1.0 - t / 0.07 * 0.4), "arm": 5.0 * (1.0 - t / 0.07)}
	var rt := _splash_lip(t, u)
	var white := t < 0.045
	var span := 2.0 * SPLASH_ARC / SPLASH_LANES
	for k in SPLASH_LANES:
		var a0 := angle - SPLASH_ARC + k * span
		var a1 := a0 + span
		var am := (a0 + a1) / 2.0
		var thin := sin(PI * (k + 0.5) / SPLASH_LANES)
		var b0 := 0.13 + 0.14 * P.next()
		var b1 := 0.23 + 0.14 * P.next()
		var keep := 1.0 - _smooth(b0, b1, t)
		var sc := 0.86 + 0.28 * P.next()
		if keep <= 0.02 or t <= 0.0: continue
		var lit := (-cos(am) - sin(am)) / sqrt(2.0)
		out.lip.append({"a0": a0, "a1": a1, "r": rt * sc * (1.0 + 0.35 * cos(am - angle)), "w": 1.6 * u * keep * (0.4 + 0.6 * thin), "tone": 7 if white else (7 if lit > 0.35 else (6 if lit > -0.2 else 5)), "a": keep})
	for k in SPLASH_FINGERS:
		var a := angle - SPLASH_ARC + (k + 0.5) / SPLASH_FINGERS * 2.0 * SPLASH_ARC
		var fw := 1.0 + 0.35 * cos(a - angle)
		var L := 0.2 + 0.16 * P.next()
		var va := a + (P.next() - 0.5) * 0.16
		var v := (32.0 + 56.0 * P.next()) * u * fw
		var vh := (60.0 + 70.0 * P.next()) * u
		var big := P.next() < 0.3
		var d := Vector2.from_angle(a)
		var reach := 1.0 - _smooth(SPLASH_TEAR, SPLASH_TEAR + 0.1, t)
		var r0 := rt * fw
		var len0 := _splash_height(t, u) * L * reach
		var from := d * r0
		var to := from + d * len0 - Vector2(0.0, len0 * 0.3)
		if len0 >= u: out.fingers.append({"from": from, "to": to, "tone": 7 if white else 6})
		if t > 0.04 and t < SPLASH_TEAR: out.beads.append({"at": to, "v": Vector2(0.0, -u), "s": 2, "a": 1.0})
		if t >= SPLASH_TEAR:
			var dt := t - SPLASH_TEAR
			var h0 := _splash_lip(SPLASH_TEAR, u) * fw
			var L0 := _splash_height(SPLASH_TEAR, u) * L
			var o := d * (h0 + L0) - Vector2(0.0, L0 * 0.3)
			var vv := Vector2(cos(va) * v, sin(va) * v - vh)
			out.beads.append({"at": o + vv * _splash_flown(dt) + Vector2(0.0, 0.5 * G * dt * dt), "v": Vector2(vv.x / 30.0, (vv.y + G * dt) / 30.0), "s": 3 if big else 2, "a": end})
	for i in roundi(20.0 * q):
		var a := P.next() * TAU
		var fw := 1.0 + 0.35 * cos(a - angle)
		var v := (50.0 + 75.0 * P.next()) * u * fw
		var vh := (90.0 + 80.0 * P.next()) * u
		var h := (1.0 + 5.0 * P.next()) * u
		var s := 2 if P.next() < 0.25 else 1
		var delay := 0.04 * P.next()
		var dt := t - delay
		if dt <= 0.0: continue
		var vv := Vector2(cos(a) * v, sin(a) * v * 0.6 - vh)
		out.beads.append({"at": Vector2(cos(a) * 3.0 * u, sin(a) * 3.0 * u - h) + vv * _splash_flown(dt) + Vector2(0.0, 0.5 * G * dt * dt), "v": Vector2(vv.x / 30.0, (vv.y + G * dt) / 30.0), "s": s, "a": end})
	for i in roundi(20.0 * q):
		var a := P.next() * TAU
		var fw := 1.0 + 0.35 * cos(a - angle)
		var x0 := cos(a) * 9.0 * u
		var y0 := sin(a) * 9.0 * u * 0.6 - (6.0 + 9.0 * P.next()) * u
		var vx := cos(a) * (25.0 + 65.0 * P.next()) * u * fw
		var vy := -(30.0 + 70.0 * P.next()) * u
		var life := 0.6 + 0.9 * P.next()
		var wh := P.next() < 0.5
		var dt := t - 0.04
		if dt <= 0.0 or dt >= life: continue
		var drag := (1.0 - exp(-1.5 * dt)) / 1.5
		out.flecks.append({"at": Vector2(x0 + vx * drag, y0 + vy * drag + 0.5 * G * 0.4 * dt * dt), "tone": 7 if wh else 6, "a": (1.0 - dt / life) * end})
	for i in 5:
		var x := (P.next() - 0.5) * 26.0 * u
		var y := -(6.0 + 14.0 * P.next()) * u
		var life := 0.25 + 0.3 * P.next()
		var arm := 1.0 + 1.4 * P.next()
		var delay := 0.04 + 0.15 * P.next()
		var k := (t - delay) / life
		if k > 0.0 and k < 1.0: out.stars.append({"at": Vector2(x, y - 4.0 * u * k * life), "arm": arm * sin(PI * k) * 2.0, "a": end})
	for i in 8:
		var a := P.next() * TAU
		var v := (15.0 + 25.0 * P.next()) * u
		var vh := (30.0 + 50.0 * P.next()) * u
		var s := 3 if P.next() < 0.4 else 2
		var dt := t - 0.3
		var r := _splash_lip(0.3, u) * (1.0 + 0.35 * cos(a - angle))
		if dt <= 0.0: continue
		var vv := Vector2(cos(a) * v, sin(a) * v * 0.6 - vh)
		out.beads.append({"at": Vector2(cos(a) * r, sin(a) * r * 0.6) + vv * _splash_flown(dt) + Vector2(0.0, 0.5 * G * dt * dt), "v": Vector2(vv.x / 30.0, (vv.y + G * dt) / 30.0), "s": s, "a": end})
	for i in 9:
		var sd := 1.0 if i % 2 else -1.0
		var x := sd * (4.0 + 8.0 * P.next()) * u
		var y := -(1.0 + 6.0 * P.next()) * u
		var vx := sd * (25.0 + 45.0 * P.next()) * u
		var vy := -(4.0 + 12.0 * P.next()) * u
		var r0 := (2.5 + 1.5 * P.next()) * u
		var r1 := (7.0 + 4.0 * P.next()) * u
		var life := 0.9 + 0.6 * P.next()
		var tone := 6 if P.next() < 0.5 else 5
		var a := 0.3 + 0.12 * P.next()
		var delay := 0.1 * P.next()
		var dt := t - delay
		if dt <= 0.0 or dt >= life: continue
		var e := 1.0 - pow(1.0 - dt / life, 2.2)
		var drag := (1.0 - exp(-2.4 * dt)) / 2.4
		out.mists.append({"at": Vector2(x + vx * drag, y + vy * drag - 3.5 * u * dt * dt), "r": r0 + (r1 - r0) * e, "tone": tone, "a": a * minf(1.0, dt / life / 0.12) * pow(1.0 - dt / life, 1.4) * end})
	return out

func _remote_water_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var o := _water_splash(radius, amount, key, t, angle)
	var C := _water_ramp()
	var u := radius / 25.0
	for g in o.glows:
		if soft_light or float(g.r) <= 20.0 * u: _water_glow(g.at, g.r, C[g.tone], g.a)
	for l in o.lip: _water_band(float(l.r) + float(l.w) / 2.0, l.w, l.a0, l.a1, C[l.tone], l.a)
	for f in o.fingers: _water_line(PackedVector2Array([f.from, f.to]), C[f.tone], u)
	_water_lot(o, C, u)
	for s in o.stars: _water_sparkle(s.at, s.arm, C[6], C[5], u, s.a)
	if not o.flash.is_empty():
		_water_dot(Vector2.ZERO, o.flash.r, C[7])
		_water_sparkle(Vector2(0.0, -3.0 * u), o.flash.arm, C[6], C[5], u)
	_xf = xf
`;
