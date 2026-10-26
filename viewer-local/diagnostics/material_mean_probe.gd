extends SceneTree

const Library = preload("res://adapters/material_library.gd")

class Parameters:
	extends RefCounted
	var target: ShaderMaterial
	func _init(material: ShaderMaterial) -> void: target=material
	func set_shader_param(name: String, value) -> void: target.set_shader_parameter(name,value)

func _initialize() -> void: call_deferred("_run")

func _run() -> void:
	var args := OS.get_cmdline_user_args()
	var manifest := args[0] if args.size()>0 else ""
	root.size=Vector2i(512,512)
	var world := Node3D.new()
	root.add_child(world)
	var camera := Camera3D.new()
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL
	camera.size=8.0
	camera.position=Vector3(0,0,2)
	world.add_child(camera)
	camera.look_at(Vector3.ZERO)
	var instance := MeshInstance3D.new()
	var quad := QuadMesh.new()
	quad.size=Vector2(8,8)
	instance.mesh=quad
	var material := ShaderMaterial.new()
	var shader := Shader.new()
	shader.code='shader_type spatial;render_mode unshaded;\n'+FileAccess.get_file_as_string("res://shaders/surface_uniforms.gdshaderinc")+'\nuniform float test_footprint_m=0.001; uniform float test_rebase_m=0.0; void fragment(){vec3 p=vec3(UV.x*256.0-test_rebase_m,0.0,UV.y*256.0);vec4 a;vec4 n;sample_surface_material(p,vec3(test_footprint_m,0,0),vec3(0,0,test_footprint_m),vec3(0,1,0),vec3(1,0,0),vec3(0,0,-1),0,a,n);ALBEDO=display_color(vec3(0.25)+a.rgb*0.125);}'
	material.shader=shader
	instance.material_override=material
	world.add_child(instance)
	var library := Library.new()
	library.load_manifest(manifest)
	var parameters := Parameters.new(material)
	var samples: Array = []
	var maximum_error := 0.0
	var maximum_phase_error := 0
	for layer in range(library.loaded_assets.size()+1):
		var family: String = "fallback" if layer==0 else library.loaded_assets[layer-1]
		var recipe := {"id":"probe","family":family,"colorLinear":[0.25,0.25,0.25],"roughness":0.8,"physicalExtentMetres":4.0}
		var source := {"materials":[recipe]}
		var scale := float(library.scales.get(family,4.0))
		for footprint in [scale/2048.0,scale/128.0,scale/4.0]:
			library.configure(parameters,source,{"x":4095.75,"y":10.0,"z":-4095.25})
			material.set_shader_parameter("test_footprint_m",footprint)
			material.set_shader_parameter("test_rebase_m",0.0)
			for i in 3: await process_frame
			await RenderingServer.frame_post_draw
			var image := root.get_texture().get_image()
			var sum := Vector3.ZERO
			var count := 0
			for y in range(2,image.get_height()-2,4):
				for x in range(2,image.get_width()-2,4):
					var c := image.get_pixel(x,y).srgb_to_linear()
					sum+=Vector3(c.r,c.g,c.b)
					count+=1
			var mean := sum/float(count)
			var error := maxf(maxf(absf(mean.x-0.25),absf(mean.y-0.25)),absf(mean.z-0.25))/0.25
			maximum_error=maxf(maximum_error,error)
			samples.append({"asset":family,"footprintM":footprint,"linearMean":[mean.x,mean.y,mean.z],"relativeError":error})
			if layer==0 or family=="grass":
				library.configure(parameters,source,{"x":4159.75,"y":10.0,"z":-4095.25})
				material.set_shader_parameter("test_rebase_m",64.0)
				for i in 3: await process_frame
				await RenderingServer.frame_post_draw
				var rebased := root.get_texture().get_image()
				var before := image.get_data()
				var after := rebased.get_data()
				for i in before.size(): maximum_phase_error=maxi(maximum_phase_error,absi(int(before[i])-int(after[i])))
	var report := {"backend":RenderingServer.get_current_rendering_method(),"adapter":RenderingServer.get_video_adapter_name(),"probe":"production stochastic sampler, linear RGBA16F mips, numeric uniform upload","samples":samples,"maximumRelativeMeanError":maximum_error,"maximumRebaseByteError":maximum_phase_error,"threshold":0.03,"passed":maximum_error<0.03 and maximum_phase_error<=2}
	var path := args[1] if args.size()>1 else "res://captures/material-mean-probe.json"
	path=ProjectSettings.globalize_path(path)
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var file := FileAccess.open(path,FileAccess.WRITE)
	file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify({"event":"material-mean-probe","maximumRelativeMeanError":maximum_error,"maximumRebaseByteError":maximum_phase_error,"passed":report.passed,"report":path}))
	quit(0 if report.passed else 1)
