class_name SurfaceWaterSymbols
extends RefCounted
# Renderer-only outlines of retained vector water rings, before raster sampling.
# No centreline, physical bank displacement or synthetic sea contour is created.
const Contours=preload("res://adapters/surface_water_contours.gd")
const VERSION="source-water-symbol-2"
const MAX_RESOLUTION=4096
const MAX_IMAGE_BYTES=256*1024*1024
const MAX_WIDTH_PX=1.25

static func plan(width_m:float,options:Dictionary={}) -> Dictionary:
	for key in ["symbolWidthPx","screenMetresPerPixel","resolution","msaa"]:
		if options.has(key) and (not typeof(options[key]) in [TYPE_INT,TYPE_FLOAT] or not is_finite(float(options[key]))):return {"error":"water symbol option must be a finite number: "+key}
	var symbol_width=float(options.get("symbolWidthPx",0.0))
	if not is_finite(symbol_width) or symbol_width<0.0 or symbol_width>MAX_WIDTH_PX:return {"error":"water symbol width must be0..1.25 screen pixels"}
	if not is_finite(width_m) or width_m<=0.0:return {"error":"invalid water projection width"}
	var resolution=clampi(int(options.get("resolution",1024)),64,2048 if symbol_width==0.0 else MAX_RESOLUTION)
	var mpp=float(options.get("screenMetresPerPixel",0.0))
	var padding=0.0;var radius=0.0;var msaa=int(options.get("msaa",0))
	if not msaa in [0,2,4,8]:return {"error":"invalid water source AA setting"}
	if symbol_width>0.0:
		if not is_finite(mpp) or mpp<=0.0:return {"error":"symbolic water requires actual screen metres per pixel"}
		if not str(options.get("screenScalePolicy","orthographic-map-ground-scale")) in ["orthographic-map-ground-scale","oblique-ground-scale-approximation"]:return {"error":"unknown water symbol screen-scale policy"}
		padding=symbol_width*mpp*.5
		var required=int(ceil((width_m+2.0*padding)/mpp))
		if required>MAX_RESOLUTION:return {"error":"symbolic water needs more than4096 texels to match screen sampling"}
		resolution=maxi(resolution,required);msaa=4
	var padded_width=width_m+2.0*padding
	if symbol_width>0.0:radius=padding*resolution/padded_width
	if radius>4.0:return {"error":"symbol kernel exceeds bounded four-texel radius"}
	# Source readback, symbolic readback and final RGBA8 mip chain. GPU framebuffer
	# attachments/MSAA are additional, engine-owned allocations, not counted here.
	var estimated_image_bytes=int(ceil(float(resolution)*resolution*4.0*(1.0+1.0+4.0/3.0)))
	if estimated_image_bytes>MAX_IMAGE_BYTES:return {"error":"water coverage image budget exceeded"}
	return {"version":VERSION,"widthPx":symbol_width,"screenMPP":mpp,"screenScalePolicy":str(options.get("screenScalePolicy","orthographic-map-ground-scale")),"paddingM":padding,"widthM":padded_width,"resolution":resolution,"radiusTexels":radius,"msaa":msaa,"estimatedImageBytes":estimated_image_bytes,"imageBudgetBytes":MAX_IMAGE_BYTES}

static func diagnostics(p:Dictionary) -> Dictionary:
	return {"waterSymbolVersion":VERSION,"waterSymbolPolicy":"retained-vector-water-ring-outline" if p.widthPx>0.0 else "disabled-original-contours","symbolWidthPx":p.widthPx,"screenMetresPerPixel":p.screenMPP,"screenScalePolicy":p.screenScalePolicy,"paddingSymbolMetres":p.paddingM,"sourceGeometryUnchanged":true,"symbolicPhysicalWidthClaim":false,"symbolCoverageSeparateFromSourceArea":true,"symbolKernelRadiusTexels":p.radiusTexels,"symbolStrokeWidthBakePx":2.0*p.radiusTexels,"symbolCoverageImageBudgetBytes":p.imageBudgetBytes,"symbolCoverageEstimatedImageBytes":p.estimatedImageBytes,"symbolWidthMeaning":"stroke diameter on retained vector polygon boundaries, not a measured or edited physical water width","symbolColorPolicy":"single declared fallback water tint; no river/lake class asserted for outline","symbolRasterLimit":"vector rings are stroked before raster sampling; subpixel source fill may remain absent, while its declared boundary symbol is visible","symbolSeaPolicy":"original sea-cell union fill unchanged; no sea outlines synthesised without retained vector rings"}

static func apply(parent:Node,image:Image,p:Dictionary,geometry:Dictionary,focus:Dictionary,colors:Dictionary) -> Image:
	if float(p.widthPx)==0.0:return image
	var info=Contours.info(geometry)
	if info.has("error"):push_error(str(info.error));return null
	var vp=SubViewport.new();vp.size=Vector2i(int(p.resolution),int(p.resolution));vp.transparent_bg=true;vp.disable_3d=true;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	parent.add_child(vp)
	var rect=ColorRect.new();rect.size=Vector2(vp.size);rect.color=Color.WHITE
	var fill=ShaderMaterial.new();fill.shader=load("res://shaders/water_symbol_fill.gdshader");fill.set_shader_parameter("source_map",ImageTexture.create_from_image(image));rect.material=fill;vp.add_child(rect)
	var tint=colors.get("fallback",Vector3(.028,.10,.115))
	if not tint is Vector3 or not tint.is_finite():tint=Vector3(.028,.10,.115)
	var srgb=Color(tint.x,tint.y,tint.z,1.0).linear_to_srgb()
	var stroke=ShaderMaterial.new();stroke.shader=load("res://shaders/water_vector_outline.gdshader");stroke.set_shader_parameter("stroke_rgba",Vector4(srgb.r,srgb.g,srgb.b,1.0))
	for ring in geometry.sourceWaterContours:
		var line=Line2D.new();line.points=Contours.pixel_points(ring,focus,float(p.widthM),int(p.resolution));line.closed=true
		line.width=float(p.radiusTexels)*2.0;line.antialiased=true;line.joint_mode=Line2D.LINE_JOINT_ROUND;line.begin_cap_mode=Line2D.LINE_CAP_ROUND;line.end_cap_mode=Line2D.LINE_CAP_ROUND;line.round_precision=6;line.default_color=Color.WHITE;line.material=stroke;vp.add_child(line)
	for frame in 3:await parent.get_tree().process_frame
	await RenderingServer.frame_post_draw
	var result=vp.get_texture().get_image();vp.queue_free();return result

# Historical post-only operator, retained ONLY for a controlled A/B diagnostic.
# Production bake never selects it and never labels it vector-outline evidence.
static func post_only_reference(parent:Node,image:Image,p:Dictionary) -> Image:
	if float(p.widthPx)==0.0:return image
	var vp=SubViewport.new();vp.size=Vector2i(int(p.resolution),int(p.resolution));vp.transparent_bg=true;vp.disable_3d=true;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	parent.add_child(vp)
	var rect=ColorRect.new();rect.size=Vector2(vp.size);rect.color=Color.WHITE
	var material=ShaderMaterial.new();material.shader=load("res://shaders/water_symbols.gdshader")
	material.set_shader_parameter("source_map",ImageTexture.create_from_image(image));material.set_shader_parameter("radius_texels",float(p.radiusTexels));rect.material=material;vp.add_child(rect)
	for frame in 3:await parent.get_tree().process_frame
	await RenderingServer.frame_post_draw
	var result=vp.get_texture().get_image();vp.queue_free();return result
