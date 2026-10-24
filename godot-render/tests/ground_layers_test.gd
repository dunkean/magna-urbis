extends SceneTree
var app:Node3D
var failures:Array[String]=[]
func _initialize()->void:call_deferred("run")
func check(ok:bool,message:String)->void:
	if not ok:failures.append(message);push_error(message)
func choose(id:String)->void:
	for i in app.tile_layers.size():
		if app.tile_layers[i].id==id:app.select_info_layer(i+1);return
	check(false,"Missing layer: "+id)
func capture(name:String)->void:
	await process_frame;await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png("res://evidence/ground-"+name+".png")
func run()->void:
	root.size=Vector2i(1280,800)
	app=load("res://tile_viewer.gd").new();root.add_child(app)
	await process_frame
	app.load_tile(0);app.reset_view()
	check(app.tile_layers.size()==47,"All water, ground and N1–N4/surface layers available")
	var mesh=app.terrain.mesh.get_instance_id()
	for i in app.tile_layers.size():
		app.select_info_layer(i+1)
		var descriptor:Dictionary=app.tile_layers[i]
		check(app.selected_info==descriptor.id,"Selected "+descriptor.id)
		check(app.info_palette.get_child_count()==descriptor.get("palette",[]).size(),"Palette "+descriptor.id)
		var texture=app.material.get_shader_parameter("info_image")
		check(texture.get_width()==1334 and texture.get_height()==1334,"Native grid "+descriptor.id)
		check(app.info_legend.text==descriptor.legend,"Legend "+descriptor.id)
		check(app.material.get_shader_parameter("info_smooth")== (descriptor.get("filter","")=="linear"),"Semantic filtering "+descriptor.id)
		await process_frame
	for id in ["geomorphons-150","geomorphons-600","geomorphons-2000","bedrock","bedrock-units","hardness","process","provenance","hand","twi","moisture","texture"]:
		choose(id)
		await capture(id+"-top")
		check(app.hud.get_parent().get_parent().get_combined_minimum_size().y<=root.size.y-32,"Legend panel fits viewport: "+id)
	choose("bedrock");app.view_width=7000;app.focus=Vector3(24000,0,20000);app.update_camera()
	await capture("bedrock-close")
	app.reset_view()
	choose("bedrock");app.toggle_mode()
	await capture("bedrock-oblique")
	choose("hand");await capture("hand-oblique")
	app.load_tile(1)
	check(app.selected_info=="hand","Ground selection survives climate change")
	check(app.terrain.mesh.get_instance_id()==mesh,"Same terrain geometry")
	app.select_info_layer(0)
	check(app.info_palette.get_child_count()==0,"None clears palette")
	check(app.material.get_shader_parameter("info_opacity")==0.0,"None restores original Render")
	var report={"status":"passed" if failures.is_empty() else "failed","layers":47,"failures":failures}
	var file=FileAccess.open("res://evidence/ground-gpu-report.json",FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "))
	print(JSON.stringify(report));app.queue_free();await process_frame;quit(0 if failures.is_empty() else 1)
