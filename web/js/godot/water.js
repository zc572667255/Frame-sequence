// 水球, drawn the same way as vfx/kinds/water.js (after pixelfx's water orb
// and splash, https://github.com/patch-gg/pixelfx, MIT): the see-through
// body in the noise shader (mode 11, per pixel, exactly as orbShade with
// elastic liquid sloshing in flight), the rest as shapes on top of it; the
// teardrop beads, mist and spray it sheds; the multi-layer splash.

// the body in the field shader: ea[i] = (centre x, y, radius, angle of
// flight), eb[i] = (sx when flying else 0, skin phase 1, skin phase 2, sway)
export const WATER_FIELD = `
	} else if (mode == 11) {
		vec3 acc = vec3(0.0);
		float aa = 0.0;
		for (int i = 0; i < ne; i++) {
			vec4 head = ea[i];
			vec4 st = eb[i];
			vec2 delta = UV - head.xy;
			float ca = cos(head.w), si = sin(head.w);
			bool flow = st.x > 0.5;
			vec2 e = delta;
			if (flow) {
				float sx = st.x, sy = 1.0 / sx;
				float slx = delta.x * ca + delta.y * si, sly = -delta.x * si + delta.y * ca;
				float lx = slx / sx;
				float bk = max(0.0, -lx / max(0.5, head.z));
				float ly = (sly - st.w * head.z * bk * bk) / sy;
				e = vec2(lx * ca - ly * si, lx * si + ly * ca);
			}
			float d = length(e);
			float an = atan(e.y, e.x);
			float r;
			if (flow) {
				float ar = an - head.w;
				float rear = 0.65 + 0.325 * (1.0 - cos(ar));
				r = head.z * (1.0 + (0.045 * sin(ar * 2.0 - st.y) + 0.055 * sin(ar * 3.0 - st.z) + 0.028 * sin(ar * 4.0 + st.y + st.z)) * rear);
			} else {
				r = head.z * (1.0 + 0.032 * sin(an * 3.0 + st.y) + 0.018 * sin(an * 5.0 - st.z));
			}
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

# 飞行时的液态弹性晃荡：沿飞行方向的体积守恒伸缩 + 后半部左右摇摆（全部整数周期，循环无缝）
func _water_slosh(t: float, key: int) -> Dictionary:
	var T := t * TAU
	var sd := fposmod(key * 1.17, TAU)
	var s1 := sin(T * _water_cycles(4) + sd)
	var s2 := sin(T * _water_cycles(6) - sd * 1.3)
	var sx := 1.09 + 0.085 * s1 + 0.03 * s2
	var sway := 0.14 * sin(T * _water_cycles(3) + sd * 0.7) + 0.045 * sin(T * _water_cycles(5) - sd)
	return {"sx": sx, "sy": 1.0 / sx, "sway": sway}

func _slosh_fwd(p: Vector2, R: float, ang: float, sl: Dictionary) -> Vector2:
	var c := cos(ang)
	var s := sin(ang)
	var lx := p.x * c + p.y * s
	var ly := -p.x * s + p.y * c
	var bk := maxf(0.0, -lx / maxf(0.5, R))
	var slx := lx * float(sl.sx)
	var sly := ly * float(sl.sy) + float(sl.sway) * R * bk * bk
	return Vector2(slx * c - sly * s, slx * s + sly * c)

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
	if pts.size() < 2 or a <= 0.005: return
	_add = false
	_line(pts, PackedColorArray([_col(c, a)]), maxf(0.6, w))

func _water_fill(pts: PackedVector2Array, c: Color, a := 1.0) -> void:
	if pts.size() < 3 or a <= 0.005: return
	_add = false
	_poly_fill(pts, PackedColorArray([_col(c, a)]))

# 三角条带：secs 是 [{"a": Vector2, "b": Vector2}, ...]
func _water_strip(secs: Array, c: Color, a := 1.0) -> void:
	var n := secs.size()
	if n < 2 or a <= 0.005: return
	var pts := PackedVector2Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()
	var cc := _col(c, a)
	for i in n:
		var q: Dictionary = secs[i]
		pts.append(q.a); pts.append(q.b)
		cols.append(cc); cols.append(cc)
	for i in n - 1:
		var k := i * 2
		idx.append(k); idx.append(k + 2); idx.append(k + 3)
		idx.append(k); idx.append(k + 3); idx.append(k + 1)
	_add = false
	_tri(idx, pts, cols)

# 圆心在 (0, 0)、外半径 r、宽 w 的一段弧（a0 → a1）
func _water_band(r: float, w: float, a0: float, a1: float, c: Color, a := 1.0) -> void:
	var pts := PackedVector2Array()
	for i in 13: pts.append(Vector2.from_angle(lerpf(a0, a1, i / 12.0)) * r)
	for i in range(12, -1, -1): pts.append(Vector2.from_angle(lerpf(a0, a1, i / 12.0)) * maxf(0.0, r - w))
	_add = false
	_poly_fill(pts, PackedColorArray([_col(c, a)]))

func _water_band_warped(r: float, w: float, a0: float, a1: float, R: float, ang: float, sl: Dictionary, c: Color, a := 1.0) -> void:
	var pts := PackedVector2Array()
	var ri := maxf(0.0, r - w)
	for i in 13: pts.append(_slosh_fwd(Vector2.from_angle(lerpf(a0, a1, i / 12.0)) * r, R, ang, sl))
	for i in range(12, -1, -1): pts.append(_slosh_fwd(Vector2.from_angle(lerpf(a0, a1, i / 12.0)) * ri, R, ang, sl))
	_add = false
	_poly_fill(pts, PackedColorArray([_col(c, a)]))

# 一颗水珠（1 细点，2 小水珠，3 带高光的圆水珠），收尖泪滴形尾巴沿运动方向往后拖，越快越长
func _water_bead(p: Vector2, v: Vector2, s: int, C: Array, u: float, a := 1.0) -> void:
	if a <= 0.01: return
	var sp := v.length()
	if sp < 1e-9: sp = 1.0
	var d := v / sp
	var n := Vector2(-d.y, d.x)
	var hr := (1.75 if s >= 3 else (1.15 if s >= 2 else 0.6)) * u
	var tail := minf((7.5 if s >= 3 else (6.2 if s >= 2 else 4.5)) * u, sp * 1.25)
	if tail >= hr * 0.85:
		var w0 := hr * 0.88
		var wm := hr * 0.42
		var mid := tail * 0.46 + hr * 0.35
		var tip := tail + hr
		_water_fill(PackedVector2Array([
			p + n * w0,
			p - d * mid + n * wm,
			p - d * tip,
			p - d * mid - n * wm,
			p - n * w0,
		]), C[3], a * 0.88)
		_water_line(PackedVector2Array([p - d * (tail * 0.68 + hr * 0.45), p - d * hr * 0.35]), C[5] if s > 1 else C[4], maxf(0.55, hr * 0.58), a * 0.92)
	if s >= 3:
		_water_dot(p, 1.75 * u, C[4], a)
		_water_dot(p - Vector2(0.25, 0.25) * u, 1.15 * u, C[6], a)
		_water_dot(p - Vector2(0.68, 0.68) * u, 0.52 * u, C[7], a)
	elif s >= 2:
		_water_dot(p, 1.15 * u, C[5], a)
		_water_dot(p - Vector2(0.35, 0.35) * u, 0.5 * u, C[7], a)
	else:
		_water_dot(p, 0.6 * u, C[6] if sp > 2.2 * u else C[5], a)
	_water_glow(p, (2.6 + s) * u, C[5], (0.11 + 0.05 * s) * a)

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
# 这里画它后面的光和后面的水雾，以及随晃荡变形盖在本体上面的水流、气泡、高光、亮点、光和前面的水雾
func _remote_water(R: float, key: int) -> void:
	var o := _water_orb(R, _t, key)
	var C := _water_ramp()
	var u: float = o.u
	var xf := _xf
	var ang := xf.get_rotation()
	var flow := _remote_active()
	var sl := _water_slosh(_t, key) if flow else {"sx": 1.0, "sy": 1.0, "sway": 0.0}
	_xf = xf * Transform2D(-ang, Vector2.ZERO)
	if soft_light: _water_glow(Vector2.ZERO, o.back_r, C[4], o.back_a)
	for q in o.motes:
		if not q.front: _water_dot(q.at, 0.6 * u, C[4])
	_over = true
	for d in o.dashes:
		if flow:
			var wpts := PackedVector2Array()
			for pt in d.pts: wpts.append(_slosh_fwd(pt, R, ang, sl))
			_water_line(wpts, C[d.tone], d.w)
		else:
			_water_line(d.pts, C[d.tone], d.w)
	for b in o.bubbles:
		var bp: Vector2 = _slosh_fwd(b.at, R, ang, sl) if flow else b.at
		_water_dot(bp, b.r, C[b.tone])
	var a0 := PI * 1.12
	var a1 := PI * 1.4
	var sh_off := float(sl.sway) * 0.65 if flow else 0.0
	if flow:
		_water_band_warped(R * 0.74, 1.8 * u, a0 + sh_off, a1 + sh_off, R, ang, sl, C[6])
		_water_band_warped(R * 0.74, 1.8 * u * 0.6, a0 + (a1 - a0) * 0.25 + sh_off, a0 + (a1 - a0) * 0.75 + sh_off, R, ang, sl, C[7])
	else:
		_water_band(R * 0.74, 1.8 * u, a0, a1, C[6])
		_water_band(R * 0.74, 1.8 * u * 0.6, a0 + (a1 - a0) * 0.25, a0 + (a1 - a0) * 0.75, C[7])
	for sp in o.specks:
		var sp_at: Vector2 = _slosh_fwd(sp[0], R, ang, sl) if flow else sp[0]
		_water_dot(sp_at, 0.6 * u, C[sp[1]])
	var fl: Vector2 = _slosh_fwd(o.fleck, R, ang, sl) if flow else o.fleck
	_water_dot(fl, o.fleck_r, C[6])
	_water_dot(fl, 0.6 * u, C[7])
	for g in o.glows:
		if soft_light or float(g.r) <= 20.0 * u:
			var gp: Vector2 = _slosh_fwd(g.at, R, ang, sl) if flow else g.at
			_water_glow(gp, g.r, C[g.tone], g.a)
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
			var key := random_seed + index * 31
			var o := _water_orb(R * scale0, _t, key)
			var sl := _water_slosh(_t, key)
			ea.append(Vector4(state.at.x, state.at.y, R * scale0, state.angle))
			eb.append(Vector4(sl.sx, o.w1, o.w2, sl.sway))
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

# 飞的时候从晃荡水球后方甩出的水珠、水雾和水花，都留在原处
func _water_trail(state: Dictionary, index: int, R: float, key: int) -> Dictionary:
	var out := {"beads": [], "mists": [], "flecks": []}
	if amount <= 0.0 or trail_frames <= 0.0: return out
	var u := R / 19.0
	var life := minf(14.0, maxf(4.0, trail_frames))
	var rate := clampf(amount * 1.8, 0.35, 3.5)
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
		var at0 := p - dir * R * 0.72 + nrm * side * R * 0.58
		var back := u * (0.65 + 1.25 * P.next())
		var up := u * 1.15 * P.next()
		var v0 := -dir * back + nrm * side * u * 0.85 - Vector2(0.0, up)
		var sz := P.next()
		var size := 3 if sz < 0.18 else (2 if sz < 0.58 else 1)
		var fade := minf(1.0, (span - age) / 2.0) * post_fade
		var slip := (1.0 - f) * 1.5 * u
		var vy := v0.y + G * age
		out.beads.append({"at": at0 + v0 * age + Vector2(0.0, 0.5 * G * age * age), "v": Vector2(v0.x * 1.4 - dir.x * slip, vy * 1.35 - dir.y * slip), "s": size, "a": fade})
		if j % 3 == 0:
			var r0 := (2.5 + 1.5 * P.next()) * u
			var r1 := (7.2 + 4.2 * P.next()) * u
			var e := 1.0 - pow(1.0 - f, 2.2)
			out.mists.append({"at": at0 - dir * u * 2.0 * age * 0.3 - Vector2(0.0, u * 0.25 * age), "r": r0 + (r1 - r0) * e, "tone": 6 if P.next() < 0.5 else 5, "a": 0.26 * minf(1.0, f / 0.12) * pow(1.0 - f, 1.4) * post_fade})
		if j % 2 == 0:
			var sx := (P.next() - 0.5) * u * 3.2 - dir.x * u * 0.7
			var sy := -u * (1.0 + 2.1 * P.next()) - dir.y * u * 0.7
			out.flecks.append({"at": at0 + Vector2(sx * age, sy * age + 0.5 * G * 0.6 * age * age), "tone": 7 if P.next() < 0.5 else 6, "a": (1.0 - f) * post_fade})
	return out

func _remote_water_trail(state: Dictionary, index: int, R: float) -> void:
	_water_lot(_water_trail(state, index, R, random_seed + index * 31), _water_ramp(), R / 19.0)

# 水花（和编辑器 waterSplash 一样，任意一帧都能直接算出来，t = 1 时全都没了）
const SPLASH_LANES := 18
const SPLASH_FINGERS := 11
const SPLASH_TEAR := 0.24
const SPLASH_ARC := 1.42
const SPLASH_DRAG := 1.45
func _splash_flown(dt: float) -> float:
	return (1.0 - exp(-SPLASH_DRAG * dt)) / SPLASH_DRAG
func _eoc(x: float) -> float:
	return 1.0 - pow(1.0 - clampf(x, 0.0, 1.0), 3.0)
func _eiq(x: float) -> float:
	return pow(clampf(x, 0.0, 1.0), 2.0)
func _splash_height(x: float, u: float) -> float:
	return 22.0 * u * _eoc(x / 0.12) * (1.0 - _eiq((x - 0.18) / 0.34))
func _splash_lip(x: float, u: float) -> float:
	return (4.0 + 14.5 * _eoc(x / 0.44)) * u + _splash_height(x, u) * 0.38 + 3.5 * u * _eoc(x / 0.24)

func _tendril_sections(from0: Vector2, mid0: Vector2, to0: Vector2, w0: float, w_neck: float, tip_r: float) -> Dictionary:
	var secs := []
	var spine := PackedVector2Array()
	for i in 8:
		var s := i / 7.0
		var m := 1.0 - s
		var p := from0 * (m * m) + mid0 * (2.0 * m * s) + to0 * (s * s)
		var tg := (mid0 - from0) * (2.0 * m) + (to0 - mid0) * (2.0 * s)
		var ln := maxf(1e-6, tg.length())
		var n := Vector2(-tg.y / ln, tg.x / ln)
		var hw := lerpf(w0, w_neck, s / 0.72) if s < 0.72 else lerpf(w_neck, tip_r * 0.82, _smooth(0.72, 1.0, s))
		secs.append({"a": p + n * hw, "b": p - n * hw})
		spine.append(p)
	return {"secs": secs, "spine": spine}

func _water_splash(Rh: float, quantity: float, key: int, t: float, angle: float) -> Dictionary:
	var P := Rand.new(key * 229 + 71)
	var u := Rh / 25.0
	var q := clampf(quantity, 0.25, 2.0)
	var end := 1.0 - _smooth(0.72, 1.0, t)
	var G := 165.0 * u
	var out := {"glows": [], "flash": {}, "rings": [], "sheets": [], "lip": [], "fingers": [], "beads": [], "flecks": [], "stars": [], "mists": []}
	out.glows.append({"at": Vector2(0.0, -u), "r": 56.0 * u, "tone": 5, "a": 0.58 * (1.0 - _smooth(0.0, 0.5, t))})
	out.glows.append({"at": Vector2.ZERO, "r": 22.0 * u, "tone": 7, "a": 0.7 * (1.0 - _smooth(0.0, 0.16, t))})
	out.glows.append({"at": Vector2.ZERO, "r": 36.0 * u, "tone": 4, "a": 0.22 * (1.0 - _smooth(0.0, 1.0, t))})
	if t < 0.15:
		var ff := t / 0.15
		out.flash = {"r": 9.5 * u * (0.45 + 0.55 * (1.0 - ff)) * (1.0 - 0.35 * ff * ff), "arm": 6.5 * (1.0 - ff)}
	var white := t < 0.06
	# 1) 撞击扩散水波环
	if t > 0.0 and t < 0.44:
		var rf := t / 0.44
		var r_ring := (5.5 + 26.0 * _eoc(rf)) * u
		var ring_a := (1.0 - _smooth(0.24, 0.44, t)) * 0.92
		var seg_span := TAU / 12.0
		for k in 12:
			var drop_at := 0.16 + 0.22 * P.next()
			var keep := 1.0 - _smooth(drop_at, drop_at + 0.12, t)
			if keep <= 0.02: continue
			var a0 := angle + k * seg_span + 0.04
			var a1 := a0 + seg_span * (0.86 - 0.32 * rf)
			var pts := PackedVector2Array()
			for i in 6:
				var aa := lerpf(a0, a1, i / 5.0)
				var rr := r_ring * (1.0 + 0.24 * cos(aa - angle))
				pts.append(Vector2(cos(aa), sin(aa)) * rr)
			out.rings.append({"pts": pts, "w": (2.2 * (1.0 - rf * 0.65)) * u * keep, "tone": 7 if white else 6, "a": ring_a * keep})
	# 2) 炸开的有机水花瓣/水幕
	for k in 7:
		var recoil := k >= 5
		var a := (angle + PI + (-0.58 if k == 5 else 0.58) + (P.next() - 0.5) * 0.32) if recoil else (angle - SPLASH_ARC * 0.88 + (k + 0.5) / 5.0 * 2.0 * SPLASH_ARC * 0.88 + (P.next() - 0.5) * 0.2)
		var spread := (0.32 if recoil else 0.38) + 0.14 * P.next()
		var fw := 1.0 + 0.42 * cos(a - angle)
		var reach := (0.62 if recoil else 0.92 + 0.36 * P.next()) * fw
		var delay := 0.015 * P.next()
		var life := 0.36 + 0.1 * P.next()
		var dt := t - delay
		if dt <= 0.0 or dt >= life: continue
		var ff := dt / life
		var grow := _eoc(ff / 0.38)
		var keep := 1.0 - _smooth(0.45, 1.0, ff)
		var r_in := (2.5 + 9.0 * ff) * u * reach
		var r_out := (7.0 + 22.0 * grow) * u * reach
		var half := spread * (0.65 + 0.45 * grow) * (0.45 + 0.55 * keep)
		var pts := PackedVector2Array()
		var rim_pts := PackedVector2Array()
		pts.append(Vector2.from_angle(a - half * 0.28) * r_in)
		for i in 9:
			var s := i / 8.0
			var ang := a - half + s * 2.0 * half
			var lobe := 0.84 + 0.18 * sin(s * PI) + 0.11 * sin(s * PI * 3.0)
			var rr := r_in + (r_out - r_in) * lobe
			var pt := Vector2(cos(ang) * rr, sin(ang) * rr - 2.5 * u * grow * sin(s * PI))
			pts.append(pt)
			if i >= 1 and i <= 7: rim_pts.append(pt)
		pts.append(Vector2.from_angle(a + half * 0.28) * r_in)
		var lit := (-cos(a) - sin(a)) / sqrt(2.0)
		out.sheets.append({"pts": pts, "rim_pts": rim_pts, "tone": 6 if white else (5 if lit > 0.2 else 4), "rim_tone": 7 if (white or lit > -0.1) else 6, "a": keep * (0.56 if recoil else 0.72)})
	# 3) 连续平滑的水冠边缘（只朝前张开，不成圈）
	var rt := _splash_lip(t, u)
	var span := 2.0 * SPLASH_ARC / SPLASH_LANES
	var ph1 := P.next() * TAU
	var ph2 := P.next() * TAU
	for k in SPLASH_LANES:
		var a0 := angle - SPLASH_ARC + k * span
		var a1 := a0 + span
		var am := (a0 + a1) / 2.0
		var u_ang := (k + 0.5) / SPLASH_LANES
		var thin := sin(PI * u_ang)
		var tear_s := 0.18 + 0.14 * P.next()
		var keep := 1.0 - _smooth(tear_s, tear_s + 0.14, t)
		if keep <= 0.02 or t <= 0.0: continue
		var wave := 1.0 + 0.14 * sin(u_ang * PI * 5.0 + ph1) + 0.07 * sin(u_ang * PI * 9.0 + ph2)
		var lit := (-cos(am) - sin(am)) / sqrt(2.0)
		out.lip.append({"a0": a0, "a1": a1, "r": rt * wave * (1.0 + 0.42 * cos(am - angle)), "w": 3.1 * u * keep * (0.35 + 0.65 * thin), "tone": 7 if white else (7 if lit > 0.3 else (6 if lit > -0.25 else 5)), "a": keep})
	# 4) 粗细渐变的弯曲液态水舌，拉长颈缩后甩出大水珠
	for k in SPLASH_FINGERS:
		var u_ang := (k + 0.5) / SPLASH_FINGERS
		var a := angle - SPLASH_ARC * 0.96 + u_ang * 2.0 * SPLASH_ARC * 0.96
		var fw := 1.0 + 0.42 * cos(a - angle)
		var L := 0.45 + 0.42 * P.next()
		var va := a + (P.next() - 0.5) * 0.2
		var v := (48.0 + 78.0 * P.next()) * u * fw
		var vh := (48.0 + 75.0 * P.next()) * u
		var big := P.next() < 0.42
		var bend := (P.next() - 0.5) * 0.36
		var d := Vector2.from_angle(a)
		var n := Vector2(-d.y, d.x)
		var reach := 1.0 - _smooth(SPLASH_TEAR, SPLASH_TEAR + 0.14, t)
		var r0 := rt * fw
		var len0 := (9.0 + 19.0 * _eoc(t / 0.26)) * u * L * reach
		var from0 := d * r0 * 0.92
		var to0 := from0 + d * len0 + Vector2(0.0, -len0 * 0.22 + 0.18 * G * t * t * 0.4)
		var mid0 := (from0 + to0) * 0.5 + n * len0 * bend - Vector2(0.0, len0 * 0.12)
		if len0 >= u and t > 0.0:
			var w0 := (2.3 + 0.9 * (1.0 - t / 0.4)) * u * reach
			var w_neck := (0.55 + 0.35 * (1.0 - _smooth(0.08, SPLASH_TEAR, t))) * u * reach
			var tip_r := (1.5 if big else 1.15) * u * minf(1.0, t / 0.06) * reach
			out.fingers.append({"from": from0, "mid": mid0, "to": to0, "w0": w0, "w_neck": w_neck, "tip_r": tip_r, "tone": 6 if white else 5, "hi_tone": 7 if white else 6, "a": minf(1.0, reach * 1.4)})
		if t >= SPLASH_TEAR:
			var dt := t - SPLASH_TEAR
			var h0 := _splash_lip(SPLASH_TEAR, u) * fw
			var L0 := (9.0 + 19.0 * _eoc(SPLASH_TEAR / 0.26)) * u * L
			var o := d * (h0 * 0.92 + L0) - Vector2(0.0, L0 * 0.22)
			var vv := Vector2(cos(va) * v, sin(va) * v - vh)
			var spf := exp(-SPLASH_DRAG * dt)
			out.beads.append({"at": o + vv * _splash_flown(dt) + Vector2(0.0, 0.5 * G * dt * dt), "v": Vector2(vv.x * spf / 16.0, (vv.y * spf + G * dt) / 16.0), "s": 3 if big else 2, "a": end})
	# 5) 主方向高速水滴群（偏向前冲 + 四周回溅）
	var n_main := roundi(26.0 * q)
	var n_fwd := roundi(18.0 * q)
	for i in n_main:
		var is_fwd := i < n_fwd
		var a := (angle + (P.next() - 0.5) * 2.5) if is_fwd else (P.next() * TAU)
		var fw := 1.0 + 0.42 * cos(a - angle)
		var v := (58.0 + 95.0 * P.next()) * u * (fw if is_fwd else 0.72)
		var vh := (55.0 + 88.0 * P.next()) * u
		var h := (1.0 + 4.0 * P.next()) * u
		var sz := P.next()
		var s := 3 if sz < 0.22 else (2 if sz < 0.6 else 1)
		var delay := 0.035 * P.next()
		var dt := t - delay
		if dt <= 0.0: continue
		var vv := Vector2(cos(a) * v, sin(a) * v * 0.72 - vh)
		var spf := exp(-SPLASH_DRAG * dt)
		out.beads.append({"at": Vector2(cos(a) * 3.5 * u, sin(a) * 3.5 * u - h) + vv * _splash_flown(dt) + Vector2(0.0, 0.5 * G * dt * dt), "v": Vector2(vv.x * spf / 16.0, (vv.y * spf + G * dt) / 16.0), "s": s, "a": end})
	# 6) 细碎雾化水花与水光星芒
	for i in roundi(24.0 * q):
		var a := P.next() * TAU
		var fw := 1.0 + 0.42 * cos(a - angle)
		var x0 := cos(a) * 8.0 * u
		var y0 := sin(a) * 8.0 * u * 0.65 - (4.0 + 8.0 * P.next()) * u
		var sp := (35.0 + 80.0 * P.next()) * u * fw
		var vx := cos(a) * sp
		var vy := sin(a) * sp * 0.6 - (25.0 + 65.0 * P.next()) * u
		var life := 0.58 + 0.85 * P.next()
		var wh := P.next() < 0.55
		var dt := t - 0.03
		if dt <= 0.0 or dt >= life: continue
		var drag := (1.0 - exp(-1.9 * dt)) / 1.9
		out.flecks.append({"at": Vector2(x0 + vx * drag, y0 + vy * drag + 0.5 * G * 0.38 * dt * dt), "tone": 7 if wh else 6, "a": (1.0 - dt / life) * end})
	for i in 7:
		var a := angle + (P.next() - 0.5) * 3.2
		var rr := (6.0 + 18.0 * P.next()) * u
		var x := cos(a) * rr
		var y := sin(a) * rr - (3.0 + 10.0 * P.next()) * u
		var life := 0.24 + 0.28 * P.next()
		var arm := 1.2 + 1.6 * P.next()
		var delay := 0.03 + 0.18 * P.next()
		var k := (t - delay) / life
		if k > 0.0 and k < 1.0: out.stars.append({"at": Vector2(x, y - 4.0 * u * k * life), "arm": arm * sin(PI * k) * 2.0, "a": end})
	# 7) 水冠回落的重水珠
	for i in 10:
		var a := angle + (P.next() - 0.5) * 3.0
		var fw := 1.0 + 0.42 * cos(a - angle)
		var v := (18.0 + 32.0 * P.next()) * u * fw
		var vh := (24.0 + 48.0 * P.next()) * u
		var s := 3 if P.next() < 0.45 else 2
		var dt := t - 0.26
		var r := _splash_lip(0.26, u) * fw * 0.9
		if dt <= 0.0: continue
		var vv := Vector2(cos(a) * v, sin(a) * v * 0.65 - vh)
		var spf := exp(-SPLASH_DRAG * dt)
		out.beads.append({"at": Vector2(cos(a) * r, sin(a) * r * 0.65) + vv * _splash_flown(dt) + Vector2(0.0, 0.5 * G * dt * dt), "v": Vector2(vv.x * spf / 16.0, (vv.y * spf + G * dt) / 16.0), "s": s, "a": end})
	# 8) 翻涌扩散的水雾
	for i in 11:
		var a := angle + (i - 5) * 0.36 + (P.next() - 0.5) * 0.25
		var sp := (26.0 + 48.0 * P.next()) * u * (0.7 + 0.4 * maxf(0.0, cos(a - angle)))
		var x := cos(a) * (4.0 + 7.0 * P.next()) * u
		var y := sin(a) * (3.0 + 5.0 * P.next()) * u - 2.0 * u
		var vx := cos(a) * sp
		var vy := sin(a) * sp * 0.7 - (5.0 + 12.0 * P.next()) * u
		var r0 := (3.0 + 1.8 * P.next()) * u
		var r1 := (8.5 + 4.5 * P.next()) * u
		var life := 0.85 + 0.55 * P.next()
		var tone := 6 if P.next() < 0.5 else 5
		var ma := 0.28 + 0.12 * P.next()
		var delay := 0.08 * P.next()
		var dt := t - delay
		if dt <= 0.0 or dt >= life: continue
		var e := 1.0 - pow(1.0 - dt / life, 2.2)
		var drag := (1.0 - exp(-2.4 * dt)) / 2.4
		out.mists.append({"at": Vector2(x + vx * drag, y + vy * drag - 3.5 * u * dt * dt), "r": r0 + (r1 - r0) * e, "tone": tone, "a": ma * minf(1.0, dt / life / 0.12) * pow(1.0 - dt / life, 1.4) * end})
	return out

func _remote_water_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf * Transform2D(0.0, at0)
	var o := _water_splash(radius, amount, key, t, angle)
	var C := _water_ramp()
	var u := radius / 25.0
	for g in o.glows:
		if soft_light or float(g.r) <= 20.0 * u: _water_glow(g.at, g.r, C[g.tone], g.a)
	for sh in o.sheets:
		_water_fill(sh.pts, C[sh.tone], float(sh.a) * 0.72)
		_water_line(sh.rim_pts, C[sh.rim_tone], maxf(0.7, 1.25 * u), sh.a)
	for rg in o.rings: _water_line(rg.pts, C[rg.tone], rg.w, rg.a)
	for l in o.lip:
		_water_band(float(l.r) + float(l.w) * 0.75, float(l.w) * 1.45, l.a0, l.a1, C[3], float(l.a) * 0.62)
		_water_band(float(l.r) + float(l.w) * 0.5, l.w, l.a0, l.a1, C[l.tone], l.a)
	for f in o.fingers:
		var td := _tendril_sections(f.from, f.mid, f.to, f.w0, f.w_neck, f.tip_r)
		_water_strip(td.secs, C[f.tone], float(f.a) * 0.92)
		_water_line(td.spine, C[f.hi_tone], maxf(0.55, float(f.w_neck) * 0.9), float(f.a) * 0.95)
		if float(f.tip_r) > 0.4:
			_water_dot(f.to, f.tip_r, C[f.hi_tone], f.a)
			_water_dot(f.to - Vector2(0.3, 0.3) * u, float(f.tip_r) * 0.45, C[7], f.a)
	_water_lot(o, C, u)
	for s in o.stars: _water_sparkle(s.at, s.arm, C[6], C[5], u, s.a)
	if not o.flash.is_empty():
		_water_dot(Vector2.ZERO, o.flash.r, C[7])
		_water_sparkle(Vector2(0.0, -2.5 * u), o.flash.arm, C[6], C[5], u)
	_xf = xf
`;
