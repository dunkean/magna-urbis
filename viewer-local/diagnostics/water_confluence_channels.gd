extends SceneTree
# Diagnostic channels on the six V12 review locations. Uses real retained vectors;
# no repair, centreline, carved bed or altered water level. GPU execution is opt-in.
const D=preload("res://adapters/surface_data.gd")
const G=preload("res://adapters/surface_geometry.gd")
const H=preload("res://adapters/surface_hydrology.gd")
const P=preload("res://adapters/surface_water_projection.gd")
const POINTS=[Vector2i(1562,451),Vector2i(1935,246),Vector2i(1014,1091),Vector2i(620,1193),Vector2i(1572,543),Vector2i(563,415)]
func _initialize():call_deferred("run")
func alpha_image(source:Image)->Image:
	var result=Image.create(source.get_width(),source.get_height(),false,Image.FORMAT_RGB8)
	for z in source.get_height():
		for x in source.get_width():
			var alpha=source.get_pixel(x,z).a
			result.set_pixel(x,z,Color(alpha,alpha,alpha,1))
	return result
func rgba(color:Color)->Array:return [color.r,color.g,color.b,color.a]
func run():
	var args=OS.get_cmdline_user_args()
	if args.size()!=2:push_error("Usage: packet.surfacebin output-directory");quit(2);return
	DirAccess.make_dir_recursive_absolute(args[1])
	var packet=D.read_json(args[0]);var world=D.unpack_world(packet)
	if world.is_empty():push_error("Real packet required");quit(2);return
	var source_before=P._sha(var_to_bytes(packet.source))
	var report={"format":"source-confluence-channels-1","scope":"Actual retained source fill and symbolic RGBA/alpha bakes, no terrain lighting or map-quality claim; image crop is a diagnostic camera window, not a source edit","sourcePacket":args[0],"sourceBefore":source_before,"referenceScreenMPP":10000.0/2048.0,"views":[]}
	var colors={"river":Vector3(.035,.17,.20),"lake":Vector3(.028,.10,.115),"sea":Vector3(.018,.095,.125),"fallback":Vector3(.028,.10,.115)}
	for pixel in POINTS:
		var focus={"x":15000.0+(pixel.x+.5)*10000.0/2048.0,"y":16875.0+(pixel.y+.5)*10000.0/2048.0}
		var origin={"x":float(focus.x),"y":0.0,"z":float(focus.y)}
		var geometry=H.prepare(packet,world,origin,focus,512.,G.build_water(world,origin,focus,512.));geometry.anchor=origin
		var vertices_before=P._sha(geometry.vertices.to_byte_array())
		var options={"sourceKey":"v12-confluence-%d-%d"%[pixel.x,pixel.y],"resolution":512,"msaa":4,"minHeightM":-10000.,"maxHeightM":10000.,"retainSourceImage":true,"symbolWidthPx":1.25,"screenMetresPerPixel":10000.0/2048.0,"screenScalePolicy":"orthographic-map-ground-scale"}
		var baked=await P.bake(root,geometry,origin,focus,512.,colors,options)
		if baked.has("error"):push_error(str(baked.error));quit(1);return
		var path=args[1].path_join("%d-%d"%[pixel.x,pixel.y])
		DirAccess.make_dir_recursive_absolute(path)
		var source:Image=baked.sourceImage;var final:Image=baked.texture.get_image()
		source.save_png(path.path_join("source-fill-rgba.png"));alpha_image(source).save_png(path.path_join("source-fill-alpha.png"))
		final.save_png(path.path_join("symbol-rgba.png"));alpha_image(final).save_png(path.path_join("symbol-alpha.png"))
		var classes={"available":geometry.get("classImage") is Image}
		if classes.available:
			var image:Image=geometry.classImage;var file=FileAccess.open(path.path_join("class-source-bytes.bin"),FileAccess.WRITE);file.store_buffer(image.get_data());file=null
			classes.merge({"format":image.get_format(),"width":image.get_width(),"height":image.get_height(),"origin":geometry.get("classOrigin"),"spacingM":geometry.get("classSpacingM"),"sha256":P._sha(image.get_data()),"encoding":"Raw original Image data, numeric class values; not inferred from water tint"})
		var source_after=P._sha(var_to_bytes(packet.source));var geometry_unchanged=vertices_before==P._sha(geometry.vertices.to_byte_array())
		if source_after!=source_before or not geometry_unchanged:push_error("Source changed during diagnostic bake");quit(1);return
		report.views.append({"originalPixel":[pixel.x,pixel.y],"focus":focus,"widthM":512,"sourceUnchanged":true,"sourceVerticesUnchanged":geometry_unchanged,"classChannel":classes,"diagnostics":baked.diagnostics,"sourceRGBAsha256":P._sha(source.get_data()),"symbolRGBAsha256":P._sha(final.get_data()),"centerSourceRGBA":rgba(source.get_pixel(source.get_width()/2,source.get_height()/2)),"centerSymbolRGBA":rgba(final.get_pixel(final.get_width()/2,final.get_height()/2))})
	report.sourceAfter=P._sha(var_to_bytes(packet.source));report.status="PASS diagnostic channels only"
	var file=FileAccess.open(args[1].path_join("report.json"),FileAccess.WRITE);file.store_string(JSON.stringify(report,"  "));file=null
	print(JSON.stringify({"status":report.status,"views":report.views.size()}));quit()
