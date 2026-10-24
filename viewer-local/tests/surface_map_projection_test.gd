extends SceneTree
const Map=preload("res://adapters/surface_map_projection.gd")
var checks=0
var failures=0
func check(ok:bool,message:String):
	checks+=1
	if not ok:failures+=1;push_error(message)
func _initialize():call_deferred("run")
func project(record:Dictionary,point:Dictionary)->Vector2:
	var m=record.worldToClip
	var matrix=Projection(Vector4(m[0],m[1],m[2],m[3]),Vector4(m[4],m[5],m[6],m[7]),Vector4(m[8],m[9],m[10],m[11]),Vector4(m[12],m[13],m[14],m[15]))
	var local=Vector4(float(point.x)-float(record.renderOrigin.x),float(point.y)-float(record.renderOrigin.y),float(point.z)-float(record.renderOrigin.z),1)
	var clip=matrix*local
	return Vector2((clip.x/clip.w*.5+.5)*record.viewportPixels.width,(.5-clip.y/clip.w*.5)*record.viewportPixels.height)
func run():
	var viewport=SubViewport.new();viewport.size=Vector2i(1600,1000);root.add_child(viewport)
	var camera=Camera3D.new();viewport.add_child(camera);camera.current=true
	for top in [true,false]:
		camera.projection=Camera3D.PROJECTION_ORTHOGONAL if top else Camera3D.PROJECTION_PERSPECTIVE
		camera.size=100;camera.fov=48;camera.near=.1;camera.far=1000
		camera.position=Vector3(0,150,0) if top else Vector3(0,100,100)
		camera.look_at(Vector3.ZERO,Vector3.FORWARD if top else Vector3.UP)
		for offset in [0.0,1e9,-1e9]:
			var origin={"x":offset,"y":2048.0,"z":-offset}
			var record=Map.capture(camera,Vector2(1600,1000),origin,{"x":offset,"y":-offset},"world",top,160)
			check(not record.is_empty(),"valid actual camera exported")
			check(record.worldId=="world" and record.worldToClip.size()==16,"identity and column-major matrix")
			check(record.clipRange==[-1,1],"measured CPU projection depth range")
			check((record.uniformMetricScale!=null)==top,"no perspective metric scale")
			if top:check(record.uniformMetricScale.metresPerPixel==.1 and record.uniformMetricScale.bounds.minX==offset-80,"TOP horizontal frame")
			for local in [Vector3.ZERO,Vector3(12,4,-8),Vector3(-30,8,19)]:
				var got=project(record,{"x":offset+local.x,"y":2048.0+local.y,"z":-offset+local.z})
				check(got.distance_to(camera.unproject_position(local))<.001,"same optical camera, double origin subtraction before matrix")
	check(Map.capture(camera,Vector2(1600,1000),{"x":INF,"y":0,"z":0},{"x":0,"y":0},"world",false,160).is_empty(),"nonfinite origin rejected")
	check(Map.capture(camera,Vector2(1600,1000),{"x":0,"y":0,"z":0},{"x":0,"y":0},"",false,160).is_empty(),"missing displayed identity rejected")
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=100
	check(Map.capture(camera,Vector2(1600,1000),{"x":0,"y":0,"z":0},{"x":0,"y":0},"world",true,160).is_empty(),"tilted orthographic camera cannot claim TOP uniform scale")
	camera.position=Vector3(0,150,0);camera.look_at(Vector3.ZERO,Vector3.FORWARD)
	check(Map.capture(camera,Vector2(1600,1000),{"x":0,"y":0,"z":0},{"x":0,"y":0},"world",true,200).is_empty(),"configured width must match the actual camera matrix")
	print(JSON.stringify({"format":"surface-map-projection-cpu","checks":checks,"failures":failures,"status":"PASS" if failures==0 else "FAIL","scope":"actual Camera3D matrices, orthographic/perspective, rebasing; no image/GPU/composition claim"}));quit(0 if failures==0 else 1)
