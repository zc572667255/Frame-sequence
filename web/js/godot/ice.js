// Shared solid and material for the flying cone and its actual fracture cells.
export const ICE_GD = `
func _ice_rotate(p: Vector3, yaw: float, pitch: float, roll: float) -> Vector3:
	var ax := p.x * cos(yaw) + p.z * sin(yaw)
	var az := p.z * cos(yaw) - p.x * sin(yaw)
	var by := p.y * cos(pitch) - az * sin(pitch)
	var bz := p.y * sin(pitch) + az * cos(pitch)
	return Vector3(ax * cos(roll) - by * sin(roll), ax * sin(roll) + by * cos(roll), bz)

func _ice_solid(r: float, key: int) -> Dictionary:
	var P := Rand.new(key * 359 + 29)
	var angles := []
	var widths := []
	var vertices := PackedVector3Array()
	var centres := PackedVector3Array()
	for j in 6: angles.append(j * PI / 3.0 + (P.next() - 0.5) * 0.16)
	for j in 6: widths.append(0.9 + P.next() * 0.16)
	var profile := [Vector2(-1.62, 0.5), Vector2(-0.35, 0.72), Vector2(0.78, 0.42), Vector2(1.78, 0.17)]
	for band in 4:
		var cy := (P.next() - 0.5) * 0.06
		var cz := (P.next() - 0.5) * 0.06
		for j in 6:
			var rough := 0.94 + P.next() * 0.1
			var px: float = profile[band].x + (P.next() - 0.5) * (0.12 if band < 2 else 0.06)
			var a: float = angles[j] + band * 0.03
			vertices.append(Vector3(px, cy + sin(a) * profile[band].y * widths[j] * rough, cz + cos(a) * profile[band].y * widths[j] * rough) * r)
		centres.append(Vector3(profile[band].x, cy, cz) * r)
	var tip := Vector3(r * (3.05 + P.next() * 0.15), r * 0.02, -r * 0.02)
	vertices.append(tip)
	return {"vertices": vertices, "centres": centres, "tip": tip}

func _ice_solid_sides() -> Array:
	var sides := []
	for band in 3:
		for j in 6:
			var a := band * 6 + j
			var b := band * 6 + (j + 1) % 6
			var c := b + 6
			var d := a + 6
			sides.append_array([[a,b,d],[b,c,d]] if (band+j)%2 else [[a,b,c],[a,c,d]])
	for j in 6: sides.append([18+j,18+(j+1)%6,24])
	for j in range(1,5): sides.append([0,j,j+1])
	return sides

func _ice_mesh(vertices: PackedVector3Array, sides: Array) -> Dictionary:
	var centre := Vector3.ZERO
	for p in vertices: centre += p / vertices.size()
	var faces := []
	var edges := {}
	for id in sides.size():
		var side: Array = sides[id].duplicate()
		var a := vertices[side[0]]
		var normal := (vertices[side[1]] - a).cross(vertices[side[2]] - a)
		if normal.length() < 0.000000001: continue
		if normal.dot(a - centre) < 0.0:
			normal = -normal
			side.reverse()
		normal = normal.normalized()
		var visible := normal.z > 0.000001
		var light := maxf(0.0, -normal.x * 0.22 - normal.y * 0.7 + normal.z * 0.68)
		var spec := pow(maxf(0.0, -normal.y * 0.38 + normal.z * 0.925),24.0)
		for j in 3:
			var i: int = side[j]
			var k: int = side[(j+1)%3]
			var edge_key := mini(i,k) * vertices.size() + maxi(i,k)
			var edge: Dictionary = edges.get(edge_key,{"points":PackedVector2Array([Vector2(vertices[i].x,vertices[i].y),Vector2(vertices[k].x,vertices[k].y)]),"front":0,"light":0.0})
			if visible:
				edge.front += 1
				edge.light = maxf(edge.light,light)
			edges[edge_key] = edge
		if visible:
			var points := PackedVector2Array()
			var depth := 0.0
			for i in side:
				points.append(Vector2(vertices[i].x,vertices[i].y))
				depth += vertices[i].z / 3.0
			faces.append({"id":id,"points":points,"depth":depth,"light":light,"spec":spec})
	faces.sort_custom(func(a,b): return a.depth < b.depth)
	var visible_edges := []
	for edge in edges.values():
		if edge.front: visible_edges.append(edge)
	return {"vertices":vertices,"faces":faces,"edges":visible_edges}

func _ice_cells(solid: Dictionary) -> Array:
	var cells := []
	for band in 4:
		for j in 6:
			var k := (j+1)%6
			var v := PackedVector3Array([solid.centres[band],solid.vertices[band*6+j],solid.vertices[band*6+k]])
			var sides: Array
			if band == 3:
				v.append(solid.tip)
				sides = [[0,1,2],[0,1,3],[1,2,3],[2,0,3]]
			else:
				v.append_array(PackedVector3Array([solid.centres[band+1],solid.vertices[(band+1)*6+j],solid.vertices[(band+1)*6+k]]))
				sides = [[0,1,2],[3,4,5],[0,1,4],[0,4,3],[0,2,5],[0,5,3]]
				sides.append_array([[1,2,4],[2,5,4]] if (band+j)%2 else [[1,2,5],[1,5,4]])
			var centre := Vector3.ZERO
			for p in v: centre += p / v.size()
			for i in v.size(): v[i] -= centre
			cells.append({"vertices":v,"centre":centre,"sides":sides,"band":band})
	return cells

func _ice_prism(r: float, roll: float, key: int) -> Dictionary:
	var solid := _ice_solid(r,key)
	var vertices := PackedVector3Array()
	for p in solid.vertices: vertices.append(_ice_rotate(p,0.0,roll,0.0))
	return _ice_mesh(vertices,_ice_solid_sides())

func _ice_face_cracks(points: PackedVector2Array, key: int) -> Array:
	var P := Rand.new(key)
	var centre := (points[0]+points[1]+points[2])/3.0
	var a := points[0].lerp(points[1],0.15+P.next()*0.55)
	var b := centre.lerp(points[2],P.next()*0.35)
	var c := points[1].lerp(points[2],0.2+P.next()*0.6)
	return [PackedVector2Array([a,a.lerp(b,0.5).lerp(centre,0.15+P.next()*0.3),b]),PackedVector2Array([b,c])]

func _ice_draw_mesh(mesh: Dictionary, key: int, r: float, alpha := 1.0) -> void:
	for face in mesh.faces:
		_add = false
		var deep := colors[mini(1, colors.size() - 1)].lerp(colors[0], 0.22)
		var blue := deep.lerp(rim_color, 0.35 + face.light * 0.45)
		var lit := blue.lerp(core_color, 0.18 + face.light * 0.34 + face.spec * 0.62)
		var pts: PackedVector2Array = face.points
		var d := pts[2]-pts[0]
		var cl := PackedColorArray()
		var cover: float = alpha * (0.9 + face.light * 0.08)
		for p in pts: cl.append(_col(blue.lerp(lit,clampf((p-pts[0]).dot(d)/maxf(0.00000001,d.length_squared()),0.0,1.0)),cover))
		_poly_fill(pts,cl)
		var surface_key: int = key*419+face.id*17+7
		var u := -float(absi(surface_key)%11+1)*2.0
		_remote_quad(2,[pts[0],pts[1],pts[2],pts[2]],[Vector2(u,0),Vector2(u-1.0,0),Vector2(u,1),Vector2(u,1)],Color(1,1,1,alpha*(0.16+face.light*0.18)))
		for path in _ice_face_cracks(pts,surface_key):
			_line(path,PackedColorArray([_col(core_color.lerp(rim_color,0.65),alpha*(0.12+face.spec*0.45))]),maxf(0.35,r*0.01))
	_add = additive
	for edge in mesh.edges:
		var rim: bool = edge.front == 1
		var bright := pow(edge.light,6.0)
		_line(edge.points,PackedColorArray([_col(core_color.lerp(rim_color,0.15 if rim else 0.45),alpha*(0.72+bright*0.28 if rim else 0.16+bright*0.35))]),maxf(0.6,r*(0.034 if rim else 0.014)))

func _ice_cracks(r: float, key: int, roll: float) -> Array:
	var P := Rand.new(key * 911 + 13)
	var lines := []
	for i in 4:
		var x := -1.15 + P.next() * 1.4
		var y := (P.next() - 0.5) * 0.34
		var z := (P.next() - 0.5) * 0.22
		var pts := PackedVector3Array([Vector3(x, y, z)])
		for k in 3:
			x += 0.28 + P.next() * 0.42
			y += (P.next() - 0.5) * 0.22
			z += (P.next() - 0.5) * 0.16
			pts.append(Vector3(x, y, z))
		var flat := PackedVector2Array()
		for p in pts:
			var q := _ice_rotate(p * r, 0.0, roll, 0.0)
			flat.append(Vector2(q.x, q.y))
		lines.append(flat)
	return lines

func _ice_wake_half(r: float, u: float, width: float, strength: float) -> float:
	var widen := 0.35 + 0.7 * clampf(width, 0.0, 180.0) / 100.0
	var along := 0.1 + 0.9 * pow(clampf(u, 0.0, 1.0), 0.62)
	return maxf(0.0, r) * widen * along * sqrt(maxf(0.0, strength))

func _remote_ice_wake(pts: PackedVector2Array, r: float, strength: float, frame: float, index: int) -> void:
	if pts.size() < 2 or strength <= 0.001: return
	_ice_magic_wake(pts, r, strength, frame, index)

func _remote_ice(r: float, key: int) -> void:
	_ice_spear(r, key)
`;
