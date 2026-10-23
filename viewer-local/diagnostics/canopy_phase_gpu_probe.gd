extends SceneTree
const Data=preload("res://adapters/surface_data.gd")
const Population=preload("res://adapters/surface_population.gd")
func _initialize():call_deferred("run")
func run():
	var args=OS.get_cmdline_user_args();var packet=Data.read_json(args[0]);var world=packet.world
	var population=Population.prepare(packet,{"x":20000.0,"y":20000.0},640.0,1024.0,false,true,{"minX":19552.0,"maxX":20448.0,"minZ":19552.0,"maxZ":20448.0});var atlas=population.canopy
	root.size=Vector2i(512,512);var scene=Node3D.new();root.add_child(scene)
	var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=2;camera.position=Vector3(0,0,2);scene.add_child(camera)
	var mesh=MeshInstance3D.new();mesh.mesh=QuadMesh.new();mesh.mesh.size=Vector2(2,2);scene.add_child(mesh)
	var shader=Shader.new();shader.code='shader_type spatial;render_mode unshaded;\n#include "res://shaders/canopy.gdshaderinc"\nuniform float footprint=1.0;void fragment(){vec2 p=(UV-.5)*640.0;float c=surface_canopy_target(p,footprint,.27);float v=surface_canopy_selected_visibility(p,footprint);float g=surface_canopy_residual(p,footprint,.27);float error=abs(v+(1.0-v)*g-c);ALBEDO=vec3(v>c+.00001 || error>.00001?1.0:0.0,0.0,0.0);}'
	var mat=ShaderMaterial.new();mat.shader=shader;mesh.material_override=mat
	var bindings={"canopy_enabled":true,"canopy_coverage":ImageTexture.create_from_image(atlas.coverageImage),"canopy_counts":ImageTexture.create_from_image(atlas.countsImage),"canopy_origin":Vector2(atlas.origin.x-20000,atlas.origin.z-20000),"canopy_grid_size":atlas.gridSize,"canopy_spacing_m":atlas.spacingM}
	for key in bindings:mat.set_shader_parameter(key,bindings[key])
	var rows=[];var violations=0
	for phase in [0.0,.5,1.0,1.25,1.5,1.75,2.0]:
		mat.set_shader_parameter("canopy_exact_weight",minf(phase,1));mat.set_shader_parameter("canopy_geometry_weight",maxf(0,phase-1))
		for footprint in [.25,.625,1.0,2.0,4.0]:
			mat.set_shader_parameter("footprint",footprint)
			for i in 2:await process_frame
			await RenderingServer.frame_post_draw
			var image=root.get_texture().get_image();var count=0
			for y in range(512):
				for x in range(512):
					if image.get_pixel(x,y).r>.5:count+=1
			violations+=count;rows.append({"phase":phase,"footprintM":footprint,"pointwiseViolations":count})
	var result={"passed":violations==0,"pointwiseViolations":violations,"samples":rows,"shaderPixelsPerCase":262144,"selectedTrees":atlas.selectedTreeCount,"exactSourceTrees":atlas.treeCount,"atlasSpacingM":atlas.spacingM,"scope":"Production shader V<=C and V+(1-V)*G=C at every GPU sampled point across both global phases; not a claim that stylized sphere silhouettes equal the atlas raster exactly","adapter":RenderingServer.get_video_adapter_name(),"backend":RenderingServer.get_current_rendering_method()}
	var file=FileAccess.open(args[1],FileAccess.WRITE);file.store_string(JSON.stringify(result,"  "));print(JSON.stringify({"passed":result.passed,"pointwiseViolations":violations}));quit(0 if result.passed else 1)
