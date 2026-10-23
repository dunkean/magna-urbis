extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const ScenePrepare=preload("res://adapters/surface_scene_prepare.gd")
const Presentation=preload("res://adapters/surface_presentation.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var packet=Data.read_json(args[0]);packet=Presentation.overrides(packet,"blueprint",args[1]);var world=Data.unpack_world(packet)
	var source_inventory=JSON.stringify(packet.get("candidates",packet.get("candidateColumns",{})))
	var request={"world":world,"packet":packet,"origin":{"x":2620.0,"y":0.0,"z":2782.0},"width":55.0,"generation":1,"skipContext":true,"displaySource":{},"skipHeight":true,"sceneRequest":{"buildWater":false,"buildUrban":false},"focus":{"x":2620.0,"y":2782.0},"viewportWidth":1280.0,"oblique":false,"presentationMode":"cartographic"}
	var result=ScenePrepare.prepare(request);var palette=Presentation.profile(packet,"cartographic").palette;var failures=[];var checked=0;var families={}
	for family in result.populations.families:
		var selected:Array=result.populations.families[family];var buffer:PackedFloat32Array=result.populations.buffers[family];families[family]=selected.size()
		var color=Presentation.color_linear(str(palette.get("treeFill" if family=="tree" or family=="shrub" else "grass" if family=="grass" else "inkSoft","")),Vector3(0.2,0.3,0.2))
		for i in selected.size():
			if absf(buffer[i*20+12]-color.x)>0.000001 or absf(buffer[i*20+13]-color.y)>0.000001 or absf(buffer[i*20+14]-color.z)>0.000001:failures.append("non-palette colour in "+family)
			checked+=1
	if checked==0:failures.append("fixture did not exercise visible objects")
	if JSON.stringify(packet.get("candidates",packet.get("candidateColumns",{})))!=source_inventory:failures.append("source inventory mutated")
	print(JSON.stringify({"passed":failures.is_empty(),"failures":failures,"objectsChecked":checked,"families":families,"scope":"real native city source through production ScenePrepare and MultiMesh raw buffers"}));quit(0 if failures.is_empty() else 1)
