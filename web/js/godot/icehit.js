// Impact fractures the projectile solid and keeps each cell's rigid volume.
export const ICE_HIT_GD = `
func _ice_debris(r: float, quantity: float, key: int, t: float, angle: float, body_radius := -1.0, axial_roll := NAN) -> Array:
	var P := Rand.new(key*227+61)
	var cells := _ice_cells(_ice_solid(r*0.42 if body_radius<0.0 else body_radius,key))
	var roll := float(key) if is_nan(axial_roll) else axial_roll
	var out := []
	for j in 12+roundi(8.0*clampf(quantity,0.0,2.0)):
		var cell: Dictionary = cells[j%24]
		var chip := j>=12
		var scale0 := 0.16+P.next()*0.28 if chip else 1.0
		var born := 0.02+P.next()*0.05 if chip else 0.0
		var age := maxf(0.0,t-born)
		var drift := 1.0-pow(1.0-clampf(age/0.45,0.0,1.0),2.0)
		var phi := angle+j*2.39996+(P.next()-0.5)*0.7
		var speed0 := r*(2.4+P.next()*2.2 if chip else 1.4+P.next()*1.7)
		var sign0 := -1.0 if P.next()<0.5 else 1.0
		var spin := sign0*(3.0+P.next()*4.0 if chip else 0.8+P.next()*2.2)
		var life := 0.8+P.next()*0.2
		var centre := _ice_rotate(cell.centre,0.0,roll,angle)
		var at0 := Vector2(centre.x+(cos(phi)*speed0+cos(angle)*r*0.3)*drift,centre.y+(sin(phi)*speed0*0.85+sin(angle)*r*0.3-r*0.35)*drift+r*age*age*0.9)
		var vertices := PackedVector3Array()
		var radius0 := 0.0
		for p in cell.vertices:
			var v := _ice_rotate(_ice_rotate(p*scale0,0.0,roll,0.0),spin*age*0.7,spin*age,angle+spin*age*0.5)
			vertices.append(v)
			radius0 = maxf(radius0,v.length())
		var mesh := _ice_mesh(vertices,cell.sides)
		mesh.merge({"id":j,"at":at0,"depth":centre.z,"radius":radius0,"alpha":0.0 if t<born else 1.0-_smooth(life*0.6,life,t)})
		out.append(mesh)
	return out

func _ice_frost_cracks(r: float, key: int, t: float) -> Array:
	var P := Rand.new(key*401+71)
	var growth := _smooth(0.0,0.18,t)
	var paths := []
	for j in 6:
		var a := j*TAU/6.0+(P.next()-0.5)*0.45
		var length0 := r*(0.55+P.next()*0.5)
		var bend := (P.next()-0.5)*0.4
		var p := Vector2.from_angle(a+bend)*length0*growth*0.55
		var q := Vector2.from_angle(a-bend)*length0*growth*0.25
		var end := Vector2.from_angle(a)*length0*growth
		var side := Vector2.from_angle(a+(-0.38 if j%2 else 0.38))*length0*growth*0.8
		p.y *= 0.45; q.y *= 0.45; end.y *= 0.45; side.y *= 0.45
		paths.append(PackedVector2Array([Vector2.ZERO,q,p,end]))
		paths.append(PackedVector2Array([p,side]))
	return paths

func _remote_ice_hit(at0: Vector2, t: float, angle: float, key: int, radius: float) -> void:
	var xf := _xf
	_xf = xf*Transform2D(0.0,at0)
	var P := Rand.new(key*331+19)
	var flash := 1.0-_smooth(0.0,0.22,t)
	var fade := pow(1.0-t,1.15)
	var wave := 1.0-pow(1.0-clampf(t/0.42,0.0,1.0),2.2)
	_add = additive
	_ring(Vector2.ZERO,maxf(0.6,wave*radius*1.25),maxf(0.8,radius*0.045),0.62,core_color,fade*0.85)
	_ring(Vector2.ZERO,maxf(0.4,wave*radius*0.72),maxf(0.5,radius*0.02),0.5,rim_color,fade*0.45)
	for path in _ice_frost_cracks(radius*1.15,key,t):
		_line(path,PackedColorArray([_col(rim_color,fade*0.28)]),maxf(1.4,radius*0.04))
		_line(path,PackedColorArray([_col(core_color.lerp(rim_color,0.25),fade*0.9)]),maxf(0.55,radius*0.014))
	for j in 5:
		var a := P.next()*TAU
		var p := Vector2(cos(a)*radius*t*0.7,sin(a)*radius*t*0.32)
		_remote_puff(p,radius*(0.16+t*0.38),a,rim_color,_smooth(0.0,0.08,t)*fade*0.2*minf(1.5,amount),j+key,1.6)
	var axial_roll := (charge_frames+travel_frames)/float(frames)*TAU+key
	var pieces := _ice_debris(radius,amount,key,t,angle,_remote_radius(),axial_roll)
	pieces.sort_custom(func(a,b): return a.depth<b.depth)
	for piece in pieces:
		if piece.alpha<=0.0: continue
		_xf = xf*Transform2D(0.0,at0+piece.at)
		_ice_draw_mesh(piece,key+piece.id*131,maxf(1.0,piece.radius),piece.alpha)
	_xf = xf*Transform2D(0.0,at0)
	_add = additive
	var S := Rand.new(key*809+3)
	for j in 7:
		var a := angle+(S.next()-0.5)*2.4
		var len := radius*(0.35+S.next()*0.85)*wave
		var w := maxf(0.6,radius*(0.012+S.next()*0.012))
		_streak(Vector2(cos(a),sin(a))*len*0.15,Vector2(cos(a),sin(a))*len,rim_color,core_color,fade*(0.35+S.next()*0.4),w)
	_xf = xf*Transform2D(angle,at0)
	_blob(Vector2(radius*0.05,0),radius*0.95,[[0.0,core_color,flash*0.95],[0.35,rim_color,flash*0.4],[1.0,rim_color,0.0]],Vector2(1.55,0.22))
	_xf = xf*Transform2D(0.0,at0)
	_blob(Vector2.ZERO,radius*(0.28+flash*0.55),[[0.0,core_color,maxf(flash,fade*0.35)],[0.3,core_color,flash*0.55],[1.0,rim_color,0.0]])
	_xf = xf
`;
