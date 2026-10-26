extends SceneTree
class Harness extends "res://scene/main.gd":
	func _ready()->void:pass
func _initialize():call_deferred("run")
func run():
	var node=Harness.new();node.set_process(false);root.add_child(node);node.add_child(node.camera);node.add_child(node.objects)
	var grid={"width":2,"height":2,"originX":-5.0,"originZ":-5.0,"spacingM":10.0,"heights":PackedFloat32Array([0,0,0,0])}
	node.world={"terrain":grid,"bounds":{"minX":-5.0,"minZ":-5.0,"maxX":5.0,"maxZ":5.0},"_heightRange":Vector2.ZERO};node.origin={"x":0,"y":0,"z":0};node.focus={"x":0,"y":0};node.width_m=10;node.oblique=false
	var building=MeshInstance3D.new();var source_mesh=BoxMesh.new();source_mesh.size=Vector3(10,205,10);building.mesh=source_mesh;building.position.y=102.5;node.objects.add_child(building)
	var original_size=source_mesh.size;var original_transform=building.transform
	node._cache_scene_top_y();node._update_camera()
	var failures=[]
	if absf(node.scene_top_y-205.0)>0.00001 or node.camera.position.y-node.camera.near<206.0-0.0001:failures.append("source roof intersects the top camera or near plane")
	if source_mesh.size!=original_size or building.transform!=original_transform:failures.append("camera adjustment changed source geometry")
	if absf(node.camera.size-10.0/node.get_viewport().get_visible_rect().size.aspect())>0.00001:failures.append("orthographic map width changed")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"fixture":"unmodified 205m source-box bounds; camera-only test, not real-city geometry qualification","sourceTopY":node.scene_top_y,"cameraY":node.camera.position.y,"near":node.camera.near,"orthoSize":node.camera.size}))
	for child in [node.sun,node.live_request,node.hud]:
		if is_instance_valid(child) and child.get_parent()==null:child.free()
	node.free();quit(0 if failures.is_empty() else 1)
