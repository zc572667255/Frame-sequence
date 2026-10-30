// Native counterpart of vfx/remotetrail.js: a strip mesh with continuous UVs,
// and procedural puff quads. No animation frames are baked into the export.
export const REMOTE_TRAIL_SHADER = `
shader_type canvas_item;
render_mode unshaded, blend_mix;
uniform int seed = 1;
uniform int kind = 13;
uniform float frame = 0.0;
uniform bool puff_pass = false;
uniform vec3 crystal_rim = vec3(0.37, 0.84, 1.0);
uniform vec3 cols[8];
uniform int ncols = 6;
float lh(int x, int y, int s) {
  uint v = (uint(x) * 374761393u) ^ (uint(y) * 668265263u) ^ uint(s);
  v = (v ^ (v >> 13u)) * 1274126177u;
  return float(v ^ (v >> 16u)) / 4294967295.0;
}
float one(vec2 p, int s) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  int x = int(i.x), y = int(i.y);
  return mix(mix(lh(x, y, s), lh(x + 1, y, s), f.x), mix(lh(x, y + 1, s), lh(x + 1, y + 1, s), f.x), f.y);
}
float fbm(vec2 p, int s) {
  return one(p, s) * 0.55 + one(p * 2.1 + vec2(17.3, 3.1), s) * 0.3 + one(p * 4.3 + vec2(7.7, 29.5), s) * 0.15;
}
vec3 across(float u) {
  float t = clamp(u, 0.0, 1.0) * float(ncols - 1);
  int i = min(ncols - 2, int(floor(t)));
  return mix(cols[i], cols[i + 1], t - float(i));
}
void fragment() {
  if (puff_pass && UV.x < 0.0) {
    int key = int(floor(-UV.x / 2.0)) - 1;
    vec2 p = vec2(-UV.x - float(key + 1) * 2.0, UV.y);
    int s = key * 53 + 211;
    float coarse = fbm(p * 6.0, s);
    float fine = fbm(vec2(p.x * 18.0 + coarse * 2.0, p.y * 18.0), s);
    float ridge = pow(max(0.0, 1.0 - abs(coarse - 0.5) * 6.0), 8.0);
    float grain = smoothstep(0.5, 0.72, fine);
    float frost = clamp(ridge * 0.75 + grain * 0.4, 0.0, 1.0);
    COLOR = vec4(mix(crystal_rim, cols[ncols - 1], 0.15 + frost * 0.7), COLOR.a * (0.06 + frost * 0.6));
  } else if (puff_pass) {
    int key = int(floor(UV.x / 2.0));
    vec2 p = (vec2(UV.x - float(key) * 2.0, UV.y) * 64.0 - vec2(32.0)) / 30.0;
    int s = key * 19 + 43;
    float f = fbm(p * 3.0, s), n = fbm(p * 7.0 + vec2(7.0, 0.0), s);
    float density = 1.0 - length(p) + (f - 0.5) * 0.8;
    COLOR.a *= smoothstep(0.0, 0.5, density) * (0.4 + n * 0.6);
  } else {
    int shot_seed = seed + int(round(COLOR.r * 8.0)) * 31;
    int ns = shot_seed * 13 + 7, fs = shot_seed * 29 + 11;
    float u = UV.x, v = UV.y, d = abs(v * 2.0 - 1.0), t = frame * 0.17;
    float warp = fbm(vec2(u * 4.0 - t * 0.35, v * 3.0), ns);
    float n = fbm(vec2(u * 9.0 + t + (warp - 0.5) * 2.4, v * 4.0 - t * 0.22), ns);
    float f = fbm(vec2(u * 23.0 + t * 1.8, v * 9.0 + warp * 1.5), fs);
    float end = smoothstep(0.0, 0.18, u), heat, alpha;
    if (kind == 13) {
      float birth = COLOR.b * 64.0 + u * COLOR.a * 24.0;
      float phase = birth * 0.42 + frame * 0.1;
      n = fbm(vec2(phase, v * 4.2), ns);
      f = fbm(vec2(phase * 0.85, v * 9.0 + (n - 0.5) * 0.7), fs);
      float folds = (n - 0.5) * 1.65 + (f - 0.5) * 0.55;
      float density = (1.0 - d) * (0.72 + u * 0.35) - 0.28 - (1.0 - u) * 0.16 + folds;
      heat = clamp(0.12 + density * 0.7 + (f - 0.5) * 0.22 + u * 0.14, 0.0, 1.0);
      alpha = smoothstep(-0.06, 0.24, density) * (1.0 - smoothstep(0.82, 1.0, d)) * smoothstep(0.0, 0.2, u) * (0.45 + u * 0.55);
    } else if (kind == 17) {
      float birth = COLOR.b * 64.0 + u * COLOR.a * 24.0;
      float phase = birth * 1.7 + frame * 0.06;
      float weave = sin(birth * 0.7 + frame * 0.05) * 0.07;
      float lane = exp(-pow((v - 0.5 - weave) / 0.075, 2.0)) + 0.4 * exp(-pow((v - 0.28 + weave) / 0.055, 2.0)) + 0.3 * exp(-pow((v - 0.72 + weave) / 0.06, 2.0));
      float grains = smoothstep(0.54 - u * 0.16, 0.72 - u * 0.12, fbm(vec2(phase * 8.0, v * 29.0), fs));
      float feather = (1.0 - smoothstep(0.55, 1.0, d)) * pow(smoothstep(0.0, 0.4, u), 1.2) * (0.08 + 0.92 * u);
      heat = 0.45 + grains * 0.5;
      alpha = (lane * grains * 0.88 + pow(1.0 - d, 3.0) * 0.045) * feather;
    } else if (kind == 14) {
      heat = 0.35 + n * 0.4;
      alpha = pow(1.0 - d, 3.0) * end * (0.12 + f * 0.08);
    } else {
      float curl = (n - 0.5) * (0.7 + (1.0 - u) * 0.5);
      float billow = max(0.0, 1.0 - abs(v * 2.0 - 1.0 + curl));
      float thread = pow(max(0.0, sin((v * 4.0 + warp * 0.65 + u * 0.4) * 6.283185307)), 18.0);
      float mist = pow(billow, 1.8) * smoothstep(0.2, 0.8, f) * (kind == 16 ? 0.6 : 0.22);
      heat = 0.62 + f * 0.35;
      alpha = (mist + thread * billow * (kind == 16 ? 0.18 : 0.28)) * end * (0.35 + u * 0.65);
    }
    COLOR = vec4(across(heat), alpha * COLOR.g);
  }
}
`;

