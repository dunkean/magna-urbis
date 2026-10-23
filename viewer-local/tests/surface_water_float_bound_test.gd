extends SceneTree
const Hydro=preload("res://adapters/surface_hydrology.gd")
func _initialize():call_deferred("run")
func run():
	var water={"n":4,"width":40.0,"originX":5.0,"originZ":5.0,"classes":PackedByteArray([2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2]),"levelM":PackedFloat32Array([7,7,7,7,7,7,7,7,7,7,7,7,7,7,7,7])}
	var origin={"x":20038.9862060547,"z":20038.9862060547};var p=Vector3(-20038.986328125,0,-20038.986328125)
	assert(not is_finite(Hydro._level(water,float(origin.x)+p.x,float(origin.z)+p.z)))
	assert(Hydro._level_at_clipped_vertex(water,origin,p)==7.0)
	assert(not is_finite(Hydro._level_at_clipped_vertex(water,origin,Vector3(-20039,0,-20039))))
	water.levelM.fill(NAN)
	assert(not is_finite(Hydro._level_at_clipped_vertex(water,origin,p)))
	assert(not is_finite(Hydro._level(water,20,20)))
	print(JSON.stringify({"passed":true,"scope":"Only clipped relative-FP32 boundary roundoff is rescued; genuine outside source support and absent measured wet levels remain missing"}));quit()
