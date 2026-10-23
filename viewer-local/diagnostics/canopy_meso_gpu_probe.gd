extends SceneTree
func _initialize():call_deferred("run")
func run():
	root.size=Vector2i(512,512);var world=Node3D.new();root.add_child(world);var camera=Camera3D.new();camera.projection=Camera3D.PROJECTION_ORTHOGONAL;camera.size=2;camera.position=Vector3(0,0,2);world.add_child(camera)
	var mesh=MeshInstance3D.new();mesh.mesh=QuadMesh.new();mesh.mesh.size=Vector2(2,2);world.add_child(mesh)
	var material=ShaderMaterial.new();var shader=Shader.new();shader.code='shader_type spatial;render_mode unshaded;\n#include "res://shaders/color_space.gdshaderinc"\n#include "res://shaders/canopy_meso.gdshaderinc"\nuniform float cover=.27;uniform float footprint=1.25;uniform vec2 local_base=vec2(0.0);void fragment(){float c=canopy_meso_cover(UV*640.0+local_base,footprint,cover);ALBEDO=display_color(vec3(c));}';material.shader=shader;mesh.material_override=material
	var origin=Vector2(20000.25,-4095.75);material.set_shader_parameter("canopy_meso_phase",Vector4(fposmod(origin.x/16,1),fposmod(origin.y/16,1),posmod(floori(origin.x/16),1048576),posmod(floori(origin.y/16),1048576)))
	var samples=[];var maximum=0.0
	for seed in [1,69,2026]:
		material.set_shader_parameter("canopy_meso_seed",seed)
		for cover in [.03,.1,.27,.5,.8,.97]:
			for footprint in [.1,1.25,4.0,8.0,20.0]:
				material.set_shader_parameter("cover",cover);material.set_shader_parameter("footprint",footprint)
				for i in 2:await process_frame
				await RenderingServer.frame_post_draw
				var image=root.get_texture().get_image();var sum=0.0;var count=0
				for y in range(2,510,4):
					for x in range(2,510,4):sum+=image.get_pixel(x,y).srgb_to_linear().r;count+=1
				var mean=sum/count;var error=absf(mean-cover)*100;maximum=maxf(maximum,error);samples.append({"seed":seed,"cover":cover,"footprintM":footprint,"mean":mean,"errorPoints":error})
	material.set_shader_parameter("cover",.27);material.set_shader_parameter("footprint",1.25)
	var rebase_error=0.0;var identity_cases=[]
	var canopy=load("res://adapters/surface_canopy.gd")
	for target in [20000000.25,1000000000.25]:
		var snapshots=[]
		for refined in [false,true]:
			var metadata={"seed":"canonical-seed-69","id":"fine-child" if refined else "retained-parent","terrain":{"source":{"version":"new-neural-v9" if refined else "parent-v1","sourceLOD":-6 if refined else 0}}}
			var origin_case={"x":target+(64.0 if refined else 0.0),"z":-target+(64.0 if refined else 0.0)}
			for key in canopy.meso_parameters(metadata,origin_case):material.set_shader_parameter(key,canopy.meso_parameters(metadata,origin_case)[key])
			material.set_shader_parameter("local_base",Vector2(-64.0,-64.0) if refined else Vector2.ZERO)
			for i in 3:await process_frame
			await RenderingServer.frame_post_draw
			snapshots.append(root.get_texture().get_image())
		var error=0.0
		for y in range(2,510,4):
			for x in range(2,510,4):error=maxf(error,absf(snapshots[0].get_pixel(x,y).r-snapshots[1].get_pixel(x,y).r)*255)
		rebase_error=maxf(rebase_error,error);identity_cases.append({"worldPositionM":target,"differentWorldIds":true,"differentSourceVersionsAndLOD":true,"sameCanonicalSeed":true,"originDeltaM":64,"maximumByteError":error})
	var report={"version":"canopy-meso-fullcell-jitter-cdf-1","passed":maximum<2.0 and rebase_error<=2,"maximumCoverageErrorPoints":maximum,"maximumRebaseByteError":rebase_error,"samples":samples,"refinementIdentityCases":identity_cases,"godot":Engine.get_version_info().string,"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"scope":"renderer-only approximate canopy, canonical mean coverage; no candidate identity claimed"}
	var args=OS.get_cmdline_user_args()
	if not args.is_empty():var file=FileAccess.open(args[0],FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify({"passed":report.passed,"maximumCoverageErrorPoints":maximum,"maximumRebaseByteError":rebase_error}));quit(0 if report.passed else 1)