export const REMOTE_TRAIL_GD = `
var _rm := [{}, {}, {}] # ribbon, shed puffs, body puffs / shard frost
var _remote_shot := 0
var _remote_clip: Array = []

# Convex path cells clip the shared preset's crystals, snow and halos. Only
# the active ice wake is clipped; body facets and impact debris draw normally.
func _remote_set_clip(run: Array) -> void:
	_remote_clip.clear()
	for i in range(1, run.size()):
		var poly := PackedVector2Array([run[i - 1].a, run[i - 1].b, run[i].b, run[i].a])
		var area := 0.0
		var bounds := Rect2(poly[0], Vector2.ZERO)
		for k in 4:
			area += poly[k].cross(poly[(k + 1) % 4])
			bounds = bounds.expand(poly[k])
		if area > 0.000001: _remote_clip.append({"poly": poly, "bounds": bounds})

func _remote_clip_tri(idx: PackedInt32Array, pts: PackedVector2Array, cols: PackedColorArray) -> void:
	var out_i := PackedInt32Array()
	var out_p := PackedVector2Array()
	var out_c := PackedColorArray()
	for i in range(0, idx.size(), 3):
		var triangle := []
		var bounds := Rect2(pts[idx[i]], Vector2.ZERO)
		for k in 3:
			var n := idx[i + k]
			triangle.append({"p": pts[n], "c": cols[n] if cols.size() == pts.size() else cols[0]})
			bounds = bounds.expand(pts[n])
		for cell in _remote_clip:
			if not bounds.intersects(cell.bounds): continue
			var poly: Array = triangle
			for k in 4:
				if poly.size() < 3: break
				var from: Vector2 = cell.poly[k]
				var edge: Vector2 = cell.poly[(k + 1) % 4] - from
				var next := []
				var previous: Dictionary = poly[-1]
				var dp := edge.cross((previous.p as Vector2) - from)
				for current in poly:
					var dc := edge.cross((current.p as Vector2) - from)
					if (dp >= 0.0) != (dc >= 0.0):
						var t := clampf(dp / (dp - dc), 0.0, 1.0)
						next.append({"p": (previous.p as Vector2).lerp(current.p, t), "c": (previous.c as Color).lerp(current.c, t)})
					if dc >= 0.0: next.append(current)
					previous = current; dp = dc
				poly = next
			if poly.size() < 3: continue
			var base := out_p.size()
			for v in poly:
				out_p.append(v.p); out_c.append(v.c)
			for k in range(1, poly.size() - 1): out_i.append_array(PackedInt32Array([base, base + k, base + k + 1]))
	if out_i.is_empty(): return
	var saved := _remote_clip
	_remote_clip = []
	# Clipped frost is behind the opaque ice facets, including its additive
	# particles. Sharing the foreground light batch washes out the cone root.
	var saved_under := _under
	_under = true
	_tri(out_i, out_p, out_c)
	_under = saved_under
	_remote_clip = saved

func _remote_head_profile(q: float) -> float:
	var p := 1.0 + 3.0 * clampf(head_curve, 0.0, 100.0) / 100.0
	return pow(maxf(0.0, 1.0 - pow(clampf(q, 0.0, 1.0), p)), 1.0 / p)

func _remote_arrow_sections(points: PackedVector2Array, at0: Vector2, angle: float, r: float, strength: float) -> Array:
	var d := Vector2.from_angle(angle)
	var nv := Vector2(-d.y, d.x)
	var R := r * 2.1
	var left := core_envelope.position.x * R + (0.0 if core_round else core_length * R / 2.0) + core_shift * R
	var right := left + core_envelope.size.x * R
	var back := left - r * 0.4
	var peak := maxf(r * 0.38, maxf(absf(core_envelope.position.y), absf(core_envelope.end.y)) * R + r * 0.12) * head_width / 100.0
	var front := right + maxf(r * 0.65, peak * 0.65)
	var tail_width := r * 0.35 * trail_width / 70.0
	var cut := -1
	for i in points.size():
		if (points[i] - at0).dot(d) < back: cut = i
	var history := points.slice(0, cut + 1) if cut >= 0 else PackedVector2Array()
	if history.is_empty(): history.append(at0 + d * (back - r * 2.0))
	history.append(at0 + d * back)
	var sections := []
	var centres := PackedVector2Array()
	var join_width := peak * 0.95
	for i in history.size():
		var delta := history[mini(history.size() - 1, i + 1)] - history[maxi(0, i - 1)]
		var side := nv if i == history.size() - 1 else Vector2(-delta.y, delta.x) / maxf(0.0001, delta.length())
		var t := float(i) / (history.size() - 1)
		var blend := clampf((t - 0.6) / 0.4, 0.0, 1.0)
		var k := blend * blend * (3.0 - 2.0 * blend)
		var half := (tail_width * pow(t, 0.65) * (1.0 - k) + join_width * k) * sqrt(strength)
		centres.append(history[i])
		sections.append({"a": history[i] + side * half, "b": history[i] - side * half, "u": 0.0})
	for i in range(1, 33):
		var k := i / 16.0 if i <= 16 else (i - 16) / 16.0
		var x := back + (right - back) * k if i <= 16 else right + (front - right) * k
		var half := (join_width + (peak - join_width) * k * k * (3.0 - 2.0 * k) if i <= 16 else peak * _remote_head_profile(k)) * sqrt(strength)
		var p := at0 + d * x
		centres.append(p)
		sections.append({"a": p + nv * half, "b": p - nv * half, "u": 0.0})
	var length0 := 0.0
	for i in range(1, sections.size()):
		length0 += centres[i].distance_to(centres[i - 1])
		sections[i].u = length0
	for q in sections: q.u /= maxf(0.001, length0)
	return sections

func _remote_sections(points: PackedVector2Array, r: float, strength: float, head_radius := -1.0) -> Array:
	var pts := PackedVector2Array()
	for p in points:
		if pts.is_empty() or p.distance_to(pts[-1]) > 0.01: pts.append(p)
	if pts.size() < 2: return []
	var lengths := PackedFloat32Array([0.0])
	for i in range(1, pts.size()): lengths.append(lengths[-1] + pts[i].distance_to(pts[i - 1]))
	var length0 := lengths[-1]
	var width := 0.48 if kind == 17 else (0.85 if kind == 15 else (1.45 if kind == 16 else (0.7 if kind == 12 else (1.4 if kind == 13 else 1.3))))
	var normals := PackedVector2Array()
	var halves := PackedFloat32Array()
	for i in pts.size():
		var d := pts[mini(pts.size() - 1, i + 1)] - pts[maxi(0, i - 1)]
		if kind in [13, 15] and i > 0 and i < pts.size() - 1:
			d = (pts[i] - pts[i - 1]).normalized() + (pts[i + 1] - pts[i]).normalized()
			if d.length() < 0.000001: d = pts[i + 1] - pts[i]
		var nv := Vector2(-d.y, d.x) / maxf(0.0001, d.length())
		var u := lengths[i] / length0
		var half := r * width * pow(u, 0.7 if kind == 17 else (0.58 if kind == 13 else 0.55)) * sqrt(strength) * (1.0 if kind == 15 else minf(1.0, length0 / maxf(1.0, r * 2.0)))
		normals.append(nv)
		halves.append(half)
	if kind == 13:
		if head_radius < 0.0: head_radius = r
		for i in pts.size():
			var join := _smooth(0.6, 1.0, lengths[i] / length0)
			var neck := minf(halves[i], head_radius * 0.85 * sqrt(strength))
			halves[i] = lerpf(halves[i], neck, join)
	if kind in [13, 15]:
		for i in range(1, pts.size()):
			var a := normals[i - 1]
			var b := normals[i]
			var d := pts[i] - pts[i - 1]
			var turn := absf(a.cross(b))
			var forward := minf(d.cross(a), d.cross(b))
			var cap := 0.0 if forward <= 0.000001 or a.dot(b) < 0.0 else (forward / turn * 0.65 if turn > 0.000001 else INF)
			halves[i - 1] = minf(halves[i - 1], cap)
			halves[i] = minf(halves[i], cap)
	var out := []
	for i in pts.size():
		out.append({"a": pts[i] + normals[i] * halves[i], "b": pts[i] - normals[i] * halves[i], "u": float(i) / (pts.size() - 1) if kind == 13 else lengths[i] / length0})
	return out

func _remote_quad(slot: int, points: Array, uvs: Array, color: Color, fan := false) -> void:
	if _rm[slot].is_empty():
		_rm[slot] = {"idx": PackedInt32Array(), "pts": PackedVector2Array(), "uvs": PackedVector2Array(), "cols": PackedColorArray()}
	var f: Dictionary = _rm[slot]
	var b: int = f.pts.size()
	for p in points: f.pts.append(_xf * (p as Vector2))
	for uv in uvs: f.uvs.append(uv)
	if fan:
		f.pts.append(_xf * ((points[0] + points[1] + points[2] + points[3]) / 4.0))
		f.uvs.append((uvs[0] + uvs[1] + uvs[2] + uvs[3]) / 4.0)
		for i in 5: f.cols.append(color)
		for i in 4: f.idx.append_array(PackedInt32Array([b + i, b + (i + 1) % 4, b + 4]))
	else:
		for i in 4: f.cols.append(color)
		f.idx.append_array(PackedInt32Array([b, b + 1, b + 2, b, b + 2, b + 3]))

func _remote_cell_at(p: Dictionary, q: Dictionary, s: float, v: float) -> Vector2:
	return p.a.lerp(p.b, v).lerp(q.a.lerp(q.b, v), s)

func _remote_mesh(run: Array, strength: float, frame: float, index: int) -> void:
	var window := _remote_window(frame, index)
	var color := Color(_remote_shot / 8.0, strength, window.x / 64.0, (window.y - window.x) / 24.0) if kind in [13, 17] else Color(_remote_shot / 8.0, strength, 1.0, 1.0)
	for i in range(1, run.size()):
		var p: Dictionary = run[i - 1]
		var q: Dictionary = run[i]
		if kind in [13, 17]:
			for j in 2:
				for k in 4:
					var s0 := j / 2.0
					var s1 := (j + 1) / 2.0
					var v0 := k / 4.0
					var v1 := (k + 1) / 4.0
					var u0 := lerpf(p.u, q.u, s0)
					var u1 := lerpf(p.u, q.u, s1)
					_remote_quad(0, [_remote_cell_at(p, q, s0, v0), _remote_cell_at(p, q, s0, v1), _remote_cell_at(p, q, s1, v1), _remote_cell_at(p, q, s1, v0)], [Vector2(u0, v0), Vector2(u0, v1), Vector2(u1, v1), Vector2(u1, v0)], color, true)
		else:
			_remote_quad(0, [p.a, p.b, q.b, q.a], [Vector2(p.u, 0), Vector2(p.u, 1), Vector2(q.u, 1), Vector2(q.u, 0)], color)

func _remote_puff(at0: Vector2, r: float, angle: float, color: Color, alpha: float, key: int, stretch := 1.0, body := false) -> void:
	var xf := Transform2D(angle, at0)
	var points := []
	for p in [Vector2(-r * stretch, -r), Vector2(r * stretch, -r), Vector2(r * stretch, r), Vector2(-r * stretch, r)]: points.append(xf * p)
	var u := float(absi(key) % 7) * 2.0
	_remote_quad(2 if body else 1, points, [Vector2(u, 0), Vector2(u + 1, 0), Vector2(u + 1, 1), Vector2(u, 1)], _col(color, alpha))

func _remote_draw_mesh(cv: CanvasItem, slot: int) -> void:
	var f: Dictionary = _rm[slot]
	if f.is_empty(): return
	var m := cv.material as ShaderMaterial
	m.set_shader_parameter("seed", random_seed)
	m.set_shader_parameter("kind", kind)
	m.set_shader_parameter("frame", _t * frames)
	m.set_shader_parameter("puff_pass", slot > 0)
	m.set_shader_parameter("crystal_rim", Vector3(rim_color.r, rim_color.g, rim_color.b))
	var stops := [colors[0]] + Array(colors) + [core_color]
	var cols := PackedVector3Array()
	for i in 8:
		var c: Color = stops[mini(i, stops.size() - 1)]
		cols.append(Vector3(c.r, c.g, c.b))
	m.set_shader_parameter("cols", cols)
	m.set_shader_parameter("ncols", mini(8, stops.size()))
	RenderingServer.canvas_item_add_triangle_array(cv.get_canvas_item(), f.idx, f.pts, f.cols, f.uvs)

# The 冰晶 preset's trail particles, placed the same way as glow/fx.js.
func _remote_frost_at(r: Array, u: float, v: float) -> Vector2:
	var i := 1
	while i < r.size() - 1 and r[i].u < u: i += 1
	return _tg_at(r[i], v)

func _remote_frost_fx(r: Array, key: int, frame: int, alpha: float, max_w: float, cols: Array, look: Dictionary) -> void:
	_tg_light = true
	_tg_flags()
	var P := Rand.new(key * 7 + frame * 131)
	var star_size := maxf(1.0, float(look.sparkleSize) * 100.0) * maxf(0.6, max_w / 40.0)
	for k in clampi(roundi(float(look.sparkles) * 100.0), 0, 80):
		var u := 0.35 + 0.65 * pow(P.next(), 0.7)
		var v := -0.3 + 1.6 * P.next()
		var tw := pow(P.next(), 1.4) * alpha
		var sz := star_size * (0.4 + 0.9 * P.next()) * (0.6 + 0.6 * tw)
		if tw < 0.08: continue
		_star(_remote_frost_at(r, u, v), sz, _tg_across(cols, clampf(v, 0.0, 1.0)), tw, P.next() * 0.4)
	var D := Rand.new(key * 91 + 3)
	var Dt := Rand.new(key * 17 + frame * 389)
	var unit := maxf(0.6, max_w / 90.0)
	for k in roundi(float(look.dust) * 140.0):
		var u := pow(D.next(), 0.6)
		var v := 1.05 - pow(D.next(), 0.8) * 1.35
		var sz := unit * (0.5 + 1.6 * pow(D.next(), 3.0))
		var tw := (0.3 + 0.7 * Dt.next()) * alpha
		var c := _tg_across(cols, clampf(v + 0.3, 0.0, 1.0))
		c = Color(roundf((c.r + (1.0 - c.r) * 0.5) * 255.0) / 255.0, roundf((c.g + (1.0 - c.g) * 0.5) * 255.0) / 255.0, roundf((c.b + (1.0 - c.b) * 0.5) * 255.0) / 255.0)
		_blob(_remote_frost_at(r, u, v), sz, [[0.0, c, tw * (0.4 + 0.6 * u)], [1.0, c, tw * (0.4 + 0.6 * u)]])
	var S := Rand.new(key * 149 + 5)
	var St := Rand.new(key * 151 + frame * 263)
	for k in roundi(float(look.snow) * 26.0):
		var u := 0.15 + 0.85 * pow(S.next(), 0.7)
		var v := -0.35 + 1.6 * S.next()
		var sz := max_w * (0.05 + 0.08 * pow(S.next(), 2.0))
		var spin := S.next() * PI
		spin += frame * (S.next() - 0.5) * 0.3
		var tw := (0.35 + 0.65 * St.next()) * alpha * (0.4 + 0.6 * u)
		var p := _remote_frost_at(r, u, v)
		if tw < 0.06: continue
		_blob(p, sz * 1.2, [[0.0, rim_color, 0.35 * tw], [1.0, rim_color, 0.0]])
		var col := _col(core_color, 0.9 * tw)
		var lw := maxf(0.5, sz / 9.0)
		for arm in 6:
			var th := spin + arm * PI / 3.0
			var d := Vector2.from_angle(th)
			_seg(p, p + d * sz, col, lw)
			for br in [[0.45, 0.32], [0.7, 0.22]]:
				var bp: Vector2 = p + d * sz * br[0]
				for sign0 in [1.0, -1.0]:
					var bt: float = th + sign0 * PI / 3.0
					_seg(bp, bp + Vector2.from_angle(bt) * sz * float(br[1]), col, lw)

func _remote_shed(state: Dictionary, index: int, r: float) -> void:
	if kind == 15 or amount <= 0.0 or trail_frames <= 0.0 or trail_width <= 0.0: return
	var life := minf(12.0, maxf(4.0, trail_frames))
	var post_fade := 1.0 - _smooth(0.0, minf(life, impact_frames), maxf(0.0, state.time - charge_frames - travel_frames))
	var rate := maxf(0.25, minf(3.0, amount * (2.0 if kind == 17 else 1.5)))
	var oldest := maxf(charge_frames, state.time - life)
	var newest := minf(state.time, charge_frames + travel_frames)
	for j in range(ceili(oldest * rate), floori(newest * rate) + 1):
		var P := Rand.new((random_seed + index * 31) * 179 + j * 541 + index * 31)
		var born := j / rate
		var age: float = state.time - born
		var span := life * (0.6 + P.next() * 0.4)
		if age < 0.0 or age >= span: continue
		var u := _remote_progress((born - charge_frames) / maxf(1.0, travel_frames))
		var p := _remote_path(u, index)
		var q := _remote_path(minf(1.0, u + 0.005), index)
		var angle := (q - p).angle()
		var side := P.next() * 2.0 - 1.0
		var f := age / span
		var v := Vector2(-cos(angle) * r * 0.06 - sin(angle) * side * r * 0.13, -sin(angle) * r * 0.06 + cos(angle) * side * r * 0.13 - r * 0.035)
		var at0 := p + Vector2(-sin(angle), cos(angle)) * side * r * 0.6 + v * age
		if kind in [13, 16] and j % 3 == 0:
			var smoke := kind == 13
			var tone := colors[0].lerp(Color8(58, 56, 60), 0.75) if smoke else rim_color
			var puff_angle := P.next() * TAU + f
			_remote_puff(at0 - Vector2(0, age * r * 0.04 if smoke else 0.0), r * (0.4 + f * 0.85), puff_angle, tone, _smooth(0.0, 0.15, f) * pow(1.0 - f, 1.5) * (0.28 if smoke else 0.2) * post_fade, j, 1.3)
		_add = additive
		var alpha := pow(1.0 - f, 1.6) * (0.3 + P.next() * 0.6) * post_fade
		var tone := _remote_color(0.85 - f * 0.4)
		if kind == 13 or kind == 17:
			var width := maxf(0.5, r * 0.055 * (0.5 + P.next()))
			_streak(at0 + v * 1.5, at0, tone, tone, alpha, width)
`;
