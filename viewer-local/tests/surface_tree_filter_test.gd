extends SceneTree
const View=preload("res://adapters/surface_canopy_view.gd")
var checks:=0
func _initialize()->void:call_deferred("run")
func verify(value:bool,message:String)->void:
	checks+=1
	if not value:push_error(message);quit(1);assert(value,message)
func footprint(vp:Projection,size:Vector2,p:Vector3)->float:
	var c=vp*Vector4(p.x,p.y,p.z,1)
	var e=vp*Vector4(p.x+1,p.y,p.z,1);var s=vp*Vector4(p.x,p.y,p.z+1,1)
	if minf(c.w,minf(e.w,s.w))<=0:return INF
	return 1.0/maxf(minf(((Vector2(e.x,e.y)/e.w-Vector2(c.x,c.y)/c.w)*size*.5).length(),((Vector2(s.x,s.y)/s.w-Vector2(c.x,c.y)/c.w)*size*.5).length()),.000001)
func exercise(height:float,position:Vector3,size:Vector2,spacing:float,orthographic:bool=false,yaw:float=0.0)->Dictionary:
	var viewport=SubViewport.new();viewport.size=Vector2i(size);viewport.render_target_update_mode=SubViewport.UPDATE_DISABLED;root.add_child(viewport)
	var camera=Camera3D.new();viewport.add_child(camera);camera.current=true;camera.fov=48;camera.position=position;camera.look_at(Vector3.ZERO)
	if yaw!=0:camera.rotate_object_local(Vector3.FORWARD,yaw)
	if orthographic:camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=height
	var origin={"x":1000000000.0,"y":0.0,"z":-1000000000.0}
	var bounds={"minX":origin.x-10000,"maxX":origin.x+10000,"minZ":origin.z-10000,"maxZ":origin.z+10000}
	var guard=View.evaluate(camera,size,0.0,origin,bounds,0.0,20.0)
	verify(guard.analyticFootprintBound.valid,"finite projection must have a valid analytic certificate")
	var vp=camera.get_camera_projection()*Projection(camera.get_camera_transform().affine_inverse())
	var measured=0.0
	for iz in 33:
		for ix in 33:
			var pixel=size*Vector2(ix/32.0,iz/32.0);var ro=camera.project_ray_origin(pixel);var ray=camera.project_ray_normal(pixel)
			for plane in [0.0,20.0]:
				var p=ro+ray*((plane-ro.y)/ray.y);p.y=0
				var actual=footprint(vp,size,p);measured=maxf(measured,actual)
				verify(actual<=guard.maximumPixelFootprintM,"dense finite-step query exceeds analytic bound")
	var result=View.certify_filter(guard,spacing,Vector2(2048,2048))
	verify(result.maximumPixelFootprintM>=measured,"certificate covers the dense probe")
	verify(result.geometryFilterCompatible==(result.maximumPixelFootprintM/spacing<=8.0),"active-spacing ratio matches compatibility")
	var old=View.certify_filter(guard,spacing/4.0,Vector2(2048,2048))
	verify(old.geometryFilterRatio==result.geometryFilterRatio*4.0,"stale atlas uses its own spacing")
	viewport.queue_free()
	return {"height":height,"viewport":[size.x,size.y],"actualMaximumM":measured,"analyticMaximumM":guard.maximumPixelFootprintM,"ratio":result.geometryFilterRatio,"phase":result.safePhase}
func run()->void:
	var results=[]
	var h55=exercise(55,Vector3(0,55,55*.68/.73),Vector2(200,125),.25);results.append(h55)
	verify(h55.actualMaximumM/.25>8.0 and h55.phase<=1.0,"reported main55 counterexample must forbid all geometry")
	var h100=exercise(100,Vector3(0,100,100),Vector2(200,125),.5);results.append(h100)
	verify(h100.actualMaximumM/.5>8.0 and h100.phase<=1.0,"reported far-edge midpoint counterexample must forbid all geometry")
	results.append(exercise(50,Vector3(0,50,50*.68/.73),Vector2(200,125),.25))
	results.append(exercise(50,Vector3(0,50,50*.68/.73),Vector2(400,250),.25))
	results.append(exercise(55,Vector3(30,80,100),Vector2(400,250),.5,false,.22))
	results.append(exercise(55,Vector3(-50,100,100),Vector2(200,125),.5,false,-.3))
	results.append(exercise(55,Vector3(0,100,1),Vector2(200,125),.5,true))
	var invalid=View.footprint_bound(Projection.IDENTITY,Vector2(200,125),0,{"x":0,"z":0},{"minX":-1,"maxX":1,"minZ":-1,"maxZ":1})
	verify(not invalid.valid,"degenerate horizontal screen projection is not a certificate")
	var unavailable=View.certify_filter({"safePhase":2.0},.25,Vector2(2048,2048))
	verify(unavailable.safePhase<=1.0 and not unavailable.geometryFilterCompatible,"missing certificate cannot enable geometry")
	print(JSON.stringify({"test":"tree-filter-certificate","result":"PASS","checks":checks,"cases":results,"scope":"CPU Camera3D finite-step float32 probes against analytic bound; no GPU coverage claim"}));quit()
