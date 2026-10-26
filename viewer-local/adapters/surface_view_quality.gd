class_name SurfaceViewQuality
extends RefCounted
const INPUT_SETTLE_MS=350
static func preview(last_input_ms:int,now_ms:int)->bool:return last_input_ms>=0 and now_ms-last_input_ms<INPUT_SETTLE_MS
static func _finite(value)->bool:return (value is float or value is int) and is_finite(float(value))
static func request_region(world:Dictionary,packet:Dictionary,focus:Dictionary,width_m:float,is_preview:bool)->Dictionary:
	var extent=width_m*1.2+2.0*(16.0+maxf(10.0,float(packet.get("_maximumCrownRadiusM",0.0))))
	var footprint:Dictionary=world.get("canonicalContext",{"bounds":world.bounds}).bounds
	extent=minf(extent,minf(float(footprint.maxX)-float(footprint.minX),float(footprint.maxZ)-float(footprint.minZ)))
	return {"x":clampf(float(focus.x)-extent*.5,float(footprint.minX),float(footprint.maxX)-extent),"y":clampf(float(focus.y)-extent*.5,float(footprint.minZ),float(footprint.maxZ)-extent),"extent":extent,"resolution":128 if is_preview else 512,"preview":is_preview}
static func cache_evidence(value:Dictionary,packet:Dictionary,region:Dictionary,physical_match:bool)->Dictionary:
	var result={"covered":false,"reason":"no rendered source"}
	if value.is_empty() or not value.get("terrain") is Dictionary:return result
	if not physical_match:return {"covered":false,"reason":"physical lineage mismatch"}
	var terrain:Dictionary=value.terrain
	if terrain.get("source",{}).get("sourceLODKnown",false)!=true:return {"covered":false,"reason":"source LOD is unknown"}
	for key in ["x","y","extent","resolution"]:
		if not _finite(region.get(key)):return {"covered":false,"reason":"invalid view request"}
	if float(region.extent)<=0 or not [128,512].has(int(region.resolution)) or not region.get("preview") is bool:return {"covered":false,"reason":"invalid view quality"}
	var spacing=float(terrain.spacingM);var requested=float(region.extent)/int(region.resolution)
	var native=float(terrain.get("source",{}).get("nativeSpacingM",0.0));var required=maxf(requested,native)
	if spacing>required*(1.0+0.000001):return {"covered":false,"reason":"finer source density required"}
	var request=packet.get("source",{}).get("request",{})
	# A settled source must have been acquired explicitly at final quality.
	if not bool(region.preview) and (not request is Dictionary or request.get("preview",true)!=false or request.get("resolution",0)!=512):return {"covered":false,"reason":"final 512 source request required"}
	var source_bounds={"minX":float(terrain.originX)-spacing*.5,"minZ":float(terrain.originZ)-spacing*.5,"maxX":float(terrain.originX)+(int(terrain.width)-.5)*spacing,"maxZ":float(terrain.originZ)+(int(terrain.height)-.5)*spacing}
	# Derive the covered cell footprint from actual geometry, never from a
	# claimed request alone. Protocol request coordinates audit the same extent.
	var view_bounds={"minX":float(region.x),"minZ":float(region.y),"maxX":float(region.x)+float(region.extent),"maxZ":float(region.y)+float(region.extent)}
	var tolerance=maxf(.000001,spacing*.00001)
	if float(view_bounds.minX)<float(source_bounds.minX)-tolerance or float(view_bounds.minZ)<float(source_bounds.minZ)-tolerance or float(view_bounds.maxX)>float(source_bounds.maxX)+tolerance or float(view_bounds.maxZ)>float(source_bounds.maxZ)+tolerance:return {"covered":false,"reason":"view ROI is outside rendered source"}
	return {"covered":true,"reason":"existing rendered source covers ROI and density","region":region.duplicate(true),"requestedSpacingM":requested,"nativeSpacingM":native,"requiredSpacingM":required,"deliveredSpacingM":spacing,"viewBounds":view_bounds,"sourceBounds":source_bounds,"preview":bool(region.preview),"requestedResolution":int(region.resolution),"physicalLineageMatched":true,"actualRequest":request}
