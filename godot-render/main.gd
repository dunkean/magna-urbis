extends SceneTree
# Window/input envelope only. RenderOriginalRD owns the original render math.
class ViewRoot extends Control:
	var app:SceneTree
	func _input(event:InputEvent)->void:app.handle_input(event)

var renderer:RefCounted
var canvas:Control
var display:TextureRect
var hud:Label
var options:Dictionary={}
var focus_x:float=20000.0
var focus_y:float=20000.0
var width_m:float=40000.0
var pixels:=Vector2i(1280,800)
var view_dirty:=true
var frames_ready:int=0
var frame_limit:int=0
var capturing:=false
var exiting:=false
var drag:=false
var last_hud:=""

func _initialize()->void:call_deferred("start")
func fail(message:String)->void:
	push_error(message);exiting=true;quit(1)
func number(key:String,fallback:float)->float:
	var value=str(options.get(key,str(fallback)))
	return value.to_float() if value.is_valid_float() else NAN
func start()->void:
	var args=OS.get_cmdline_user_args();var i=0
	while i<args.size():
		var key=args[i]
		if key not in ["--scene","--width","--x","--z","--capture","--frames","--resolution"] or i+1>=args.size():fail("Unknown or incomplete option: "+key);return
		options[key]=args[i+1];i+=2
	if not options.has("--scene") or not FileAccess.file_exists(str(options["--scene"])):fail("Required local --scene JSON file is missing");return
	width_m=number("--width",40000.0);focus_x=number("--x",20000.0);focus_y=number("--z",20000.0)
	if not is_finite(width_m) or width_m<=0 or not is_finite(focus_x) or not is_finite(focus_y):fail("Width must be positive and focus coordinates finite");return
	var resolution=str(options.get("--resolution","1280x800")).split("x")
	if resolution.size()!=2 or not resolution[0].is_valid_int() or not resolution[1].is_valid_int():fail("Resolution must be WIDTHxHEIGHT");return
	pixels=Vector2i(int(resolution[0]),int(resolution[1]))
	if pixels.x<64 or pixels.y<64 or pixels.x>4096 or pixels.y>4096:fail("Resolution must be 64..4096 pixels per dimension");return
	var frames=str(options.get("--frames","2" if options.has("--capture") else "0"))
	if not frames.is_valid_int() or int(frames)<0:fail("Frames must be a nonnegative integer");return
	frame_limit=int(frames)
	if options.has("--capture") and frame_limit==0:fail("Capture requires a positive frame count");return
	root.size=pixels;root.unresizable=true
	canvas=ViewRoot.new();canvas.app=self;canvas.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT);root.add_child(canvas)
	display=TextureRect.new();display.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT);display.expand_mode=TextureRect.EXPAND_IGNORE_SIZE;display.stretch_mode=TextureRect.STRETCH_SCALE;display.flip_v=true;display.texture_filter=CanvasItem.TEXTURE_FILTER_NEAREST;display.mouse_filter=Control.MOUSE_FILTER_IGNORE;canvas.add_child(display)
	hud=Label.new();hud.position=Vector2(12,12);hud.mouse_filter=Control.MOUSE_FILTER_IGNORE;hud.add_theme_color_override("font_color",Color.WHITE);hud.add_theme_color_override("font_shadow_color",Color.BLACK);hud.add_theme_constant_override("shadow_offset_x",1);hud.add_theme_constant_override("shadow_offset_y",1);canvas.add_child(hud)
	var script=load("res://render_original_rd.gd")
	if script==null:fail("Original Render renderer script unavailable");return
	renderer=script.new()
	if not renderer.configure(str(options["--scene"]),pixels):fail("Original Render scene configuration rejected: "+str(renderer.failed));return
func _process(_delta:float)->bool:
	if exiting or renderer==null:return false
	if not str(renderer.failed).is_empty():fail(str(renderer.failed));return false
	if view_dirty:
		var mpp=width_m/float(pixels.x)
		renderer.set_view([focus_x-width_m*.5,focus_y-float(pixels.y)*mpp*.5],mpp)
		view_dirty=false;frames_ready=0
	if renderer.output_texture!=null and display.texture!=renderer.output_texture:display.texture=renderer.output_texture
	var text="Render original 2D · %.2f m · %.6f m/px · %s\nGlisser : déplacer · molette : zoom · H : aide · S : capture · Échap : quitter"%[width_m,width_m/float(pixels.x),"prêt" if renderer.ready else "chargement"]
	if text!=last_hud:hud.text=text;last_hud=text
	if renderer.ready and display.texture!=null:
		frames_ready+=1
		if frame_limit>0 and frames_ready>=frame_limit and not capturing:
			exiting=true;call_deferred("finish")
	return false
func handle_input(event:InputEvent)->void:
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_ESCAPE:exiting=true;quit()
			KEY_H:hud.visible=not hud.visible
			KEY_S:if not capturing and renderer!=null and renderer.ready:save_interactive()
	if event is InputEventMouseButton:
		if event.button_index==MOUSE_BUTTON_LEFT:drag=event.pressed
		if event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP,MOUSE_BUTTON_WHEEL_DOWN]:
			var old_mpp=width_m/float(pixels.x)
			var next_width=clampf(width_m*(.8 if event.button_index==MOUSE_BUTTON_WHEEL_UP else 1.25),.001,1e9)
			var next_mpp=next_width/float(pixels.x)
			focus_x+=(float(event.position.x)-float(pixels.x)*.5)*(old_mpp-next_mpp)
			focus_y+=(float(event.position.y)-float(pixels.y)*.5)*(old_mpp-next_mpp)
			width_m=next_width;view_dirty=true
	if event is InputEventMouseMotion and drag:
		var mpp=width_m/float(pixels.x)
		focus_x-=float(event.relative.x)*mpp;focus_y-=float(event.relative.y)*mpp;view_dirty=true
func save_interactive()->void:
	capturing=true
	var directory="user://captures";DirAccess.make_dir_recursive_absolute(directory)
	var path=directory+"/render-"+str(Time.get_unix_time_from_system()).replace(".","-")+".png"
	var result:Dictionary=await renderer.capture_png(path)
	print(JSON.stringify({"event":"render-original-capture","result":result,"stats":renderer.stats()}));capturing=false
func finish()->void:
	capturing=true
	await RenderingServer.frame_post_draw
	if options.has("--capture"):
		var result:Dictionary=await renderer.capture_png(str(options["--capture"]))
		print(JSON.stringify({"event":"render-original-capture","result":result,"stats":renderer.stats()}))
		if result.has("error"):quit(1);return
	else:print(JSON.stringify({"event":"render-original-ready","stats":renderer.stats()}))
	quit()
func _finalize()->void:
	if renderer!=null:renderer.cleanup()
