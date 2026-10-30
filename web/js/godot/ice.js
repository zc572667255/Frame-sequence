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
	for j in 6: angles.append(j * PI / 3.0 + (P.next() - 0.5) * 0.25)
	for j in 6: widths.append(0.8 + P.next() * 0.32)
	var profile := [Vector2(-1.35, 0.62), Vector2(-0.65, 0.94), Vector2(0.38, 0.52), Vector2(1.35, 0.23)]
	for band in 4:
		var cy := (P.next() - 0.5) * 0.14
		var cz := (P.next() - 0.5) * 0.14
		for j in 6:
			var rough := 0.88 + P.next() * 0.24
			var px: float = profile[band].x + (P.next() - 0.5) * (0.34 if band < 2 else 0.22)
			var a: float = angles[j] + band * 0.065
			vertices.append(Vector3(px, cy + sin(a) * profile[band].y * widths[j] * rough, cz + cos(a) * profile[band].y * widths[j] * rough) * r)
		centres.append(Vector3(profile[band].x, cy, cz) * r)
	var tip := Vector3(r * (2.45 + P.next() * 0.3), r * 0.04, -r * 0.06)
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

func _ice_trail_profile(r: float, key: int) -> Vector2:
	var solid := _ice_solid(r,key)
	var lo := INF
	var hi := -INF
	for p in solid.vertices:
		var y := _ice_rotate(p,0.0,_t*TAU+key,0.0).y
		lo = minf(lo,y); hi = maxf(hi,y)
	return Vector2((hi-lo)/2.0,(hi+lo)/2.0)

func _ice_trail_half(r: float, key: int) -> float:
	return _ice_trail_profile(r,key).x

func _ice_trail_sections(points: PackedVector2Array, r: float, key: int, strength: float) -> Array:
	var profile := _ice_trail_profile(r,key)
	var shifted := PackedVector2Array()
	for i in points.size():
		var d := (points[mini(points.size()-1,i+1)]-points[maxi(0,i-1)]).normalized()
		shifted.append(points[i]-d*r*0.65+Vector2(-d.y,d.x)*profile.y)
	return _remote_sections(shifted,profile.x/0.85,strength,r)

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
		var blue := (colors[0]*0.48).lerp(rim_color,0.12+face.light*0.38)
		var lit := blue.lerp(core_color,0.05+face.light*face.light*0.38+face.spec*0.24)
		var pts: PackedVector2Array = face.points
		var d := pts[2]-pts[0]
		var cl := PackedColorArray()
		for p in pts: cl.append(_col(blue.lerp(lit,clampf((p-pts[0]).dot(d)/maxf(0.00000001,d.length_squared()),0.0,1.0)),alpha*0.94))
		_poly_fill(pts,cl)
		var surface_key: int = key*419+face.id*17+7
		var u := -float(absi(surface_key)%11+1)*2.0
		_remote_quad(2,[pts[0],pts[1],pts[2],pts[2]],[Vector2(u,0),Vector2(u-1.0,0),Vector2(u,1),Vector2(u,1)],Color(1,1,1,alpha*(0.3+face.light*0.35)))
		for path in _ice_face_cracks(pts,surface_key):
			_line(path,PackedColorArray([_col(rim_color.lerp(core_color,0.55),alpha*(0.08+face.spec*0.25))]),maxf(0.3,r*0.009))
	_add = additive
	for edge in mesh.edges:
		var rim: bool = edge.front == 1
		var bright := pow(edge.light,8.0)
		_line(edge.points,PackedColorArray([_col(rim_color.lerp(core_color,0.42),alpha*(0.24+bright*0.35 if rim else 0.015+bright*0.13))]),maxf(0.35,r*(0.018 if rim else 0.009)))

func _remote_ice(r: float, key: int) -> void:
	_ice_draw_mesh(_ice_prism(r,_t*TAU+key,key),key,r)
`;
