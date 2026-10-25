extends SceneTree
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var im=root.get_texture().get_image();im.save_png("res://evidence/water-surface-"+name+".png");return im
func difference(a:Image,b:Image)->float:
	var sum=0.0;var count=0
	for y in range(50,750,4):
		for x in range(50,1230,4):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);sum+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return sum/count
func correlation(im:Image,lag:int)->float:
	var a=0.0;var b=0.0;var aa=0.0;var bb=0.0;var ab=0.0;var n=0
	for y in range(0,32,3):
		for x in range(0,256-lag):
			var u=im.get_pixel(x,y).r;var v=im.get_pixel(x+lag,y).r;a+=u;b+=v;aa+=u*u;bb+=v*v;ab+=u*v;n+=1
	return (ab-a*b/n)/sqrt(maxf((aa-a*a/n)*(bb-b*b/n),1e-20))
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1)
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	app.material.set_shader_parameter("water_time_override",0.0);app.material.set_shader_parameter("water_domain_probe",true)
	var lake=Vector2.ZERO
	for y in range(20,1314,7):
		for x in range(20,1314,7):
			if app.ground_water_image.get_pixel(x,y).g>.99:lake=Vector2(x+.5,y+.5)/1334*40000;break
		if lake!=Vector2.ZERO:break
	app.focus=Vector3(lake.x,0,lake.y);app.view_width=80;app.update_camera();var im=await capture("lake-domain");var domain=im.get_pixel(640,400)
	check(lake!=Vector2.ZERO and domain.g>.99 and domain.r<.001,"Lake remains the lake channel after shore reconstruction")
	app.load_tile(6);var sea=Vector2.ZERO;var coast=Vector2.ZERO;var best=0.0
	var shore=app.load_local_png(app.tile_dir.path_join("surface-shoreline.png"))
	for y in range(30,1304,3):
		for x in range(30,1304,3):
			var w=app.ground_water_image.get_pixel(x,y)
			if w.b>.99 and sea==Vector2.ZERO:sea=Vector2(x+.5,y+.5)/1334*40000
			var sx=app.ground_water_image.get_pixel(x+1,y).b-app.ground_water_image.get_pixel(x-1,y).b
			var sz=app.ground_water_image.get_pixel(x,y+1).b-app.ground_water_image.get_pixel(x,y-1).b
			var score=absf(sx*sz)
			if score>best:best=score;coast=Vector2(x+.5,y+.5)/1334*40000
	app.focus=Vector3(sea.x,0,sea.y);app.view_width=80;app.update_camera();im=await capture("sea-domain");domain=im.get_pixel(640,400)
	check(sea!=Vector2.ZERO and domain.r>.99 and domain.g<.001,"Sea remains the sea channel after shore reconstruction")
	app.material.set_shader_parameter("water_domain_probe",false);app.focus=Vector3(coast.x,0,coast.y)
	for width in [1400.0,16000.0]:
		app.view_width=width;app.update_camera();app.material.set_shader_parameter("water_shore_smooth",false);var before=await capture("coast-old-"+str(int(width)))
		app.material.set_shader_parameter("water_shore_smooth",true);var after=await capture("coast-smooth-"+str(int(width)));var d=difference(before,after)
		metrics["shoreRgbDifference"+str(int(width))]=d;check(d>.000001 and d<.06,"Shore correction is present and local at width "+str(width))
	app.view_width=1400;app.update_camera();var initial=await capture("coast-roundtrip-start")
	for width in [300.0,800.0,2200.0,6000.0,18000.0,65000.0,4000.0]:app.view_width=width;app.update_camera();await process_frame
	app.view_width=1400;app.update_camera();var returned=await capture("coast-roundtrip-end");check(initial.get_data()==returned.get_data(),"Shore/water zoom roundtrip reproduces the full image")
	var probe=SubViewport.new();probe.size=Vector2i(256,32);probe.use_hdr_2d=true;probe.render_target_update_mode=SubViewport.UPDATE_ALWAYS;root.add_child(probe);var rect=ColorRect.new();rect.size=probe.size;probe.add_child(rect)
	var m=ShaderMaterial.new();m.shader=load("res://tests/water_surface_probe.gdshader");rect.material=m;m.set_shader_parameter("probe_size",Vector2(256,32));m.set_shader_parameter("terrain_detail_seed",app.meso.seed)
	for key in ["water_detail","water_shoreline","water_reference_dry","water_reference_wet","water_shore_ready"]:m.set_shader_parameter(key,app.material.get_shader_parameter(key))
	var dry=app.load_local_png(app.tile_dir.path_join("surface-shore-dry.png"));var color_error=0.0;m.set_shader_parameter("probe_mode",4);m.set_shader_parameter("probe_step",0.0)
	for pixel in [Vector2i(701,801),Vector2i(350,450),Vector2i(1001,650)]:
		m.set_shader_parameter("probe_origin",(Vector2(pixel)+Vector2(.5,.5))/1334*40000);await process_frame;await process_frame;await RenderingServer.frame_post_draw
		var actual=probe.get_texture().get_image().get_pixel(0,0);var expected=dry.get_pixelv(pixel).srgb_to_linear();color_error=maxf(color_error,maxf(absf(actual.r-expected.r),maxf(absf(actual.g-expected.g),absf(actual.b-expected.b))))
	metrics.referenceLinearColorError=color_error;check(color_error<.002,"Coastal Render references decode sRGB into linear colour exactly once")
	m.set_shader_parameter("probe_mode",1);m.set_shader_parameter("probe_step",1.0);m.set_shader_parameter("probe_origin",Vector2(15001,23007))
	await process_frame;await process_frame;await RenderingServer.frame_post_draw;var waves=probe.get_texture().get_image();metrics.waveCorrelationAt37m=correlation(waves,37)
	check(absf(metrics.waveCorrelationAt37m)<.65,"Water does not repeat at the old 37m texture period")
	m.set_shader_parameter("probe_mode",3)
	var variances:Array=[]
	for footprint in [.05,.5,2.0,8.0,40.0]:
		m.set_shader_parameter("probe_footprint",footprint);m.set_shader_parameter("probe_step",4.0);await process_frame;await process_frame;await RenderingServer.frame_post_draw;im=probe.get_texture().get_image();var sum=0.0;var square=0.0;var count=0
		for y in range(0,32,2):
			for x in range(0,256,2):var v=im.get_pixel(x,y).g;sum+=v;square+=v*v;count+=1
		var variance=square/count-pow(sum/count,2);variances.append(variance);check(variance>1e-9,"Water retains resolved detail at footprint "+str(footprint))
	metrics.waterColorVariances=variances
	# An abrupt change in cached downstream direction represents a confluence.
	var flow=Image.create(1334,1334,false,Image.FORMAT_RGBA8);flow.fill(Color(1,.5,0,0));flow.fill_rect(Rect2i(667,0,667,1334),Color(.5,1,0,0));m.set_shader_parameter("water_detail",ImageTexture.create_from_image(flow));m.set_shader_parameter("probe_mode",2);m.set_shader_parameter("probe_step",.03125);m.set_shader_parameter("probe_origin",Vector2(19998,20000));m.set_shader_parameter("probe_footprint",.05)
	var error=0.0;var temporal=0.0;var bound=0.0
	for time in [0.0,60.0,3600.0]:
		m.set_shader_parameter("probe_time",time);await process_frame;await process_frame;await RenderingServer.frame_post_draw;var a=probe.get_texture().get_image()
		for y in range(1,31,2):
			for x in range(1,255,2):
				var c=a.get_pixel(x,y);var gx=(a.get_pixel(x+1,y).r-a.get_pixel(x-1,y).r)/.0625;var gz=(a.get_pixel(x,y+1).r-a.get_pixel(x,y-1).r)/.0625
				error=maxf(error,maxf(absf(gx-(c.g-.5)),absf(gz-(c.b-.5))));bound=maxf(bound,absf(c.r-.5))
		m.set_shader_parameter("probe_time",time+1.0/120);await process_frame;await process_frame;await RenderingServer.frame_post_draw;var b=probe.get_texture().get_image()
		for y in range(0,32,3):
			for x in range(0,256,3):temporal=maxf(temporal,absf(a.get_pixel(x,y).r-b.get_pixel(x,y).r))
	metrics.flowDerivativeError=error;metrics.flowTemporalStep=temporal;metrics.flowHeightBound=bound
	check(error<.025 and bound<=.2351 and temporal<.015,"Downstream confluence frames stay bounded and coherent at 0/60/3600 seconds")
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures};var f=FileAccess.open("res://evidence/water-surface-report.json",FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();probe.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
