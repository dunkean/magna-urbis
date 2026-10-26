extends SceneTree
var failures:Array[String]=[]
var metrics:Dictionary={}
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func capture(name:String)->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw
	var im=root.get_texture().get_image();im.save_png("res://evidence/support-"+name+".png");return im
func difference(a:Image,b:Image)->float:
	var sum=0.0;var count=0
	for y in range(80,720,4):
		for x in range(80,1200,4):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);sum+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return sum/count
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(3)
	for child in app.get_children():
		if child is CanvasLayer:child.visible=false
	app.material.set_shader_parameter("water_time_override",0.0)
	for channel in 4:
		var point=Vector2.ZERO;var best=0.0;var label=["massive","bedded","clastic","soft"][channel]
		for y in range(100,1234,9):
			for x in range(100,1234,9):
				var p=app.meso.profiles.get_pixel(x,y);var c=app.meso.image.get_pixel(x,y);var water=app.ground_water_image.get_pixel(x,y)
				var score=p[channel]*c.r*(1-water.a)*(1-app.ground_snow_image.get_pixel(x,y).r)
				if score>best:best=score;point=Vector2(x+.5,y+.5)/1334*40000
		app.focus=Vector3(point.x,0,point.y);app.view_width=1400;app.top_view=false;app.elevation=.85;app.yaw=.4
		app.meso.profiles_enabled=false;app.material.set_shader_parameter("meso_profiles_enabled",false);app.vertex_height_cache.clear();app.update_camera();var before=await capture(label+"-without")
		app.meso.profiles_enabled=true;app.material.set_shader_parameter("meso_profiles_enabled",true);app.vertex_height_cache.clear();app.update_camera();var after=await capture(label+"-with")
		var d=difference(before,after);metrics[label]={"meanRgbDifference":d,"point":[point.x,point.y],"score":best}
		check(d>.00003 and d<.08,"Support detail is visible and restrained on "+label)
		var stable=await capture(label+"-stable");check(after.get_data()==stable.get_data(),"Support is stable at rest on "+label)
	var report={"status":"passed" if failures.is_empty() else "failed","metrics":metrics,"failures":failures};var f=FileAccess.open("res://evidence/meso-support-view-report.json",FileAccess.WRITE);f.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
