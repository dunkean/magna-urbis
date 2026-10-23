extends SceneTree
const Layers=preload("res://adapters/surface_layers.gd")
var viewer:Node
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var out_index=args.find("--opacity-report");var output=args[out_index+1]
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	var start=Time.get_ticks_msec()
	while (viewer.get("terrain")==null or viewer.get("worker")!=null or bool(viewer.get("view_dirty")) or bool(viewer.get("water_projection_busy"))) and Time.get_ticks_msec()-start<60000:await process_frame
	if viewer.get("terrain")==null:push_error("Authored opacity fixture failed");quit(2);return
	var world:Dictionary=viewer.get("world");var fields:Dictionary=world.fields
	assert(world.surfaceLayers.groundAvailability=="explicit" and world.surfaceLayers.lowCoverAvailability=="explicit")
	var environment:Environment=viewer.get("environment_settings");environment.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.tonemap_exposure=1.0
	var material=viewer.get("terrain").get("material");var captures={};var results=[];var mean_error=0.0
	for diagnostic in [0,17,18,19]:
		material.call("set_shader_param","diagnostic",diagnostic)
		for state in ["all","no-low","no-ground"]:
			viewer.call("set_layer_visibility",state!="no-ground",state!="no-low",false)
			for i in 3:await process_frame
			await RenderingServer.frame_post_draw
			var image=root.get_texture().get_image();captures[str(diagnostic)+state]=image
			var file=ProjectSettings.globalize_path(output+"-"+str(diagnostic)+"-"+state+".png");image.save_png(file)
			if diagnostic==17 and state=="all":
				var ground=Layers._linear(int(fields.groundMaterialMeanColor[0]));var low=Layers._linear(int(fields.lowCoverMaterialMeanColor[0]))
				for y in range(16,496,4):
					for x in range(16,496,4):
						var alpha=clampf((float(x)+.5-64.0)/384.0,0,1);var expected=ground.lerp(low,alpha).linear_to_srgb();var actual=image.get_pixel(x,y)
						mean_error=maxf(mean_error,maxf(absf(expected.r-actual.r),maxf(absf(expected.g-actual.g),absf(expected.b-actual.b)))*255)
		var zero_error=0.0;var one_error=0.0
		for y in range(16,496,4):
			for x in range(16,56,2):
				var a=captures[str(diagnostic)+"all"].get_pixel(x,y);var b=captures[str(diagnostic)+"no-low"].get_pixel(x,y);zero_error=maxf(zero_error,maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b)))*255)
			for x in range(456,496,2):
				var a=captures[str(diagnostic)+"all"].get_pixel(x,y);var b=captures[str(diagnostic)+"no-ground"].get_pixel(x,y);one_error=maxf(one_error,maxf(absf(a.r-b.r),maxf(absf(a.g-b.g),absf(a.b-b.b)))*255)
		results.append({"diagnostic":diagnostic,"opacityZeroLowCoverHasNoEffectByteError":zero_error,"opacityOneGroundHasNoEffectByteError":one_error})
	var passed=mean_error<=1.0
	for result in results:passed=passed and result.opacityZeroLowCoverHasNoEffectByteError==0.0 and result.opacityOneGroundHasNoEffectByteError==0.0
	var report={"passed":passed,"maximumMeanCompositorByteError":mean_error,"results":results,"surfaceLayers":world.surfaceLayers,"worldId":world.id,"godot":Engine.get_version_info().string,"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"scope":"Authored non-IG 17x17 source using the NEW nine arrays through production Data/main/shader bindings; opacity0/1 in actual PBR beauty, roughness and normal, plus independent linear mean transition. Not a neural terrain fixture."}
	var file=FileAccess.open(output,FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));quit(0 if passed else 1)
