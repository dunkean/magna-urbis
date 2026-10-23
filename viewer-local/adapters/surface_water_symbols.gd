class_name SurfaceWaterSymbols
extends RefCounted
# Renderer-only AA disk around nonzero source-coverage samples. All water kinds;
# this is neither a river centreline nor a physical-width edit.
const VERSION="source-water-symbol-1"
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
	return {"waterSymbolVersion":VERSION,"waterSymbolPolicy":"all-water-source-coverage-aa-disk" if p.widthPx>0.0 else "disabled-original-contours","symbolWidthPx":p.widthPx,"screenMetresPerPixel":p.screenMPP,"screenScalePolicy":p.screenScalePolicy,"paddingSymbolMetres":p.paddingM,"sourceGeometryUnchanged":true,"symbolicPhysicalWidthClaim":false,"symbolCoverageSeparateFromSourceArea":true,"symbolKernelRadiusTexels":p.radiusTexels,"symbolCoverageImageBudgetBytes":p.imageBudgetBytes,"symbolCoverageEstimatedImageBytes":p.estimatedImageBytes,"symbolWidthMeaning":"AA disk diameter around nonzero coverage samples; not a measured or edited physical water width","symbolColorPolicy":"nearest contributing source coverage colour; no new hydrology classes","symbolRasterLimit":"A segment absent from the initial AA source raster cannot be reconstructed by dilation"}

static func apply(parent:Node,image:Image,p:Dictionary) -> Image:
	if float(p.widthPx)==0.0:return image
	var vp=SubViewport.new();vp.size=Vector2i(int(p.resolution),int(p.resolution));vp.transparent_bg=true;vp.disable_3d=true;vp.render_target_update_mode=SubViewport.UPDATE_ALWAYS
	parent.add_child(vp)
	var rect=ColorRect.new();rect.size=Vector2(vp.size);rect.color=Color.WHITE
	var material=ShaderMaterial.new();material.shader=load("res://shaders/water_symbols.gdshader")
	material.set_shader_parameter("source_map",ImageTexture.create_from_image(image));material.set_shader_parameter("radius_texels",float(p.radiusTexels));rect.material=material;vp.add_child(rect)
	for frame in 3:await parent.get_tree().process_frame
	await RenderingServer.frame_post_draw
	var result=vp.get_texture().get_image();vp.queue_free();return result
