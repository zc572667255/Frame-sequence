// Godot counterpart of vfx/kinds/fireball.js, using the exporter's existing
// seeded loop noise, palette ramps, field pass and particle drawing helpers.
export const FIREBALL_FIELD = `
	} else if (mode == 8) {
		vec2 p = (UV - vec2(cx, cy)) / rs;
		float u = p.x;
		float v = p.y;
		float sa = clamp((-u - 0.3) / 5.0, 0.0, 1.0);
		float sn = loopn(vec2(v * 0.7 - 4.0, u * 0.65 + 3.0), 101, 1.75, 0.7, 5.0);
		float centre = -sa * 0.65 + (sn - 0.5) * 0.45;
		float sd = 1.0 - abs(v - centre) / (0.4 + sa * 0.85) + (sn - 0.5) * 1.1;
		float smoke_a = u > -0.3 ? 0.0 : sm(0.0, 0.55, sd) * sm(0.0, 0.22, sa) * (1.0 - sm(0.45, 1.0, sa)) * 0.3 * fade * min(1.5, amt);
		vec3 smoke_c = mix(smoke_lo.rgb, smoke_hi.rgb, clamp(0.5 - v * 0.25 + (sn - 0.5) * 0.5, 0.0, 1.0));
		float age = clamp(-u / 5.0, 0.0, 1.0);
		float bend = (loopn(vec2(v, u), 109, 1.1, 1.0, 3.0) - 0.5) * (0.16 + age * 0.9);
		float n = loopn(vec2(v + bend, u), 101, 1.75, 0.7, 5.0);
		float f = loopn(vec2(v + n * 0.2, u), 107, 4.4, 0.65, 9.0);
		float back = clamp(-u / 1.5, 0.0, 1.0);
		float body = 1.0 - length(vec2(u / (u < 0.0 ? 1.7 : 1.0), v + bend)) + (n - 0.5) * (0.5 + back * 0.55) + (f - 0.5) * 0.2;
		float width = max(0.04, 0.76 * pow(1.0 - age, 0.65));
		float wake = u < 0.0 ? (1.0 - abs(v + bend) / width + (n - 0.5) * (1.15 + age) + (f - 0.5) * 0.45) * (1.0 - sm(0.65, 1.0, age)) : -1.0;
		float d = max(body, wake * 0.62);
		float heat = clamp(0.13 + d * 0.66 + (f - 0.5) * 0.25 - age * 0.24, 0.0, 1.0);
		float fire_a = u < -5.0 ? 0.0 : sm(-0.04, 0.22, d) * (1.0 - sm(0.7, 1.0, age)) * fade;
		vec3 fire_c = texture(ramp_flame, vec2(heat, 0.5)).rgb;
		a = fire_a + smoke_a * (1.0 - fire_a);
		if (a < 0.004) { discard; }
		col = (fire_c * fire_a + smoke_c * smoke_a * (1.0 - fire_a)) / a;
`;

export const FIREBALL_GD = `
# 火球：与浏览器相同的火焰体积、烟、余烬和飞行节奏。
func _fireball_layout() -> Dictionary:
	var fly := 0.0 if loop else _smooth(0.0, 0.78, _t)
	return {"r": _R * 0.29, "x": _cx + _R * 0.47 if loop else _cx - _R * 1.4 + _R * 3.05 * fly, "y": _cy, "life": 1.0 if loop else 1.0 - _smooth(0.72, 1.0, _t)}

func _fireball_field(m: ShaderMaterial) -> void:
	var L := _fireball_layout()
	var r: float = L.r
	if r < 0.1 or L.life <= 0.0:
		return
	m.set_shader_parameter("mode", 8)
	m.set_shader_parameter("cx", L.x)
	m.set_shader_parameter("cy", L.y)
	m.set_shader_parameter("rs", r)
	m.set_shader_parameter("fade", L.life)
	m.set_shader_parameter("amt", amount)
	m.set_shader_parameter("smoke_hi", colors[0].lerp(Color8(58, 56, 60), 0.75).lerp(Color8(118, 99, 91), 0.4))
	_field_quad(L.x - r * 5.7, L.y - r * 2.1, L.x + r * 1.55, L.y + r * 1.8)

func _k_fireball() -> void:
	var L := _fireball_layout()
	var r: float = L.r
	var head: float = L.x
	var mid: float = L.y
	var life: float = L.life
	if r < 0.1 or life <= 0.0:
		return
	_over = true
	_add = additive
	_blob(Vector2(head + r * 0.12, mid), r * 0.58, [[0.0, core_color, 0.65 * life], [0.35, core_color, 0.4 * life], [1.0, rim_color, 0.0]])
	var P := Rand.new(random_seed * 127 + 9)
	for k in int(round(26.0 * amount)):
		var ph := P.next()
		var side := P.next() * 2.0 - 1.0
		var sp := 1.0 + floorf(P.next() * 2.0)
		var sz := 0.6 + P.next() * 0.8
		var age := fposmod(ph + _t * sp, 1.0)
		var x := head - r * 0.45 - age * _R * 1.45
		var y := mid + side * r * (0.5 + age * 2.2) - age * age * r * 0.4
		var a := sin(PI * age) * (1.0 - age) * life
		var stops := [colors[0]] + Array(colors) + [core_color]
		var heat := clampf(0.9 - age * 0.65, 0.0, 1.0) * 0.999 * (stops.size() - 1)
		var ci := mini(stops.size() - 2, int(floor(heat)))
		var c: Color = (stops[ci] as Color).lerp(stops[ci + 1], heat - ci)
		var start := Vector2(x + r * (0.1 + age * 0.24), y - side * r * 0.06)
		var end := Vector2(x, y)
		_line(PackedVector2Array([start, start.lerp(end, 0.6), end]), PackedColorArray([_col(rim_color, 0.0), _col(rim_color, 0.7 * a), _col(c, a)]), maxf(0.6, r * 0.055 * sz))
	_over = false
`;
