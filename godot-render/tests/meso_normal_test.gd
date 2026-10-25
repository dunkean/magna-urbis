extends SceneTree
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	app.sun.shadow_enabled=false
	var flat=Image.create(16,16,false,Image.FORMAT_RF);flat.fill(Color(100,0,0));app.height_image=flat
	app.material.set_shader_parameter("height_map",ImageTexture.create_from_image(flat));app.vertex_height_cache.clear()
	var ctx=Image.create(1334,1334,false,Image.FORMAT_RGBAF);ctx.fill(Color(.8,.3,.2,.5));app.meso.image=ctx;app.meso.texture=ImageTexture.create_from_image(ctx);app.material.set_shader_parameter("meso_context",app.meso.texture)
	app.material.set_shader_parameter("terrain_normal_probe",true)
	var maximum=0.0;var samples=0
	for width in [12000.0,6000.0,2000.0,800.0,160.0]:
		app.view_width=width;app.focus=Vector3(20000,0,20000);app.update_camera()
		await process_frame;await process_frame;await RenderingServer.frame_post_draw
		var im=root.get_texture().get_image();var actual_footprint=width/1280.0*sqrt(2);var footprint=actual_footprint*2/3
		var activity=1.0-smoothstep(8.0,24.0,actual_footprint)
		for pixel in [Vector2i(511,311),Vector2i(640,400),Vector2i(731,422),Vector2i(999,578)]:
			var origin=app.camera.project_ray_origin(Vector2(pixel)+Vector2(.5,.5));var gradient=app.meso.sample_field(Vector2(origin.x,origin.z),Vector4(footprint/sqrt(2),footprint/sqrt(2),0,0))
			var expected=Vector3(-gradient.y*activity,1,-gradient.z*activity).normalized();var c=im.get_pixelv(pixel);var actual=Vector3(c.r*2-1,c.g*2-1,c.b*2-1)
			maximum=maxf(maximum,actual.distance_to(expected));samples+=1
	check(maximum<.012,"Final normals match one physical field through mesh/pixel LOD transitions")
	var report={"status":"passed" if failures.is_empty() else "failed","maxFinalNormalError":maximum,"samples":samples,"failures":failures}
	var file=FileAccess.open("res://evidence/meso-normal-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
