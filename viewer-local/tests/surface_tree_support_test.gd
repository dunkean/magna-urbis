extends SceneTree
const Assets=preload("res://adapters/surface_tree_library.gd")
var checks:=0
func _initialize()->void:call_deferred("run")
func verify(value:bool,message:String)->void:
	checks+=1
	if not value:push_error(message);quit(1);assert(value,message)
func pixel_diameter(candidate:Dictionary,camera:Camera3D,size:Vector2,origin:Dictionary)->float:
	var p=Vector4(float(candidate.x)-float(origin.x),0,float(candidate.z)-float(origin.z),1)
	var vp=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse())
	var c=vp*p;var e=vp*(p+Vector4(1,0,0,0));var s=vp*(p+Vector4(0,0,1,0))
	return 2.0*float(candidate.crownRadiusM)*minf(((Vector2(e.x,e.y)/e.w-Vector2(c.x,c.y)/c.w)*size*.5).length(),((Vector2(s.x,s.y)/s.w-Vector2(c.x,c.y)/c.w)*size*.5).length())
func run()->void:
	var args=OS.get_cmdline_user_args();verify(args.size()==1,"Expected resolved tree descriptor path")
	var library=Assets.new();library.manifest=JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	var local=library.local_support_bounds()
	var imported_control=BoxMesh.new();imported_control.size=Vector3(3,4,3);library.high_mesh=imported_control
	verify(library.local_support_bounds().encloses(imported_control.get_aabb()),"Actual imported high mesh bounds must be included, not only descriptor metadata")
	library.high_mesh=null
	var viewport=SubViewport.new();viewport.size=Vector2i(1600,1000);viewport.render_target_update_mode=SubViewport.UPDATE_DISABLED;root.add_child(viewport)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=6.25;camera.position=Vector3(0,100,.0001);viewport.add_child(camera);camera.look_at(Vector3.ZERO,Vector3.FORWARD);camera.current=true
	var planes=camera.get_frustum()
	# Position/radius/height of a retained V12 record; yaw is an authored control.
	var candidate={"stableId":"1905266606:tree:1000:999:24","family":"tree","x":6.76562328823,"y":0.0,"z":-4.97101030778,"size":16.194046020507812,"crownRadiusM":6.801499843597412,"orientation":.73,"rank":.2,"canopyClass":3}
	var before=var_to_bytes(candidate);var zero={"x":0.0,"y":0.0,"z":0.0}
	var box=Assets.transformed_support(candidate,zero,local)
	verify(not camera.is_position_in_frustum(Vector3(candidate.x,candidate.size*.5,candidate.z)),"Control centre must be outside the viewport")
	verify(Assets.intersects_frustum(box,planes),"Offscreen centre with intersecting crown must remain high-eligible")
	verify(pixel_diameter(candidate,camera,Vector2(viewport.size),zero)>=500,"Retained crown physically exceeds high threshold")
	var far=candidate.duplicate();far.stableId="fully-outside";far.x=100.0
	verify(not Assets.intersects_frustum(Assets.transformed_support(far,zero,local),planes),"Whole support outside frustum must be rejected")
	var behind=candidate.duplicate();behind.y=200.0
	verify(not Assets.intersects_frustum(Assets.transformed_support(behind,zero,local),planes),"Whole support behind camera must be rejected")
	var centred=candidate.duplicate();centred.x=0;centred.z=0
	verify(Assets.intersects_frustum(Assets.transformed_support(centred,zero,local),planes),"Inside support must intersect")
	for shift in [{"x":1000000000.0,"y":2000.0,"z":-1000000000.0},{"x":-1000000000.0,"y":-2000.0,"z":1000000000.0}]:
		var shifted=candidate.duplicate();shifted.x+=shift.x;shifted.y+=shift.y;shifted.z+=shift.z
		var shifted_before=var_to_bytes(shifted);var rebased=Assets.transformed_support(shifted,shift,local)
		verify(rebased.position.distance_to(box.position)<.00001 and rebased.size.distance_to(box.size)<.00001,"Rebased support must retain local geometry")
		verify(Assets.intersects_frustum(rebased,planes),"Rebase must not change eligibility")
		var buffer=Assets.instance_buffer([shifted],shift)
		verify(absf(buffer[3]-candidate.x)<.00001 and buffer[7]==0 and absf(buffer[11]-candidate.z)<.00001,"Root/Y buffers must remain exact to float32 conversion")
		verify(var_to_bytes(shifted)==shifted_before,"Support query must not mutate shifted source record")
	# Validate all five shader quad supports against transformed bounds using
	# the actual MultiMesh row buffer rather than the helper's Basis constructor.
	var directions=[Vector3.UP,Vector3(1,1,0).normalized(),Vector3(0,1,-1).normalized(),Vector3(-1,1,0).normalized(),Vector3(0,1,1).normalized()]
	for angle in [0.0,.73,-1.2,PI*.25]:
		var rotated=candidate.duplicate();rotated.orientation=angle
		var support=Assets.transformed_support(rotated,zero,local).grow(.0001);var rows=Assets.instance_buffer([rotated],zero)
		for i in directions.size():
			var right=Vector3.RIGHT if i==0 else Vector3.UP.cross(directions[i]).normalized();var up=directions[i].cross(right)
			for x in [-1.1,1.1]:
				for y in [-1.1,1.1]:
					var point=Vector3(0,.5,0)+right*x+up*y
					var actual=Vector3(rows[0]*point.x+rows[1]*point.y+rows[2]*point.z+rows[3],rows[4]*point.x+rows[5]*point.y+rows[6]*point.z+rows[7],rows[8]*point.x+rows[9]*point.y+rows[10]*point.z+rows[11])
					verify(support.has_point(actual),"Rotated five-view quad corner escaped bounds")
	var records=[];var pixels={}
	for i in 40:
		var record=candidate.duplicate();record.stableId="control-"+str(i);record.rank=i/40.0
		if i>=20:record.x=100
		records.append(record)
		var projected=pixel_diameter(record,camera,Vector2(viewport.size),zero)
		if projected>=500 and Assets.intersects_frustum(Assets.transformed_support(record,zero,local),planes):pixels[record.stableId]=projected
	var original=var_to_bytes(records);var plan=library.plan(records,pixels)
	verify(plan.high.size()==14 and plan.highTriangles==1880130 and plan.highTriangles<=2000000,"High budget must stay bounded")
	verify(plan.middle.size()==26 and plan.retainedCount==40 and plan.droppedCount==0,"Every retained ID must keep high or impostor representation")
	var ids={}
	for group in [plan.high,plan.middle]:
		for record in group:verify(not ids.has(record.stableId),"Duplicate retained ID");ids[record.stableId]=true
	verify(ids.size()==40 and var_to_bytes(records)==original and var_to_bytes(candidate)==before,"Support/planning must preserve IDs and all source values")
	verify(plan==library.plan(records,pixels),"Stable high ranking must repeat")
	print(JSON.stringify({"test":"tree-transformed-support-culling","result":"PASS","checks":checks,"offscreenCentreIntersects":true,"offscreenPhysicalDiameterPixels":pixel_diameter(candidate,camera,Vector2(viewport.size),zero),"high":plan.high.size(),"middle":plan.middle.size(),"highTriangles":plan.highTriangles,"scope":"CPU Camera3D frustum + real normalized asset descriptor, authored yaw/placement controls. No GPU occlusion or rendered alpha-positive centre claim."}));quit()
