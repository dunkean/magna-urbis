extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const H=preload("res://captures/native-v11-profile/surface_hydrology.gd")
const G=preload("res://adapters/surface_geometry.gd")
class Consumer extends "res://scene/main.gd":
 func _begin_prepare()->void:pass
func _initialize():call_deferred("run")
func run():
 var args=OS.get_cmdline_user_args();var config=JSON.parse_string(FileAccess.get_file_as_string(args[0]))
 var initial=Data.read_json(config.initial);var consumer=Consumer.new();consumer.packet=initial;consumer.world=Data.unpack_world(initial)
 consumer._resolve_scene(initial);consumer._resolve_context(consumer.world);consumer.world["_terrainParents"]=consumer._external_parents(initial,consumer.world)
 consumer.loaded_live_binding=JSON.parse_string(FileAccess.get_file_as_string(config.metrics)).loadedLiveBinding;consumer.last_live_applied_serial=0
 var case=config.cases[0];consumer.live_serial=int(case.serial);consumer._accept_packet(Data.read_json(case.path),{"kind":"live","serial":case.serial,"lineage":consumer._source_scene_lineage()})
 var world=consumer.world.duplicate(false);var origin=config.previousOrigin
 world["_displaySource"]=Data.build_display_source(world,Data.display_spacing(world.terrain,case.width,128));world["_heightLayers"]=G.prepare_height_layers(world)
 var fallback=G.build_water(world,origin,case.focus,case.width);var records=[]
 for attempt in 12:
  var begin=Time.get_ticks_usec();var value=H.prepare(consumer.packet,world,origin,case.focus,case.width,fallback)
  var row={"attempt":attempt,"elapsedMs":(Time.get_ticks_usec()-begin)/1000.0,"phases":H.profile.duplicate(),"vertices":value.vertices.size(),"contourHash":value.sourceContourSha256}
  records.append(row);print(JSON.stringify(row))
 var f=FileAccess.open("res://captures/hydro-cache-repeat-result.json",FileAccess.WRITE);f.store_string(JSON.stringify({"records":records},"  "));f=null
 for key in ["camera","objects","sun","live_request","hud"]:consumer.get(key).free()
 consumer.free();quit()
