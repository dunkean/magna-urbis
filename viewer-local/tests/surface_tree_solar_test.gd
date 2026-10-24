extends SceneTree
const Solar=preload("res://adapters/surface_tree_solar.gd")
var checks=0
var failures=0
func check(ok:bool,label:String)->void:
	checks+=1
	if not ok:failures+=1;push_error(label)
func _initialize()->void:
	var origin={"x":1e9,"y":2000.0,"z":-1e9}
	var candidate={"stableId":"real-root-contract","family":"tree","x":1e9+4.25,"y":2012.125,"z":-1e9-3.5,"size":12.0,"crownRadiusM":5.04,"orientation":.73,"rank":.27}
	var bounds={"minX":1e9-2000,"maxX":1e9+2000,"minZ":-1e9-2000,"maxZ":-1e9+2000}
	var world={"id":"solar-test","bounds":bounds,"terrain":{"source":{"id":"source-exact","version":"v1"},"heights":PackedFloat32Array([2000,2100,2000,2100]),"originX":bounds.minX,"originZ":bounds.minZ,"width":2,"height":2,"spacingM":4000}}
	var packet={"world":world,"source":{"sourceEpoch":"s","sceneEpoch":"c"},"candidatePages":{"version":"surface-candidate-pages-1","tree":{"bounds":bounds,"complete":true,"includeOverhang":true,"retention":1,"count":1}},"candidates":[candidate]}
	var unchanged=var_to_bytes(packet)
	var data=Solar.prepare(packet,world,origin)
	check(data.available,"complete real source inventory")
	check(data.count==1 and data.triangles==2,"no selected geometry cap")
	check(var_to_bytes(packet)==unchanged,"source immutable")
	check(data.values[1]==2012.125,"root altitude unchanged")
	for direction in [Vector3(.35,.75,.56).normalized(),Vector3(-.6,.4,-.5).normalized()]:
		var basis=Solar.solar_basis(direction)
		check(absf(basis.determinant()-1)<.00001,"right-handed solar frame")
		check(basis.z.is_equal_approx(direction),"quad faces sun not camera")
		var result=Solar.instance_buffer(data,origin,direction);var a:PackedFloat32Array=result.buffer
		check(a.size()==20,"exact one buffer row")
		check(a[3]==4.25 and a[7]==18.125 and a[11]==-3.5,"subtract source doubles beforeFP32; root+H/2")
		check(a[16]==Solar.yaw_bin(.73),"source yaw bin")
		for local in [Vector3(.2,-.1,.3),Vector3(-.4,.5,-.2)]:
			var point=Vector3(a[3],a[7],a[11])+basis*(local*12)
			var projected=Vector2((point-Vector3(4.25,18.125,-3.5)).dot(basis.x),(point-Vector3(4.25,18.125,-3.5)).dot(basis.y))
			var depth=(point-Vector3(4.25,18.125,-3.5)).dot(direction)/12
			var recovered=Vector3(4.25,18.125,-3.5)+basis.x*projected.x+basis.y*projected.y+direction*depth*12
			check(point.distance_to(recovered)<.00001,"source projection+depth algebra oracle")
			check(result.bounds.has_point(point),"conservative depth support includes off-plane fragment")
		var view={"minX":1e9-50,"maxX":1e9+50,"minZ":-1e9-50,"maxZ":-1e9+50}
		var guard=Solar.guard(data,view,1980,direction)
		check(guard.weight==1,"whole view and upstream shadow halo covered")
		check(guard.maximumCasterY==2118,"actual source height bound+declared catalogue max")
		check(Solar.guard(data,view,-10000,direction).weight==0,"missing offscreen upstream casters disableswholeview")
	var bad=packet.duplicate(true);bad.candidates[0].crownRadiusM=6
	check(not Solar.prepare(bad,world,origin).available,"reject unsupported anisotropy; never stretch wrongmask")
	bad=packet.duplicate(true);bad.candidatePages.tree.count=2
	check(not Solar.prepare(bad,world,origin).available,"reject falsely complete inventory count")
	for i in range(-200,201):
		var angle=float(i)*.127;var bin=Solar.yaw_bin(angle);var delta=wrapf(angle-float(bin)*TAU/Solar.YAW_BINS,-PI,PI)
		check(absf(delta)<=PI/Solar.YAW_BINS+.000001,"bounded yaw quantization")
	print(JSON.stringify({"test":"tree-solar-cpu","checks":checks,"failures":failures,"result":"PASS" if failures==0 else "FAIL","scope":"CPU algebra/source/coverage only; no native shader depth proof"}));quit(0 if failures==0 else 1)
