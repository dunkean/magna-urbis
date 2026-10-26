extends SceneTree
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var im=root.get_texture().get_image();im.save_png("res://evidence/rock-detail-"+name+".png");return im
func enable(app:Node3D,value:bool)->void:
	for key in ["rock_projection_enabled","rock_detail_enabled","rock_small_enabled"]:app.material.set_shader_parameter(key,value)
	app.meso.rock_small_enabled=value;app.vertex_height_cache.clear();app.update_camera()
func difference(a:Image,b:Image)->float:
	var sum=0.0;var count=0
	for y in range(50,750,4):
		for x in range(50,1230,4):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);sum+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return sum/count
func local_change(a:Image,b:Image)->float:
	var values:Array[float]=[]
	for y in range(80,720,4):
		for x in range(80,1200,4):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);values.append(maxf(absf(ca.r-cb.r),maxf(absf(ca.g-cb.g),absf(ca.b-cb.b))))
	values.sort();return values[int(values.size()*.99)]
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(1);app.material.set_shader_parameter("water_time_override",0.0)
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	var cases=load("res://tests/rock_cases.gd");var chosen=cases.steep_point(app,true);app.focus=Vector3(chosen.point.x,0,chosen.point.y);app.top_view=false;app.yaw=chosen.yaw;app.elevation=.55
	metrics.realSlopeDegrees=chosen.slopeDegrees;metrics.realPoint=[chosen.point.x,chosen.point.y]
	for width in [40.0,160.0]:
		app.view_width=width;enable(app,false);var before=await capture("lit-without-"+str(int(width)));enable(app,true);var after=await capture("lit-with-"+str(int(width)));metrics["rgbDifference"+str(int(width))]=difference(before,after)
		check(metrics["rgbDifference"+str(int(width))]>.0002,"Rock detail has a visible effect at width "+str(width))
		var stable=await capture("lit-stable-"+str(int(width)));check(after.get_data()==stable.get_data(),"Rock is temporally stable at rest")
	var origin=app.focus;var first=await capture("roundtrip-start")
	for width in [400.0,1800.0,8000.0,80.0,40.0]:app.view_width=width;app.focus.x+=1.25;app.update_camera();await process_frame
	app.focus=origin;app.view_width=160;app.update_camera();var returned=await capture("roundtrip-end");check(first.get_data()==returned.get_data(),"Zoom/pan returns exactly the same rock pixels")
	var previous=returned;var local=0.0
	for i in 12:
		app.focus.x+=.025;app.update_camera();var next=await capture("pan-"+str(i));local=maxf(local,local_change(previous,next));previous=next
	metrics.localPanP99=local;check(local<.10,"Subpixel pan remains stable across the anchored chart blends")
	# Extreme synthetic slope, with actual PBR weights, complements the native
	# mountain rather than pretending the native tile reaches every angle.
	cases.plane(app,80.0,.83);app.view_width=40;enable(app,false);await capture("plane80-without");enable(app,true);await capture("plane80-with")
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures};var f=FileAccess.open("res://evidence/rock-detail-view-report.json",FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
