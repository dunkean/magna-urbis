extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Population=preload("res://adapters/surface_population.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
class Crown:
	extends Node2D
	var radius_px:float
	func _draw():draw_circle(Vector2.ZERO,radius_px,Color.WHITE)
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var packet=Data.read_json(args[0]);var world=packet.world
	var population=Population.prepare(packet,{"x":20000.0,"y":20000.0},640.0,1024.0,false,true);var atlas=population.canopy
	var viewport=SubViewport.new();viewport.size=Vector2i(1024,1024);viewport.transparent_bg=true;viewport.disable_3d=true;viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(viewport)
	var shader=Shader.new();shader.code='shader_type canvas_item;\n#include "res://shaders/canopy.gdshaderinc"\nuniform float footprint=1.0;uniform bool target=false;uniform sampler2D field:filter_linear,repeat_disable;void fragment(){vec2 p=(UV-.5)*640.0;float mean=texture(field,((p+vec2(20000.0)-vec2(39.0625))/78.125+vec2(.5))/vec2(512.0)).r;float c=target?surface_canopy_target(p,footprint,mean):surface_canopy_residual(p,footprint,mean);COLOR=vec4(1.0,1.0,1.0,c);}'
	var mat=ShaderMaterial.new();mat.shader=shader
	var canonical=Data.context(world);var field=PackedFloat32Array(canonical.fields.treeCover);var field_image=Image.create_from_data(512,512,false,Image.FORMAT_RF,field.to_byte_array());mat.set_shader_parameter("field",ImageTexture.create_from_image(field_image))
	mat.set_shader_parameter("canopy_enabled",true);mat.set_shader_parameter("canopy_coverage",ImageTexture.create_from_image(atlas.coverageImage));mat.set_shader_parameter("canopy_counts",ImageTexture.create_from_image(atlas.countsImage));mat.set_shader_parameter("canopy_origin",Vector2(atlas.origin.x-20000,atlas.origin.z-20000));mat.set_shader_parameter("canopy_grid_size",atlas.gridSize);mat.set_shader_parameter("canopy_spacing_m",atlas.spacingM);mat.set_shader_parameter("canopy_bounds",Vector4(-160,-160,160,160));mat.set_shader_parameter("canopy_fallback_blend_m",atlas.fallbackBlendM)
	for key in Canopy.meso_parameters(world,{"x":20000.0,"z":20000.0}):mat.set_shader_parameter(key,Canopy.meso_parameters(world,{"x":20000.0,"z":20000.0})[key])
	var background=ColorRect.new();background.size=Vector2(1024,1024);background.material=mat;viewport.add_child(background)
	var crowns=[];var materials=[]
	for tree in population.families.tree:
		var crown_shader=Shader.new();crown_shader.code='shader_type canvas_item;\n#include "res://shaders/canopy.gdshaderinc"\nuniform float footprint=1.0;uniform int cls=0;void fragment(){COLOR=vec4(1.0,1.0,1.0,canopy_instance_weight(cls,footprint));}'
		var crown_mat=ShaderMaterial.new();crown_mat.shader=crown_shader;crown_mat.set_shader_parameter("cls",int(tree.canopyClass));materials.append(crown_mat)
		var crown=Crown.new();crown.radius_px=float(tree.crownRadiusM)*1024/640.0;crown.position=Vector2(float(tree.x)-19680.0,float(tree.z)-19680.0)*1024/640.0;crown.material=crown_mat;viewport.add_child(crown);crowns.append(crown)
	var results=[];var maximum=0.0
	for footprint in [.25,2.0,4.0,6.0,9.0,12.0,40.0]:
		mat.set_shader_parameter("footprint",footprint)
		for material in materials:material.set_shader_parameter("footprint",footprint)
		var means=[]
		for target in [false,true]:
			mat.set_shader_parameter("target",target)
			for crown in crowns:crown.visible=not target
			for i in 3:await process_frame
			await RenderingServer.frame_post_draw
			var image=viewport.get_texture().get_image();var sum=0.0;var count=0
			for y in range(0,1024,2):
				for x in range(0,1024,2):sum+=image.get_pixel(x,y).a;count+=1
			means.append(sum/count)
		var error=absf(means[0]-means[1])*100;maximum=maxf(maximum,error);results.append({"footprintM":footprint,"actualCombinedCoverage":means[0],"targetFilteredCoverage":means[1],"errorPoints":error})
	var report={"passed":maximum<=2.0,"maximumCoverageErrorPoints":maximum,"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"selectedExactTrees":crowns.size(),"exactTrees":atlas.treeCount,"paintBlendM":atlas.fallbackBlendM,"geometryBlendM":atlas.geometryBlendM,"results":results,"scope":"Real retained candidate page and canonical treeCover, exact selected discs composited over production residual and meso; flat canvas optical-area proof, no physical shadow or canopy architecture claim"}
	if args.size()>1:var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));quit(0 if report.passed else 1)
