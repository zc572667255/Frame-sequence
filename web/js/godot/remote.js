import { REMOTE_DEFAULTS } from "../vfx/remote.js";

export const remoteParams = (s) => Object.fromEntries(Object.entries(REMOTE_DEFAULTS).map(([k, v]) => [k, s[k] ?? v]));
function properties(p) {
  return {
    flight_path: JSON.stringify(p.flightPath), flight_start: `Vector2(${+p.startX}, ${+p.startY})`, flight_end: `Vector2(${+p.endX}, ${+p.endY})`, flight_control: `Vector2(${+p.controlX}, ${+p.controlY})`,
    path_bend: +p.pathBend, path_wave: +p.pathWave, path_turns: +p.pathTurns, flight_ease: JSON.stringify(p.flightEase),
    charge_frames: p.chargeFrames | 0, travel_frames: p.travelFrames | 0, impact_frames: p.impactFrames | 0,
    flight_count: p.flightCount | 0, flight_interval: p.flightInterval | 0, flight_spread: +p.flightSpread,
    body_size: +p.bodySize, trail_frames: +p.trailFrames, trail_width: +p.trailWidth,
    head_width: +p.headWidth, head_curve: +p.headCurve,
    impact_kind: JSON.stringify(p.impactKind), impact_size: +p.impactSize,
  };
}
export const remoteProps = (p) => Object.entries(properties(p)).map(([k, v]) => `${k} = ${v}`);
export const remoteExports = (p) => '@export_group("远程特效：路径、拖尾、命中")\n' + Object.entries(properties(p)).map(([k, v]) => {
  const type = typeof v === "number" && !["charge_frames", "travel_frames", "impact_frames", "flight_count", "flight_interval"].includes(k) ? ': float = ' : ' := ';
  const setter = k === "head_width" || k === "head_curve" ? `:\n\tset(value):\n\t\t${k} = clampf(value, ${k === "head_width" ? "20.0, 250.0" : "0.0, 100.0"})\n\t\tif is_inside_tree(): refresh()` : "";
  return `@export var ${k}${type}${v}${setter}`;
}).join('\n');

