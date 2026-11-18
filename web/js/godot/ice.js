// 冰矛 as a cel-shaded ice lance, drawn the same way as vfx/kinds/ice.js: a
// faceted crystal in flat tones (lit top face, mid tone, shadowed underside,
// a highlight sliver, a thin dark outline) and a few white speed lines
// behind it that follow the path; the chips it sheds are in remotetrail.js.
// No glow: all solid colour on the normal layer.
export const ICE_GD = `
# 颜色都取自配色：高光接近核心色，亮面、中间色、暗面在配色的第二个颜色和核心色 / 最深的颜色之间，
# 稍微降一点饱和度（赛璐璐的暗面不鲜艳），描边更深
func _ice_grey(c: Color, k: float) -> Color:
	var l := 0.299 * c.r + 0.587 * c.g + 0.114 * c.b
	return Color(c.r + (l - c.r) * k, c.g + (l - c.g) * k, c.b + (l - c.b) * k)

func _ice_tones() -> Dictionary:
	var blue: Color = colors[1] if colors.size() > 1 else rim_color
	var dark: Color = colors[0]
	return {
		"hi": core_color.lerp(blue.lerp(core_color, 0.85), 0.5),
		"light": _ice_grey(blue.lerp(core_color, 0.72), 0.25),
		"mid": _ice_grey(blue.lerp(dark, 0.15), 0.3),
		"shade": _ice_grey(blue.lerp(dark, 0.6), 0.35),
		"deep": _ice_grey(dark, 0.3).lerp(Color8(16, 20, 34), 0.5),
	}

# 每一遍（循环）闪几次：大约 8 帧一次
func _ice_cycles() -> int:
	return maxi(1, roundi(frames / 8.0))

# 路径从最老的点到头部，从头部往回量；d < 0 在头部前面、d > 全长在最老的点后面，都沿直线延长
func _ice_along(pts: PackedVector2Array) -> Dictionary:
	var rev := pts.duplicate()
	rev.reverse()
	var ds := PackedFloat32Array([0.0])
	for i in range(1, rev.size()):
		ds.append(ds[i - 1] + rev[i].distance_to(rev[i - 1]))
	return {"rev": rev, "ds": ds, "len": ds[ds.size() - 1]}

# 往回 d 处、沿法线偏 off 的位置
func _ice_place(path: Dictionary, d: float, off: float) -> Vector2:
	var rev: PackedVector2Array = path.rev
	var ds: PackedFloat32Array = path.ds
	var len0: float = path.len
	var ahead := minf(0.0, d) + maxf(0.0, d - len0)
	d = clampf(d, 0.0, len0)
	var i := 1
	while i < rev.size() - 1 and ds[i] < d: i += 1
	var a := rev[i - 1]
	var b := rev[i]
	var s := ds[i] - ds[i - 1]
	var k := (d - ds[i - 1]) / s if s > 1e-9 else 0.0
	var dir := b - a
	var l := dir.length()
	if l < 1e-9: l = 1.0
	return a + dir * k + dir / l * ahead + Vector2(-dir.y, dir.x) / l * off

# 一块菱形的冰，从 at（后端）指向 angle：[后端, 一侧, 尖, 另一侧]
func _ice_chip(at: Vector2, angle: float, len0: float, width: float) -> PackedVector2Array:
	var xf := Transform2D(angle, at)
	return PackedVector2Array([xf * Vector2.ZERO, xf * Vector2(len0 * 0.35, -width), xf * Vector2(len0, 0.0), xf * Vector2(len0 * 0.35, width)])

# 菱形（屏幕坐标）画成一块冰晶：沿长边分两半，朝上的一半亮、另一半暗，亮的那半靠尖处一道高光
func _ice_crystal(d: PackedVector2Array, alpha: float) -> Dictionary:
	var back := d[0]
	var front := d[2]
	var ax := front - back
	var n := Vector2(ax.y, -ax.x)
	if n.y > 0.0: n = -n
	var up1 := (d[1] - back).dot(n) >= 0.0
	var lit: Vector2 = d[1] if up1 else d[3]
	var dim: Vector2 = d[3] if up1 else d[1]
	return {"faces": [
		[PackedVector2Array([back, lit, front]), "light"],
		[PackedVector2Array([back, front, dim]), "shade"],
		[PackedVector2Array([lit.lerp(front, 0.2), front, back.lerp(front, 0.6).lerp(lit, 0.45)]), "hi"],
	], "outline": d, "alpha": alpha}

# 四角星形的闪光：8 个点，长的光芒在横竖方向
func _ice_sparkle(p: Vector2, size0: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for k in 8:
		var l := size0 * 0.22 if k % 2 else size0
		pts.append(p + Vector2.from_angle(k * PI / 4.0) * l)
	return pts

# 一块块的冰（{faces, outline, alpha}），实色盖在上面
func _ice_pieces(pieces: Array, T: Dictionary, lw: float) -> void:
	_add = false
	for p in pieces:
		var a: float = p.alpha
		if a <= 0.005: continue
		for f in p.faces:
			_poly_fill(f[0], PackedColorArray([_col(T[f[1]], a)]))
		if p.has("outline"):
			var ring0: PackedVector2Array = (p.outline as PackedVector2Array).duplicate()
			ring0.append(ring0[0])
			_line(ring0, PackedColorArray([_col(T.deep, 0.85 * a)]), lw)

# 冰枪（它自己的坐标，x 朝前，尖在 2.6 r，尾在 -5.4 r），光从 -y 来：中间色的底、亮的上表面、
# 下沿一道暗面、上表面切出两个面、靠尖的上沿一道高光；边缘稍微不平
func _ice_lance(r: float, key: int) -> Dictionary:
	var P := Rand.new(key * 97 + 5)
	var U := PackedVector2Array()
	var L := PackedVector2Array()
	var G := PackedVector2Array()
	for q in [[1.3, -0.34], [0.1, -0.5], [-1.3, -0.42], [-1.7, -0.27], [-2.0, -0.42], [-3.3, -0.29], [-4.6, -0.11]]:
		U.append(Vector2(q[0] * r, q[1] * r * (0.88 + 0.24 * P.next())))
	for q in [[-4.4, 0.14], [-3.0, 0.34], [-1.6, 0.46], [-0.9, 0.32], [-0.4, 0.47], [1.1, 0.37]]:
		L.append(Vector2(q[0] * r, q[1] * r * (0.88 + 0.24 * P.next())))
	for q in [[1.3, -0.07], [0.1, -0.1], [-1.3, -0.08], [-3.3, -0.06], [-4.6, -0.01]]:
		G.append(Vector2(q[0] * r, q[1] * r * (0.88 + 0.24 * P.next())))
	var tip := Vector2(2.6 * r, 0.0)
	var back := Vector2(-5.4 * r, 0.02 * r)
	var outline := PackedVector2Array([tip])
	outline.append_array(U)
	outline.append(back)
	outline.append_array(L)
	var top := PackedVector2Array([tip])
	top.append_array(U)
	top.append(back)
	for i in range(G.size() - 1, -1, -1): top.append(G[i])
	var shade := PackedVector2Array([back])
	shade.append_array(L)
	shade.append(tip)
	for i in range(L.size() - 1, -1, -1): shade.append(Vector2(L[i].x + 0.15 * r, L[i].y * 0.5))
	var hi := PackedVector2Array([tip, Vector2(U[0].x, U[0].y * 0.72), Vector2(U[1].x, U[1].y * 0.72), Vector2(U[2].x + 0.3 * r, U[2].y * 0.6), Vector2(U[1].x, U[1].y * 0.45), Vector2(U[0].x, U[0].y * 0.4)])
	var faces := [
		[outline, "mid"],
		[top, "light"],
		[PackedVector2Array([U[1].lerp(U[2], 0.5), G[2], G[1]]), "mid"],
		[PackedVector2Array([U[5], G[4], G[3]]), "mid"],
		[shade, "shade"],
		[hi, "hi"],
	]
	return {"faces": faces, "outline": outline, "tip": tip}

# 冰枪身后的速度线（任意一帧都能直接算出来，首尾相接）：每条是一道细细的白色尖条，
# 从冰枪处沿拖尾往后滑，途中淡入淡出；按拖尾宽度（width）铺开
const ICE_LINES := 4
func _ice_lines(len0: float, r: float, t: float, key: int, width: float) -> Array:
	var P := Rand.new(key * 173 + 41)
	var cyc := _ice_cycles()
	var reach := maxf(r * 2.5, minf(len0, r * 12.0))
	var lines := []
	for k in ICE_LINES:
		var ph := fmod(t * cyc + P.next(), 1.0)
		var off := ((k + 0.5) / ICE_LINES - 0.5) * r * 1.1 * width + (P.next() - 0.5) * r * 0.12
		lines.append({"d": r * 3.0 + ph * (reach + r * 3.0), "off": off, "len": r * (2.0 + 2.0 * P.next()), "width": r * 0.06, "alpha": 0.75 * sin(PI * ph)})
	return lines

# 一条速度线沿路径画成细尖条：前端粗、往后收成尖，沿路径分段取点，拐弯时就弯成弧线；
# 两边的点一对对连成三角形带（不用三角剖分，急转弯也不会丢）
const ICE_LINE_STEPS := 10
func _ice_line(l: Dictionary, path: Dictionary, col: Color) -> void:
	if not _ok(): return
	var vp := PackedVector2Array()
	var idx := PackedInt32Array()
	for k in ICE_LINE_STEPS + 1:
		var u := float(k) / ICE_LINE_STEPS
		var d: float = float(l.d) + float(l.len) * u
		var w: float = float(l.width) * (1.0 - u)
		vp.append(_ice_place(path, d, float(l.off) - w))
		vp.append(_ice_place(path, d, float(l.off) + w))
		if k > 0:
			var b := (k - 1) * 2
			idx.append_array(PackedInt32Array([b, b + 2, b + 3, b, b + 3, b + 1]))
	var cols := PackedColorArray()
	cols.resize(vp.size())
	cols.fill(col)
	_tri(idx, vp, cols)

# 把路径变平滑：每一段按经过各点的 Catmull-Rom 曲线切成 k 段，急转弯处的速度线是圆的弧，不是几段带角的直线
func _ice_smooth(pts: PackedVector2Array, k := 4) -> PackedVector2Array:
	var n := pts.size()
	var out := PackedVector2Array()
	for i in n - 1:
		var p0 := pts[maxi(0, i - 1)]
		var p1 := pts[i]
		var p2 := pts[i + 1]
		var p3 := pts[mini(n - 1, i + 2)]
		for s in k:
			var u := float(s) / k
			var u2 := u * u
			var u3 := u2 * u
			out.append(0.5 * (2.0 * p1 + (p2 - p0) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u2 + (3.0 * p1 - p0 - 3.0 * p2 + p3) * u3))
	out.append(pts[n - 1])
	return out

# 跟着飞行的部分：只有速度线（剥落的碎冰和其它飘落的东西一起画，见 _remote_shed）
func _remote_ice_tail(pts: PackedVector2Array, r: float, strength: float, width: float, key: int) -> void:
	if pts.size() < 2: return
	var path := _ice_along(_ice_smooth(pts))
	var T := _ice_tones()
	_add = false
	for l in _ice_lines(path.len, r, _t, key, width):
		var a: float = float(l.alpha) * strength
		if a <= 0.01: continue
		_ice_line(l, path, _col(T.hi, a))

# 冰枪：在 (0, 0)，朝 +x 飞；光从屏幕上方来，往左飞（倒过来）时上下翻转。
# still：原地循环时身后自带一段直的飞行轨迹，速度线沿着它
func _remote_ice(r: float, key: int, still := false) -> void:
	if still:
		var pts := PackedVector2Array()
		for i in 9: pts.append(Vector2(-r * 12.0 * (1.0 - i / 8.0), 0.0))
		_remote_ice_tail(pts, r, 1.0, 1.0, key)
	var T := _ice_tones()
	var L := _ice_lance(r, key)
	var xf := _xf
	if _xf.y.y < 0.0:
		_xf = _xf * Transform2D(Vector2(1.0, 0.0), Vector2(0.0, -1.0), Vector2.ZERO)
	_ice_pieces([{"faces": L.faces, "outline": L.outline, "alpha": 1.0}], T, maxf(0.6, r * 0.05))
	# 枪尖的闪光在屏幕上始终是正的，不跟着冰枪转
	var tw := 0.75 + 0.25 * cos(_t * TAU * _ice_cycles() * 2.0)
	_xf = xf * Transform2D(-xf.get_rotation(), L.tip)
	_poly_fill(_ice_sparkle(Vector2.ZERO, r * 0.55 * tw), PackedColorArray([_col(T.hi, 0.95)]))
	_xf = xf
`;
