extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const ProfileData=preload("res://captures/native-v11-profile/surface_data.gd")
const Scene=preload("res://captures/native-v11-profile/surface_scene_prepare.gd")
const Canopy=preload("res://captures/native-v11-profile/surface_canopy.gd")
const Hydro=preload("res://captures/native-v11-profile/surface_hydrology.gd")
const Layers=preload("res://adapters/surface_layers.gd")
class Consumer extends "res://scene/main.gd":
 func _ready()->void:pass
 func _process(_delta:float)->void:pass
 func _begin_prepare()->void:pass
func _initialize():call_deferred("run")
func run():
 var args=OS.get_cmdline_user_args()
 var config=JSON.parse_string(FileAccess.get_file_as_string(args[0]))
 root.size=Vector2i(2048,1280)
 var start=Time.get_ticks_usec()
 var initial=Data.read_json(config.initial)
 var consumer=Consumer.new();consumer.world=Data.unpack_world(initial);consumer.packet=initial
 consumer._resolve_scene(initial);consumer._resolve_context(consumer.world)
 consumer.world["_terrainParents"]=consumer._external_parents(initial,consumer.world)
 consumer.rendered_world=consumer.world;consumer.rendered_world_id=str(consumer.world.id)
 consumer.loaded_live_binding=JSON.parse_string(FileAccess.get_file_as_string(config.metrics)).loadedLiveBinding
 consumer.last_live_applied_serial=0
 var layer_start=Time.get_ticks_usec();Layers.prepare(consumer.world,Data.context(consumer.world))
 var warm={"initialReadAndCachesMs":(Time.get_ticks_usec()-start)/1000.0,"initialLayerImageMs":(Time.get_ticks_usec()-layer_start)/1000.0}
 root.add_child(consumer)
 root.add_child(consumer.camera)
 var records=[]
 for case in config.cases:
  var read_start=Time.get_ticks_usec();var packet=Data.read_json(case.path)
  var read_ms=(Time.get_ticks_usec()-read_start)/1000.0
  consumer.live_serial=int(case.serial)
  consumer._accept_packet(packet,{"kind":"live","serial":case.serial,"lineage":consumer._source_scene_lineage()})
  var world:Dictionary=consumer.world
  consumer.focus=case.focus;consumer.width_m=case.width;consumer.origin=config.previousOrigin;consumer.oblique=false
  consumer._update_camera()
  consumer.camera.force_update_transform()
  print(JSON.stringify({"setup":true,"viewport":consumer.get_viewport().get_visible_rect().size,"camera":consumer.camera.global_transform,"page":Canopy.tree_page(consumer.packet)}))
  var atlas_bounds:Dictionary=consumer._canopy_atlas_request()
  var spacing=Data.display_spacing(world.terrain,case.width,int(case.samples))
  var step=spacing*64.0
  var ox=float(world.terrain.originX)+round((float(case.focus.x)-float(world.terrain.originX))/step)*step
  var oz=float(world.terrain.originZ)+round((float(case.focus.y)-float(world.terrain.originZ))/step)*step
  var origin={"x":ox,"y":Data.height_at(world,ox,oz),"z":oz}
  var request={"heightCoverageExtentM":case.width*2,"canopyAtlasBounds":atlas_bounds,"displaySamples":case.samples,"buildWater":true,"buildUrban":true,"focus":case.focus}
  var job={"world":world,"origin":origin,"width":case.width,"generation":0,"packet":consumer.packet,"skipContext":true,"displaySource":{},"skipHeight":false,"sceneRequest":request,"focus":case.focus,"viewportWidth":2048.0,"oblique":false,"groundOnly":false,"presentationMode":"aerial","projectRoads":true}
  for attempt in 2:
   var before=Time.get_ticks_usec();var result=Scene.prepare(job)
   var record={"serial":case.serial,"attempt":attempt,"widthM":case.width,"worldId":world.id,"candidateCount":int(consumer.packet.candidateColumns.count),"atlasRequest":atlas_bounds,"readDecodeMs":read_ms,"totalMs":(Time.get_ticks_usec()-before)/1000.0,"phases":result.cpuPhasesMs,"data":ProfileData.profile.duplicate(),"canopy":Canopy.profile.duplicate(),"hydrology":Hydro.profile.duplicate(),"heightImageSize":result.height.get_width(),"spacingM":result.spacing,"waterVertices":result.waterGeometry.vertices.size(),"waterGroups":result.waterGeometry.get("sourceGroups"),"atlasSize":result.populations.canopy.get("gridSize"),"atlasHash":result.populations.canopy.get("atlasHash")}
   records.append(record);print(JSON.stringify(record))
  consumer.rendered_world=consumer.world;consumer.rendered_world_id=str(world.id)
 var output={"scope":"CPU retained/reconstructed replay; no original BODY byte-exact claim, no GPU, no navigation proof. TOP camera reconstructed from production code at recorded focus/width and prior origin, cache warmup explicit.","warmup":warm,"records":records}
 var f=FileAccess.open(config.output,FileAccess.WRITE);f.store_string(JSON.stringify(output,"  "));f=null
 for key in ["camera","objects","sun","live_request","hud"]:
  var node=consumer.get(key)
  if node is Node:node.free()
 consumer.free();quit()
