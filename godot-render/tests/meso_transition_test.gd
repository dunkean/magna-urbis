extends SceneTree
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func difference(a:Image,b:Image)->float:
	var sum=0.0;var count=0
	for y in range(120,680,6):
		for x in range(520,1180,6):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);sum+=(absf(ca.r-cb.r)+absf(ca.g-cb.g)+absf(ca.b-cb.b))/3;count+=1
	return sum/count
func capture()->Image:
	await process_frame;await process_frame;await RenderingServer.frame_post_draw;return root.get_texture().get_image()
func local_changes(a:Image,b:Image)->Vector3:
	var values:Array[float]=[];var large=0
	for y in range(120,680,4):
		for x in range(520,1180,4):
			var ca=a.get_pixel(x,y);var cb=b.get_pixel(x,y);var d=maxf(absf(ca.r-cb.r),maxf(absf(ca.g-cb.g),absf(ca.b-cb.b)))
			values.append(d)
			if d>.15:large+=1
	values.sort();return Vector3(values[int(values.size()*.99)],float(large)/values.size(),values[-1])
func run()->void:
	root.size=Vector2i(1280,800);var app=load("res://tile_viewer.gd").new();root.add_child(app);await process_frame;app.set_process(false);app.select_ground_view(3)
	app.material.set_shader_parameter("water_time_override",0.0)
	var views:Array=[]
	for scene in [[4,false],[4,true],[6,true]]:
		app.load_tile(scene[0]);app.top_view=not scene[1];app.yaw=.4 if scene[1] else 0.0;app.elevation=.8 if scene[1] else PI/2
		var point=Vector2(21000,20000)
		if scene[0]==6:
			var best=0.0
			for y in range(100,1234,17):
				for x in range(100,1234,17):
					var score=app.meso.image.get_pixel(x,y).r
					if score>best:best=score;point=Vector2(x+.5,y+.5)/1334.0*40000
		app.focus=Vector3(point.x,0,point.y);app.view_width=1800;app.update_camera();var first=await capture()
		var canonical=app.meso.sample_field(point);var previous=app.terrain_detail_height(point.x,point.y);var largest_step=0.0
		for i in range(65):
			app.view_width=exp(lerpf(log(16000.0),log(80.0),float(i)/64));app.focus=Vector3(point.x+sin(i*.11)*12,0,point.y);app.update_camera()
			var value=app.terrain_detail_height(point.x,point.y)
			if i>0:largest_step=maxf(largest_step,absf(value-previous))
			previous=value;check(app.meso.sample_field(point)==canonical,"Canonical field does not depend on camera")
			await process_frame
		app.focus=Vector3(point.x,0,point.y);app.view_width=1800;app.update_camera();var returned=await capture();var roundtrip=difference(first,returned)
		var full_image_equal=first.get_data()==returned.get_data()
		check(full_image_equal,"Zoom/pan roundtrip reproduces the complete image byte for byte")
		check(largest_step<.20,"Geometry morph has no sudden height jump during zoom")
		views.append({"tile":scene[0],"perspective":scene[1],"roundtripRgbError":roundtrip,"fullImageEqual":full_image_equal,"maxGeometryStepMetres":largest_step})
		if scene[1]:returned.save_png("res://evidence/meso-transition-oblique-"+str(scene[0])+".png")
	app.load_tile(4)
	var metadata:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(app.tile_dir.path_join("forest-placement.json")));var p=metadata.examples.bare
	app.focus=Vector3(p[0],0,p[1]);app.view_width=240;app.update_camera();var last=await capture();var pan_difference=0.0;var local=Vector3.ZERO
	for i in 20:
		app.focus.x+=.025;app.update_camera();var next=await capture();pan_difference=maxf(pan_difference,difference(last,next));var change=local_changes(last,next);local=Vector3(maxf(local.x,change.x),maxf(local.y,change.y),maxf(local.z,change.z));last=next
	check(pan_difference<.025,"Subpixel pan does not produce fracture/texture flicker")
	check(local.x<.08 and local.y<.02,"Local 99th percentile and large-change fraction remain bounded during subpixel pan")
	var report={"status":"passed" if failures.is_empty() else "failed","views":views,"maxSubpixelPanRgbChange":pan_difference,"localP99ChannelChange":local.x,"fractionAbovePoint15":local.y,"maxChannelChange":local.z,"failures":failures}
	var file=FileAccess.open("res://evidence/meso-transition-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