export const REMOTE_FIELD = `
	} else if (mode == 9) {
		vec3 acc = vec3(0.0);
		float aa = 0.0;
		for (int i = 0; i < ne; i++) {
			vec4 head = ea[i];
			vec4 state = eb[i];
			vec2 delta = UV - head.xy;
			float ca = cos(head.w), si = sin(head.w);
			vec2 p = vec2(delta.x * ca + delta.y * si, -delta.x * si + delta.y * ca) / max(head.z, 0.01);
			vec3 fc = vec3(0.0);
			float fa = 0.0;
			if (state.x < 0.5) {
				float u = p.x, v = p.y;
				if (u < -1.8 || u > 1.55 || v < -2.1 || v > 1.8) { continue; }
				float age = clamp(-u / 5.0, 0.0, 1.0);
				float bend = (loopn(vec2(v, u), 109, 1.1, 1.0, 3.0) - 0.5) * (0.08 + age * 0.22);
				float n = loopn(vec2(v + bend, u), 101, 1.75, 0.7, 5.0);
				float f = loopn(vec2(v + n * 0.2, u), 107, 4.4, 0.65, 9.0);
				float d = 1.0 - length(vec2(u / (u < 0.0 ? 1.7 : 1.0), v + bend)) + (n - 0.5) * (0.32 + clamp(-u / 1.5, 0.0, 1.0) * 0.3) + (f - 0.5) * 0.15;
				float heat = clamp(0.13 + d * 0.66 + (f - 0.5) * 0.25 - age * 0.24, 0.0, 1.0);
				fa = sm(-0.04, 0.22, d) * (1.0 - sm(0.7, 1.0, age));
				fc = texture(ramp_flame, vec2(heat, 0.5)).rgb;
			} else {
				float tt = state.z;
				float e = 1.0 - pow(1.0 - clamp(tt / 0.42, 0.0, 1.0), 2.2);
				float rise = head.z * 0.32 * pow(tt, 1.5);
				float rb = head.z * (0.16 + 0.66 * e);
				float rs0 = head.z * (0.24 + 0.42 * e + 0.12 * tt);
				float kk = 1.6 / head.z;
				float sy = delta.y + rise * 0.9;
				float wx = (fbm(vec2(delta.x * kk * 0.6, sy * kk * 0.6 + tt), seed * 29 + 7) - 0.5) * rs0 * 0.5;
				float n = fbm(vec2((delta.x + wx) * kk, sy * 1.1 * kk + tt * 1.3), seed * 19 + 3);
				float b = fbm(vec2((delta.x + wx) * kk * 2.4 + 5.0, sy * kk * 2.4 + tt * 2.0), seed * 23 + 5);
				float d = 1.0 - length(vec2(delta.x + wx, sy * 1.1)) / rs0 + (n - 0.5) * 0.95 + (b - 0.5) * 0.35;
				float sa = sm(0.0, 0.3, d) * sm(0.12, 0.5, tt) * (1.0 - sm(0.55, 1.05, tt)) * (0.65 + 0.35 * b) * 0.9;
				float lit = clamp(0.5 - sy / rs0 * 0.55 + (b - 0.5) * 0.9, 0.0, 1.0);
				vec3 sc = mix(smoke_lo.rgb, smoke_hi.rgb, lit * lit);
				float fy = delta.y + rise * 0.5;
				wx = (fbm(vec2(delta.x * kk * 0.7 + 3.0, fy * kk * 0.7 - tt * 0.8), seed * 29 + 7) - 0.5) * rb * 0.6;
				float wy = (fbm(vec2(delta.x * kk * 0.7 - 9.0, fy * kk * 0.7 + 4.0), seed * 29 + 7) - 0.5) * rb * 0.4;
				n = fbm(vec2((delta.x + wx) * kk * 1.2 + 11.0, (fy + wy) * kk * 1.2 - tt * 1.6), seed * 19 + 3);
				b = fbm(vec2((delta.x + wx) * kk * 2.8 - 7.0, (fy + wy) * kk * 2.8 - tt * 2.6), seed * 23 + 5);
				d = 1.0 - length(vec2(delta.x, fy)) / rb + (n - 0.5) * 0.85 + (b - 0.5) * 0.3;
				float cool0 = 1.0 - sm(0.1, 0.72, tt);
				float body = sm(-0.04, 0.25, d);
				float heat = clamp((d * 1.2 + (b - 0.5) * 0.55) * cool0 + 0.5 * (1.0 - sm(0.0, 0.16, tt)) * body, 0.0, 1.0);
				float fire_a = body * sm(0.04, 0.35, heat) + sm(-0.12, 0.02, d) * (1.0 - body) * sm(0.55, 0.8, b) * 0.8 * cool0;
				fa = fire_a + sa * (1.0 - fire_a);
				fc = (texture(ramp_flame, vec2(heat, 0.5)).rgb * fire_a + sc * sa * (1.0 - fire_a)) / max(fa, 0.0001);
			}
			acc = fc * fa + acc * (1.0 - fa);
			aa = fa + aa * (1.0 - fa);
		}
		if (aa < 0.004) { discard; }
		col = acc / aa; a = aa;
`;

