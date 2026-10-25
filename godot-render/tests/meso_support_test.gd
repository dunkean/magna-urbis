extends SceneTree
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
	var probe=SubViewport.new();probe.size=Vector2i(48,16);probe.use_hdr_2d=true;probe.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(probe)
	var rect=ColorRect.new();rect.size=probe.size;probe.add_child(rect);var m=ShaderMaterial.new();m.shader=load("res://tests/meso_probe.gdshader");rect.material=m
	var ctx=Image.create(1334,1334,false,Image.FORMAT_RGBAF);ctx.fill(Color(1.7,.35,.2,.3));app.meso.image=ctx
	var profiles=Image.create(1334,1334,false,Image.FORMAT_RGBA8)
	var structure=Image.create(1334,1334,false,Image.FORMAT_RGBA8);structure.fill(Color(1,.5,.5,1));structure.fill_rect(Rect2i(667,0,667,1334),Color(0,.5,.5,1));app.meso.structure=structure
	m.set_shader_parameter("meso_context",ImageTexture.create_from_image(ctx));m.set_shader_parameter("meso_structure",ImageTexture.create_from_image(structure));m.set_shader_parameter("meso_ready",true);m.set_shader_parameter("terrain_detail_amount",1.0);m.set_shader_parameter("terrain_detail_seed",app.meso.seed);m.set_shader_parameter("probe_filtered",false)
	var height_error=0.0;var slope_error=0.0;var derivative_error=0.0;var bound=0.0;var shape_effect=0.0;var samples=0
	for profile in [Color(1,0,0,0),Color(0,1,0,0),Color(0,0,1,0),Color(0,0,0,1),Color(.3,.4,.2,.1)]:
		profiles.fill(profile)
		# Force a true native-profile edge for the mixed case.
		if profile.r>.1 and profile.g>.1:profiles.fill_rect(Rect2i(667,0,667,1334),Color(.05,.1,.35,.5))
		app.meso.profiles=profiles;m.set_shader_parameter("meso_profiles",ImageTexture.create_from_image(profiles))
		for origin in [Vector2(19980.5,20003.25),Vector2(120.5,376.5),Vector2(39940,12007)]:
			m.set_shader_parameter("probe_origin",origin);await process_frame;await process_frame;await RenderingServer.frame_post_draw;var im=probe.get_texture().get_image()
			for y in range(0,16,3):
				for x in range(0,48,3):
					var w=origin+Vector2(x,y)*.75;var cpu=app.meso.sample_field(w);var c=im.get_pixel(x,y)
					height_error=maxf(height_error,absf(c.r*8-4-cpu.x));slope_error=maxf(slope_error,maxf(absf(c.g*2-1-cpu.y),absf(c.b*2-1-cpu.z)))
					var gx=(app.meso.sample_field(w+Vector2(.125,0)).x-app.meso.sample_field(w-Vector2(.125,0)).x)/.25
					var gz=(app.meso.sample_field(w+Vector2(0,.125)).x-app.meso.sample_field(w-Vector2(0,.125)).x)/.25
					derivative_error=maxf(derivative_error,maxf(absf(gx-cpu.y),absf(gz-cpu.z)));bound=maxf(bound,absf(cpu.x));samples+=1
					var shaped=app.meso.support_noise(w,27,app.meso.seed+109);var plain=app.meso.noise_at(w,27,app.meso.seed+109);shape_effect=maxf(shape_effect,absf(shaped.x-plain.x))
	check(height_error<.01 and slope_error<.004,"Pure/mixed support fields agree between CPU and GPU")
	check(derivative_error<.008,"Support and changing-axis derivatives match finite differences at frame/profile borders")
	check(bound<=3 and shape_effect>.05,"Support shapes vary while preserving the displacement envelope")
	var report={"status":"passed" if failures.is_empty() else "failed","heightErrorMetres":height_error,"gradientError":slope_error,"fullDerivativeError":derivative_error,"sampledHeightBoundMetres":bound,"maxShapeEffect":shape_effect,"samples":samples,"failures":failures};var f=FileAccess.open("res://evidence/meso-support-report.json",FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();probe.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
