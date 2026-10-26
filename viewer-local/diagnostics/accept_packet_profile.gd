extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
class Consumer:
	extends "res://scene/main.gd"
	func _begin_prepare()->void:pass
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var initial=Data.read_json(args[0]);var main=Consumer.new()
	main.set("options",{"--profile-native":true});main.set("packet",initial);main.set("world",Data.unpack_world(initial))
	main._resolve_scene(initial);main._resolve_context(main.get("world"))
	if initial.has("terrainParents"):main.get("world")["_terrainParents"]=initial.terrainParents
	var metrics=JSON.parse_string(FileAccess.get_file_as_string(args[1]));main.set("loaded_live_binding",metrics.loadedLiveBinding);main.set("last_live_applied_serial",0)
	for path in [args[2],args[3]]:
		var decoded=Data.read_json(path)
		print(JSON.stringify({"event":"replay-before-accept","worldId":decoded.world.id,"validated":decoded.world.get("_validated",false),"hasContext":decoded.world.has("canonicalContext")}))
		main.set("live_serial",37 if path.contains("37") else 90)
		main._accept_packet(decoded,{"kind":"live","serial":main.get("live_serial"),"lineage":main._source_scene_lineage()})
	var out=FileAccess.open(args[4],FileAccess.WRITE);out.store_string(JSON.stringify({"scope":"CPU replay of reconstructed V10 preview37/90, identical terrain/world hashes but NOT archived original HTTP BODYs; actual production accept methods with begin_prepare suppressed and NO displayed-source event","events":main.get("native_profile_events")},"  "))
	for key in ["camera","objects","sun","live_request","hud"]:
		var node=main.get(key)
		if node is Node and not node.is_inside_tree():node.free()
	main.free();quit()