export const REMOTE_GD = `
var _remote_cores: Array = []

func _remote_active() -> bool:
	return kind >= 12 and kind <= 17 and flight_path != "sprite"

func _remote_interval() -> int:
	return mini(flight_interval, maxi(0, int((64 - charge_frames - travel_frames - impact_frames) / maxi(1, flight_count - 1))))

func _remote_duration() -> int:
	return charge_frames + travel_frames + impact_frames + (flight_count - 1) * _remote_interval()

func _remote_progress(u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	match flight_ease:
		"in": return u * u
		"out": return 1.0 - (1.0 - u) * (1.0 - u)
		"smooth": return u * u * (3.0 - 2.0 * u)
	return u

func _remote_path(u: float, index := 0) -> Vector2:
	u = clampf(u, 0.0, 1.0)
	if flight_path == "sprite": return Vector2(_w * 0.62, _h * 0.5)
	var scale0 := minf(_w, _h) / 100.0
	var a := flight_start * Vector2(_w, _h) / 100.0
	var b := flight_end * Vector2(_w, _h) / 100.0
	var d := b - a
	var length0 := maxf(1.0, d.length())
	var nv := Vector2(d.y, -d.x) / length0
	var fan := (index - (flight_count - 1) / 2.0) * flight_spread * scale0
	var p := a.lerp(b, u)
	var offset := 0.0
	match flight_path:
		"custom":
			var cp := flight_control * Vector2(_w, _h) / 100.0
			p = a * pow(1.0 - u, 2.0) + cp * (2.0 * (1.0 - u) * u) + b * u * u
		"arc": offset = sin(PI * u) * path_bend * scale0
		"wave": offset = sin(u * TAU * path_turns) * sin(PI * u) * path_wave * scale0
		"spiral":
			var angle := u * TAU * path_turns
			var r := sin(PI * u) * (1.0 - u * 0.65) * path_wave * scale0
			offset = sin(angle) * r
			p += d / length0 * cos(angle) * r * 0.45
	return p + nv * (offset + fan * u)

func _remote_arc(u: float, index: int) -> float:
	u = clampf(u, 0.0, 1.0)
	if u <= 0.0 or u >= 1.0 or flight_path == "straight" or flight_path == "sprite": return u
	var n := 24
	var lens := PackedFloat32Array([0.0])
	var prev := _remote_path(0.0, index)
	for i in n:
		var p := _remote_path(float(i + 1) / n, index)
		lens.append(lens[i] + prev.distance_to(p))
		prev = p
	var total := lens[n]
	if total < 0.0001: return u
	var target := total * u
	var i := 1
	while i < n and lens[i] < target: i += 1
	var span := maxf(0.000001, lens[i] - lens[i - 1])
	return (float(i - 1) + (target - lens[i - 1]) / span) / n

func _remote_state(frame: float, index: int) -> Dictionary:
	var time := frame - index * _remote_interval()
	var u := _remote_arc(_remote_progress((time - charge_frames) / maxf(1.0, travel_frames)), index)
	var hit := (time - charge_frames - travel_frames) / maxf(1.0, impact_frames)
	var a := _remote_path(maxf(0.0, u - 0.005), index)
	var b := _remote_path(minf(1.0, u + 0.005), index)
	return {"at": _remote_path(u, index), "angle": (b - a).angle(), "time": time, "u": u, "hit": hit, "charge": clampf(time / maxf(1.0, charge_frames), 0.0, 1.0) if charge_frames > 0 else 1.0, "body": time >= 0.0 and hit < 0.0, "born": time >= 0.0, "launched": time >= charge_frames, "finished": hit >= 1.0}

func _remote_window(frame: float, index: int) -> Vector2:
	var time := frame - index * _remote_interval()
	var span := clampf(trail_frames, 0.0, 24.0)
	var arrival := charge_frames + travel_frames
	var newest := minf(time, arrival)
	var catchup := maxf(0.0, time - arrival) * maxf(0.0, span / maxf(1.0, impact_frames) - 1.0)
	var oldest := maxf(charge_frames, time - span + catchup)
	return Vector2(oldest, newest)

func _remote_points(frame: float, index: int) -> PackedVector2Array:
	var window := _remote_window(frame, index)
	var oldest := window.x
	var newest := window.y
	var out := PackedVector2Array()
	if trail_frames <= 0.0 or newest <= oldest: return out
	var n := maxi(3, ceili((newest - oldest) * 2.0))
	for i in n + 1:
		var eased := _remote_progress((lerpf(oldest, newest, float(i) / n) - charge_frames) / maxf(1.0, travel_frames))
		out.append(_remote_path(_remote_arc(eased, index), index))
	return out

func _remote_radius() -> float:
	return minf(_w, _h) * body_size / 100.0 * size / 0.9

func _remote_color(heat: float) -> Color:
	var stops := [colors[0]] + Array(colors) + [core_color]
	var v := clampf(heat, 0.0, 1.0) * 0.999 * (stops.size() - 1)
	var i := mini(stops.size() - 2, int(floor(v)))
	return (stops[i] as Color).lerp(stops[i + 1], v - i)

func _sand_grains(r: float, quantity: float, key: int, t: float) -> Array:
	var P := Rand.new(key * 131 + 17)
	var grains := []
	for i in roundi(48.0 * maxf(0.25, minf(2.0, quantity))):
		var phase := P.next()
		var side := P.next() + P.next() - 1.0
		var reach := 1.5 + P.next() * 2.4
		var cycles := 3.0 + floorf(P.next() * 3.0)
		var width := maxf(1.1, r * (0.07 + P.next() * 0.06))
		var strength := 0.45 + P.next() * 0.5
		var flicker := P.next() * TAU
		var age := fposmod(phase + t * cycles, 1.0)
		var x := -r * (0.06 + reach * age)
		var y := r * (side * (0.07 + age * 0.35) + sin(age * 2.0 + flicker) * 0.035 * age)
		var alpha := _smooth(0.0, 0.08, age) * (1.0 - _smooth(0.22, 1.0, age)) * strength * (0.7 + sin(t * TAU * cycles * 2.0 + flicker) * 0.3)
		grains.append({"at": Vector2(x, y), "back": Vector2(x + width * (1.2 + age * 0.8), y), "width": width, "alpha": alpha, "heat": 0.5 + (1.0 - age) * 0.35})
	return grains

func _remote_body(r: float) -> void:
	_add = additive
	match kind:
		12:
			var old_r := _R
			var old_amount := amount
			_R = r * 2.1
			amount = 0.0
			_k_arrow(true)
			_remote_cores.append([_core_xf, _core_box])
			_R = old_r
			amount = old_amount
		13:
			_blob(Vector2(r * 0.12, 0), r * 0.58, [[0.0, core_color, 0.65], [0.35, core_color, 0.4], [1.0, rim_color, 0.0]])
		14:
			var Q := Rand.new((random_seed + _remote_shot * 31) * 139 + int(floor(_t * frames / 2.0)))
			_add = true
			_blob(Vector2(-r * 0.15, 0), r * 1.7, [[0.0, rim_color, 0.34], [0.45, rim_color, 0.1], [1.0, rim_color, 0.0]])
			var main := PackedVector2Array()
			for k in 8:
				var wobble := 0.0 if k == 0 or k == 7 else (Q.next() * 2.0 - 1.0) * r * 0.22
				main.append(Vector2(-r * 1.85 + r * 3.0 * float(k) / 7.0, wobble))
			_bolt(main, maxf(0.7, r * 0.075), 1.0)
			for j in 3:
				var frm := main[2 + j]
				var fork := PackedVector2Array([frm])
				var x := frm.x
				var y := frm.y
				var side := -1.0 if j == 1 else 1.0
				for k in 3:
					x -= r * (0.28 + Q.next() * 0.22)
					y += side * r * (0.18 + Q.next() * 0.28)
					fork.append(Vector2(x, y))
				_bolt(fork, maxf(0.4, r * 0.032), 0.75)
			_blob(Vector2(r * 0.95, 0), r * 0.48, [[0.0, core_color, 1.0], [0.35, core_color, 0.75], [1.0, rim_color, 0.0]])
		15:
			_remote_ice(r, random_seed + _remote_shot * 31)
		16:
			var flick := 0.5 + 0.5 * sin(_t * TAU * 3.0)
			_add = additive
			_blob(Vector2(-r * 0.15, 0), r * 1.15, [[0.0, core_color, 0.16], [0.55, rim_color, 0.05], [1.0, rim_color, 0.0]])
			var blade := PackedVector2Array()
			for k in 19:
				var a := -1.15 + float(k) / 18.0 * 2.3
				var rad := r * (0.72 + 0.28 * sin(float(k) / 18.0 * PI))
				blade.append(Vector2(cos(a) * rad * 1.25, sin(a) * rad * 0.62))
			_trail(blade, maxf(0.7, r * 0.11), 0.75 + flick * 0.2, false, rim_color, core_color)
			for j in 5:
				var y := (j - 2) * r * 0.22
				var back := r * (1.1 + (1.0 if j % 2 else 0.0) * 0.45)
				_trail(PackedVector2Array([Vector2(-back, y * 0.35), Vector2(-r * 0.15, y)]), maxf(0.35, r * 0.028), 0.28 + (0.22 if j == 2 else 0.0), true, rim_color, core_color)
		17:
			_add = additive
			for k in 4:
				var u := float(k) / 3.0
				_blob(Vector2(-r * (0.15 + u * 2.2), 0), r * (0.95 - u * 0.4), [[0.0, rim_color, 0.42 * (1.0 - u * 0.65)], [1.0, rim_color, 0.0]])
			_blob(Vector2(r * 0.08, 0), r * 0.62, [[0.0, core_color, 0.95], [0.22, rim_color, 0.6], [1.0, rim_color, 0.0]])
			for grain in _sand_grains(r, amount, random_seed + _remote_shot * 31, _t):
				if grain.alpha < 0.005: continue
				_streak(grain.back, grain.at, rim_color, _remote_color(grain.heat), grain.alpha, grain.width)

func _remote_trail(state: Dictionary, frame: float, index: int, r: float) -> Array:
	_remote_shed(state, index, r)
	var pts := _remote_points(frame, index)
	var wrapping: bool = kind == 12 and state.body
	if not wrapping and (pts.size() < 2 or trail_width <= 0.0): return []
	var strength := 1.0 - _smooth(0.0, maxf(1.0, minf(trail_frames, impact_frames)), maxf(0.0, state.time - charge_frames - travel_frames))
	var run: Array
	if wrapping:
		var scale0: float = 1.0 if state.launched else 0.45 + state.charge * 0.55
		run = _remote_arrow_sections(pts if trail_width > 0.0 else PackedVector2Array(), state.at, state.angle, r * scale0, strength)
	else:
		run = [] if kind==15 else _remote_sections(pts,r*trail_width/70.0,strength,r)
	if kind == 15:
		_remote_ice_wake(pts, r, strength, frame, index)
		return []
	if run.size() < 2: return []
	if kind == 12:
		for side in 2:
			var half := []
			for q in run: half.append({"a": q.a if side == 0 else q.b, "b": (q.a + q.b) / 2.0, "u": q.u})
			_tg_glow(half, random_seed + index * 31, int(floor(frame)), strength, 1.0, false, side)
	else:
		_remote_mesh(run, strength, frame, index)
		if kind == 14:
			_tg_top = false
			_tg_light = true
			_gmul = 1.0
			_tg_bolts(run, core_color, rim_color, random_seed + index * 31, int(floor(frame / 2.0)), strength, r * 2.6, 0.9)
	return run if wrapping else []

func _remote_impact(at0: Vector2, t: float, angle: float) -> void:
	if impact_kind == "none" or t < 0.0 or t >= 1.0: return
	var radius := minf(_w, _h) * impact_size / 100.0
	if kind == 15 and impact_kind in ["auto", "explosion"]:
		_remote_ice_hit(at0, t, angle, random_seed + _remote_shot * 31, radius)
		return
	if kind == 14 and impact_kind in ["auto", "explosion"]:
		_remote_thunder_hit(at0, t, random_seed + _remote_shot * 31, radius)
		return
	if kind == 16 and impact_kind in ["auto", "shock"]:
		_remote_wind_hit(at0, t, random_seed + _remote_shot * 31, radius)
		return
	if kind == 17 and impact_kind in ["auto", "explosion"]:
		_remote_sand_hit(at0, t, random_seed + _remote_shot * 31, radius)
		return
	var old := [_cx, _cy, _R, _t, _gy]
	_cx = at0.x; _cy = at0.y; _R = radius; _t = t; _gy = at0.y
	if impact_kind == "explosion" or (impact_kind == "auto" and kind == 13):
		_k_explosion()
	elif impact_kind == "shock": _k_shock()
	elif impact_kind == "hit" or (impact_kind == "auto" and kind == 12): _k_hit()
	else:
		var a := 1.0 - t
		var reach := radius * (1.0 - pow(1.0 - t, 2.0))
		_add = additive
		_ring(at0, maxf(0.1, reach), maxf(0.6, radius * 0.035), 0.65, rim_color, a * 0.7)
		var P := Rand.new(random_seed * 157 + 11)
		for j in int(round((60.0 if kind == 17 else 16.0) * amount)):
			var th := P.next() * TAU
			var distance := reach * (0.4 + P.next() * 0.7)
			var sz := 0.5 + P.next() * 0.7
			var p := at0 + Vector2(cos(th) * distance, sin(th) * distance * 0.8)
			if kind == 16:
				if j < 4: _swirl(at0.x, at0.y, reach * (0.65 + j * 0.1), reach * 0.4, th + t * 4.0, a * 0.6, maxf(0.6, radius * 0.025))
			else:
				var px := maxf(0.6, radius * 0.035 * sz)
				_tri_rect(Rect2(p + Vector2(0, t * t * radius * 0.4), Vector2.ONE * px), _col(_remote_color(0.3 + P.next() * 0.6), a))
		_blob(at0, radius * 0.65 * a, [[0.0, core_color, a * 0.8], [0.3, rim_color, a * 0.4], [1.0, rim_color, 0.0]])
	_cx = old[0]; _cy = old[1]; _R = old[2]; _t = old[3]; _gy = old[4]

func _k_remote() -> void:
	var r := _remote_radius()
	var frame := _t * frames
	var xf := _xf
	_remote_shot = 0
	if not _remote_active():
		_xf = xf * Transform2D(0.0, Vector2(_cx, _cy))
		_remote_body(r)
		_xf = xf
		return
	for index in flight_count:
		_remote_shot = index
		var state := _remote_state(frame, index)
		if not state.born or state.finished: continue
		var wrap := _remote_trail(state, frame, index, r)
		if kind == 15:
			var m0 := _remote_path(0.0, index)
			_ice_muzzle(m0, (_remote_path(0.01, index) - m0).angle(), r, state.time - charge_frames)
		if state.body:
			var scale0: float = 1.0 if state.launched else 0.45 + state.charge * 0.55
			_xf = xf * Transform2D(state.angle, state.at)
			var old_cx := _cx; var old_cy := _cy
			_cx = 0.0; _cy = 0.0
			_remote_body(r * scale0)
			var old_r := _R
			_R = r * scale0 * 1.5
			_accents()
			_R = old_r
			_cx = old_cx; _cy = old_cy
			_xf = xf
			if not wrap.is_empty():
				for side in 2:
					var half := []
					for q in wrap: half.append({"a": q.a if side == 0 else q.b, "b": (q.a + q.b) / 2.0, "u": q.u})
					_tg_glow(half, random_seed + index * 31, int(floor(frame)), 1.0, 0.14, true, side)
			if not state.launched:
				_add = true
				_ring(state.at, maxf(0.3, r * (2.4 - state.charge * 1.3)), maxf(0.5, r * 0.08), 0.65, rim_color, state.charge * 0.75)
		_remote_impact(_remote_path(1.0, index), state.hit, state.angle)
	_xf = xf

func _remote_wind_hit(at0: Vector2, t: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf
	var a := 1.0 - t
	var spin := t * 5.0
	_add = true
	for j in 3:
		var reach := radius * (0.28 + t * (0.75 + j * 0.16))
		_swirl(at0.x, at0.y, reach, reach * 0.58, spin + j * 1.7, a * (0.62 - j * 0.14), maxf(0.6, radius * 0.032))
	_ring(at0, maxf(0.4, t * radius * 1.15), maxf(0.6, radius * 0.04), 0.72, core_color, a * 0.75)
	var P := Rand.new(key * 157 + 11)
	for j in 8:
		var th := -0.7 + P.next() * 1.4
		var len := radius * (0.35 + t * 0.95)
		_streak(at0 + Vector2(-len * 0.25, sin(th) * len * 0.15), at0 + Vector2(cos(th) * len * 0.35, sin(th) * len * 0.7), rim_color, core_color, a * 0.55, maxf(0.5, radius * 0.02))
	_blob(at0, radius * 0.42 * maxf(0.15, a), [[0.0, core_color, a * 0.55], [1.0, rim_color, 0.0]])
	_xf = xf

func _remote_sand_hit(at0: Vector2, t: float, key: int, radius: float) -> void:
	var fade := pow(1.0 - t, 1.1)
	var wave := 1.0 - pow(1.0 - clampf(t / 0.4, 0.0, 1.0), 2.0)
	_add = true
	_blob(at0 + Vector2(0, -t * radius * 0.2), radius * (0.35 + t * 1.05), [[0.0, core_color, fade * 0.7], [0.45, rim_color, fade * 0.28], [1.0, rim_color, 0.0]])
	_ring(at0, maxf(0.5, wave * radius), maxf(0.6, radius * 0.04), 0.5, rim_color, fade * 0.6)
	var P := Rand.new(key * 157 + 11)
	for j in int(round(40.0 * maxf(0.25, minf(2.0, amount)))):
		var th := P.next() * TAU
		var speed0 := radius * (0.35 + P.next() * 1.05)
		var life := 0.5 + P.next() * 0.5
		var w := maxf(0.7, radius * (0.012 + P.next() * 0.016))
		var q := minf(1.0, t / (0.35 + P.next() * 0.2))
		var p := at0 + Vector2(cos(th) * speed0 * q, sin(th) * speed0 * q * 0.62 + radius * q * q * 0.4)
		var alpha := pow(maxf(0.0, 1.0 - t / life), 1.35) * (0.4 + P.next() * 0.55)
		_streak(p - Vector2(cos(th) * w * 4.0, sin(th) * w * 2.0), p, rim_color, _remote_color(0.75), alpha, w)
	for j in 4:
		var a := j * TAU / 4.0 + 0.4
		_remote_puff(at0 + Vector2(cos(a) * radius * t * 0.45, sin(a) * radius * t * 0.2 - t * radius * 0.1), radius * (0.18 + t * 0.35), a, rim_color, _smooth(0.0, 0.08, t) * fade * 0.28, key + j, 1.5, true)

func _remote_field(m: ShaderMaterial) -> void:
	# The attached fire body churns continuously during either flight playback mode.
	m.set_shader_parameter("loop_on", true)
	var ea := []
	var eb := []
	for index in flight_count:
		var state := _remote_state(_t * frames, index)
		if not state.born or state.finished: continue
		if state.body and kind == 13:
			var scale0: float = 1.0 if state.launched else 0.45 + state.charge * 0.55
			ea.append(Vector4(state.at.x, state.at.y, _remote_radius() * scale0, state.angle))
			eb.append(Vector4(0, 0, 0, 0))
		if state.hit >= 0.0 and state.hit < 1.0 and kind not in [14, 15] and (impact_kind == "explosion" or (impact_kind == "auto" and kind == 13)):
			var p := _remote_path(1.0, index)
			ea.append(Vector4(p.x, p.y, minf(_w, _h) * impact_size / 100.0, 0))
			eb.append(Vector4(1, 0, state.hit, 0))
	if ea.is_empty(): return
	var count := ea.size()
	while ea.size() < 240: ea.append(Vector4.ZERO)
	while eb.size() < 240: eb.append(Vector4.ZERO)
	m.set_shader_parameter("mode", 9)
	m.set_shader_parameter("ne", count)
	m.set_shader_parameter("ea", PackedVector4Array(ea))
	m.set_shader_parameter("eb", PackedVector4Array(eb))
	_field_quad(0, 0, _w, _h)
`;
