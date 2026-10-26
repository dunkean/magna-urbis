extends SceneTree
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func array_texture(color:Color)->Texture2DArray:
	var im=Image.create(8,8,false,Image.FORMAT_RGBAF);im.fill(color);var texture=Texture2DArray.new();texture.create_from_images([im]);return texture
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(3)
	var probe=SubViewport.new();probe.size=Vector2i(48,32);probe.use_hdr_2d=true;probe.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(probe);var rect=ColorRect.new();rect.size=probe.size;probe.add_child(rect);var m=ShaderMaterial.new();m.shader=load("res://tests/rock_chart_probe.gdshader");rect.material=m
	var cases=load("res://tests/rock_cases.gd");var neutral_error=0.0;var ramp_error=0.0;var metric_error=0.0;var samples=0;var production_error=0.0
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	app.material.set_shader_parameter("rock_normal_probe",true);app.material.set_shader_parameter("ground_stochastic",false)
	var palette=Image.create(90,4,false,Image.FORMAT_RGBAF)
	for i in 90:
		palette.set_pixel(i,0,Color(0,5,0,.45));palette.set_pixel(i,1,Color(.2,.2,.2,1));palette.set_pixel(i,2,Color(1,1,1,0));palette.set_pixel(i,3,Color(0,.2,.2,.2))
	app.material.set_shader_parameter("ground_palette",ImageTexture.create_from_image(palette));app.material.set_shader_parameter("ground_colors",array_texture(Color(.2,.2,.2,1)));app.material.set_shader_parameter("ground_heights",array_texture(Color(.5,.5,.5,1)))
	for degrees in [0.0,24.9,25.0,25.1,30.0,60.0,80.0]:
		for azimuth in [0.0,.83]:
			var gradient=cases.plane(app,degrees,azimuth);var n=Vector3(-gradient.x,1,-gradient.y).normalized();var t=Vector3(n.y,-n.x,0).normalized();var b=t.cross(n)
			m.set_shader_parameter("height_map",app.material.get_shader_parameter("height_map"));m.set_shader_parameter("surface_normal",n)
			var amount=smoothstep(.46630766,1.42814801,gradient.length());var qx=Vector3.RIGHT.lerp(t,amount);var qz=Vector3.BACK.lerp(b,amount)
			app.view_width=40;app.update_camera()
			for micro in [Vector3(0,0,1),Vector3(-.12,.08,1).normalized()]:
				app.material.set_shader_parameter("ground_normals",array_texture(Color(micro.x*.5+.5,micro.y*.5+.5,micro.z*.5+.5,.85)));await process_frame;await process_frame;await RenderingServer.frame_post_draw
				var c=root.get_texture().get_image().get_pixel(640,400);var actual=Vector3(c.r,c.g,c.b)*2-Vector3.ONE;var g=(-micro.x*qx+micro.y*qz)/micro.z
				var converted=Vector3(-g.dot(t),g.dot(b),1).normalized();var mixed=Vector3(0,0,1).lerp(converted,.6075).normalized();var expected=(t*mixed.x-b*mixed.y+n*mixed.z).normalized()
				production_error=maxf(production_error,actual.distance_to(expected))
				if actual.distance_to(expected)>.009:print(JSON.stringify({"degrees":degrees,"azimuth":azimuth,"micro":micro,"actual":actual,"expected":expected,"palette":app.material.get_shader_parameter("ground_palette").get_image().get_pixel(0,0)}))
			for warp in [Transform2D.IDENTITY,Transform2D(Vector2(1.04,-.025),Vector2(.035,.97),Vector2.ZERO)]:
				m.set_shader_parameter("probe_warp",warp)
				for micro in [Vector3(0,0,1),Vector3(-.12,.08,1).normalized()]:
					m.set_shader_parameter("input_micro",micro);m.set_shader_parameter("probe_mode",1);await process_frame;await process_frame;await RenderingServer.frame_post_draw;var im=probe.get_texture().get_image();var c=im.get_pixel(24,16);var actual=Vector3(c.r,c.g,c.b)*2-Vector3.ONE
					var g=(-micro.x*qx+micro.y*qz)/micro.z;var xz=Vector2(warp.x.dot(Vector2(g.x,g.z)),warp.y.dot(Vector2(g.x,g.z)));g=Vector3(xz.x,g.y,xz.y)
					var expected=(n-t*g.dot(t)-b*g.dot(b)).normalized();var error=actual.distance_to(expected)
					if micro==Vector3(0,0,1):neutral_error=maxf(neutral_error,error)
					else:ramp_error=maxf(ramp_error,error)
					samples+=1
				if degrees>=60 and warp==Transform2D.IDENTITY:
					m.set_shader_parameter("probe_mode",0);await process_frame;await process_frame;await RenderingServer.frame_post_draw;var im=probe.get_texture().get_image();var a=im.get_pixel(4,16);var c=im.get_pixel(44,16)
					metric_error=maxf(metric_error,absf((c.r-a.r)*4.0-.4));metric_error=maxf(metric_error,absf((c.g-a.g)*4.0))
	check(neutral_error<.002,"Neutral map preserves the physical normal at 0/30/60/80 degrees with both warps")
	check(ramp_error<.003,"Normal gradients have the same chart/warp pullback as UVs")
	check(metric_error<.006,"Two metres of steep surface retain two metres of physical texture scale")
	check(production_error<.009,"Actual terrain shader preserves neutral/ramp normals including the 25 degree transition")
	var report={"status":"passed" if failures.is_empty() else "failed","neutralNormalError":neutral_error,"rampNormalError":ramp_error,"productionNormalError":production_error,"metricUvError":metric_error,"samples":samples,"failures":failures};var f=FileAccess.open("res://evidence/rock-chart-report.json",FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();probe.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
