class_name SurfaceVisibilityPlan
extends RefCounted

# Renderer-private, immutable per-job certificate. No source/world arrays change.
# Bilinear, B-spline and display prefilter kernels are nonnegative: the union of
# their contributing control extrema bounds both terrain and tree supports.
const Geometry=preload("res://adapters/surface_geometry.gd")
const Coverage=preload("res://adapters/surface_source_coverage.gd")
const View=preload("res://adapters/surface_canopy_view.gd")
const PrepareToken=preload("res://adapters/surface_prepare_control.gd")
const VERSION="oblique-visibility-1"
const MAX_SAMPLES=1572864
const MAX_VISITS=65536
const MAX_INDEX_BYTES=64*1024*1024
const MAX_RESIDENT_SIDE=4096
# Known image/array/upload sizes + explicit reserve, NOT an RSS/VRAM bound on
# Godot/Terrain3D internals. Offline oblique maps may need a long preparation.
const MAX_ESTIMATED_WORKING_BYTES=2048*1024*1024
const SOURCE_CONTEXT_RESERVE_BYTES=128*1024*1024
static var _cached_world:Dictionary={}
static var _cached_display:Dictionary={}
static var _cached_layers:Array=[]

# Additive feature ledger, never a substitute for the existing resident/atlas
# budget. It bounds only declared known data planes/reserves, not processRSS.
static func feature_ledger(value)->Dictionary:
	var ledger:Dictionary={}
	if value is int:
		if value<0 or value>MAX_ESTIMATED_WORKING_BYTES:return {"valid":false}
		if value>0:ledger["callerFeatureReserveBytes"]=value
	elif value is Dictionary:
		if value.size()>32:return {"valid":false}
		for key in value:
			var amount=value[key]
			if not key is String or key.is_empty() or not (amount is int or amount is float) or not is_finite(float(amount)) or floorf(float(amount))!=float(amount) or float(amount)<0 or float(amount)>MAX_ESTIMATED_WORKING_BYTES:return {"valid":false}
			ledger[key]=int(amount)
	else:return {"valid":false}
	var total=0
	for amount in ledger.values():
		if int(amount)>MAX_ESTIMATED_WORKING_BYTES-total:return {"valid":false}
		total+=int(amount)
	return {"valid":true,"totalBytes":total,"items":ledger}

static func _camera_hash(camera:Dictionary)->String:
	var hash=HashingContext.new();hash.start(HashingContext.HASH_SHA256);hash.update(var_to_bytes(camera));return hash.finish().hex_encode()

static func snapshot(camera:Camera3D,viewport:Vector2,origin:Dictionary)->Dictionary:
	return {"projection":camera.get_camera_projection(),"basis":camera.global_basis,
		"position":{"x":float(origin.x)+float(camera.global_position.x),"y":float(origin.y)+float(camera.global_position.y),"z":float(origin.z)+float(camera.global_position.z)},
		"viewport":viewport,"near":camera.near,"far":camera.far}

static func same_camera(a:Dictionary,b:Dictionary)->bool:
	if a.is_empty() or b.is_empty() or a.viewport!=b.viewport or a.projection!=b.projection:return false
	for axis in ["x","y","z"]:
		if absf(float(a.position[axis])-float(b.position[axis]))>.0001:return false
	for i in 3:
		if (a.basis[i]-b.basis[i]).length()>.0000001:return false
	return true

static func _fail(reason:String,visits:int=0)->Dictionary:
	return {"version":VERSION,"available":false,"safePhase":0.0,"reason":reason,"visitedNodes":visits,"atlasBounds":{"disabled":true}}

static func _index(grid:Dictionary,token=null)->Dictionary:
	var width=int(grid.width);var height=int(grid.height)
	var levels:Array=[];var low=PackedFloat64Array();var high=PackedFloat64Array()
	low.resize(width*height);high.resize(width*height)
	for i in width*height:
		if i%4096==0 and PrepareToken.hit(token,"visibility-index-controls"):return {}
		var value=float(grid.heights[i])
		if not is_finite(value):return {}
		low[i]=value;high[i]=value
	levels.append({"w":width,"h":height,"low":low,"high":high})
	while width>1 or height>1:
		var next_w=int((width+1)/2);var next_h=int((height+1)/2)
		var next_low=PackedFloat64Array();var next_high=PackedFloat64Array();next_low.resize(next_w*next_h);next_high.resize(next_w*next_h)
		for z in next_h:
			if z%32==0 and PrepareToken.hit(token,"visibility-index-reduction"):return {}
			for x in next_w:
				var lo=INF;var hi=-INF
				for dz in 2:
					for dx in 2:
						var ix=x*2+dx;var iz=z*2+dz
						if ix<width and iz<height:lo=minf(lo,low[iz*width+ix]);hi=maxf(hi,high[iz*width+ix])
				next_low[z*next_w+x]=lo;next_high[z*next_w+x]=hi
		width=next_w;height=next_h;low=next_low;high=next_high
		levels.append({"w":width,"h":height,"low":low,"high":high})
	return {"grid":grid,"levels":levels}

static func _range_node(index:Dictionary,level:int,x:int,z:int,rect:Rect2i,out:Array)->void:
	var scale=1<<level;var node=Rect2i(x*scale,z*scale,scale,scale)
	if not node.intersects(rect):return
	var data:Dictionary=index.levels[level]
	if rect.encloses(node) or level==0:
		out[0]=minf(out[0],data.low[z*int(data.w)+x]);out[1]=maxf(out[1],data.high[z*int(data.w)+x]);return
	var child:Dictionary=index.levels[level-1]
	for dz in 2:
		for dx in 2:
			if x*2+dx<int(child.w) and z*2+dz<int(child.h):_range_node(index,level-1,x*2+dx,z*2+dz,rect,out)

static func control_range(index:Dictionary,bounds:Dictionary)->Array:
	var grid:Dictionary=index.grid;var spacing=float(grid.spacingM)
	var cubic=str(grid.get("reconstruction","bilinear-samples"))=="cubic-bspline-controls"
	var extra=1 if cubic else 0
	var x0=clampi(floori((float(bounds.minX)-float(grid.originX))/spacing)-extra,0,int(grid.width)-1)
	var z0=clampi(floori((float(bounds.minZ)-float(grid.originZ))/spacing)-extra,0,int(grid.height)-1)
	var x1=clampi(floori((float(bounds.maxX)-float(grid.originX))/spacing)+1+extra,0,int(grid.width)-1)
	var z1=clampi(floori((float(bounds.maxZ)-float(grid.originZ))/spacing)+1+extra,0,int(grid.height)-1)
	var result=[INF,-INF]
	_range_node(index,index.levels.size()-1,0,0,Rect2i(x0,z0,x1-x0+1,z1-z0+1),result)
	return result

static func _intersect(a:Dictionary,b:Dictionary)->Dictionary:
	var r=View.intersection(a,b)
	return r if float(r.minX)<=float(r.maxX) and float(r.minZ)<=float(r.maxZ) else {}

static func _union(a:Dictionary,b:Dictionary)->Dictionary:
	if a.is_empty():return b.duplicate()
	return {"minX":minf(a.minX,b.minX),"minZ":minf(a.minZ,b.minZ),"maxX":maxf(a.maxX,b.maxX),"maxZ":maxf(a.maxZ,b.maxZ)}

static func _covered_rectangle(bounds:Dictionary,domains:Array)->bool:
	var remaining:Array=[bounds]
	for domain in domains:
		var next:Array=[]
		for rect in remaining:
			var hit=_intersect(rect,domain)
			if hit.is_empty() or float(hit.maxX)<=float(hit.minX) or float(hit.maxZ)<=float(hit.minZ):next.append(rect);continue
			if float(rect.minX)<float(hit.minX):next.append({"minX":rect.minX,"minZ":rect.minZ,"maxX":hit.minX,"maxZ":rect.maxZ})
			if float(rect.maxX)>float(hit.maxX):next.append({"minX":hit.maxX,"minZ":rect.minZ,"maxX":rect.maxX,"maxZ":rect.maxZ})
			if float(rect.minZ)<float(hit.minZ):next.append({"minX":hit.minX,"minZ":rect.minZ,"maxX":hit.maxX,"maxZ":hit.minZ})
			if float(rect.maxZ)>float(hit.maxZ):next.append({"minX":hit.minX,"minZ":hit.maxZ,"maxX":hit.maxX,"maxZ":rect.maxZ})
		remaining=next
		if remaining.is_empty():return true
		if remaining.size()>128:return false
	return remaining.is_empty()

static func _planes(camera:Dictionary)->Array:
	# Subtract double camera coordinates before any Vector3/Projection operation.
	var vp:Projection=camera.projection*Projection(Transform3D(camera.basis,Vector3.ZERO).affine_inverse())
	var rows=[Vector4(vp.x.x,vp.y.x,vp.z.x,vp.w.x),Vector4(vp.x.y,vp.y.y,vp.z.y,vp.w.y),Vector4(vp.x.w,vp.y.w,vp.z.w,vp.w.w)]
	var forward:Vector3=-camera.basis.z
	return [rows[2]+rows[0],rows[2]-rows[0],rows[2]+rows[1],rows[2]-rows[1],Vector4(forward.x,forward.y,forward.z,-float(camera.near)),Vector4(-forward.x,-forward.y,-forward.z,float(camera.far))]

static func _visible(bounds:Dictionary,low:float,high:float,camera:Dictionary,planes:Array,pad:float)->bool:
	for plane:Vector4 in planes:
		var x=(float(bounds.maxX) if plane.x>=0 else float(bounds.minX))-float(camera.position.x)
		var z=(float(bounds.maxZ) if plane.z>=0 else float(bounds.minZ))-float(camera.position.z)
		var y=(high if plane.y>=0 else low)-float(camera.position.y)
		if plane.x*x+plane.y*y+plane.z*z+plane.w < -pad*(absf(plane.x)+absf(plane.y)+absf(plane.z)):return false
	return true

static func build(world:Dictionary,display:Dictionary,camera:Dictionary,origin:Dictionary,spacing:float,page:Dictionary,options:Dictionary={})->Dictionary:
	var features=feature_ledger(options.get("extraKnownFeatureBytes",0))
	if not features.valid:return _fail("invalid-known-feature-budget-ledger")
	if camera.is_empty() or page.is_empty() or not page.get("complete",false):return _fail("missing-camera-or-complete-tree-page")
	var physical_domains=Coverage.domains(world)
	if physical_domains.is_empty():return _fail("invalid-source-lineage-or-domain")
	# A page of positions is not a substitute for its real height support.
	# Refuse a fine-only packet claiming trees outside its transported sources.
	if not _covered_rectangle(page.bounds,physical_domains):return _fail("tree-page-has-unknown-height-support")
	var domains=Geometry.prepare_height_layers(world);var display_domains=Geometry.prepare_height_layers(display)
	for layer in display_domains:
		var matched=false
		for domain in domains:
			if layer.bounds==domain.bounds:matched=true;break
		if not matched:return _fail("display-domain-does-not-match-source")
	var all:Array=domains+display_domains;var samples=0;var estimate=0;var unique:Array=[]
	for layer in all:
		var g:Dictionary=layer.terrain
		if g.get("source",{}).get("id")!=world.terrain.source.id or g.get("source",{}).get("version")!=world.terrain.source.version:return _fail("display-source-lineage-mismatch")
		if str(g.get("reconstruction","bilinear-samples")) not in ["bilinear-samples","cubic-bspline-controls"]:return _fail("unsupported-height-kernel")
		var n=int(g.width)*int(g.height)
		if not g.get("heights") is PackedFloat32Array and not g.get("heights") is PackedFloat64Array and not g.get("heights") is Array:return _fail("invalid-height-array")
		if g.heights.size()!=n:return _fail("invalid-height-array-length")
		var seen=false
		for grid in unique:
			if is_same(grid,g):seen=true;break
		if not seen:unique.append(g);samples+=n;estimate+=n*2*16+4096
	if samples>int(options.get("maxSamples",MAX_SAMPLES)) or estimate>MAX_INDEX_BYTES:return _fail("height-index-memory-budget")
	var layers:Array=[]
	if is_same(world,_cached_world) and is_same(display,_cached_display):layers=_cached_layers
	else:
		# One index set, not an accumulating cache across source epochs. Release
		# the prior set BEFORE allocating the new bounded hierarchy.
		_cached_world={};_cached_display={};_cached_layers=[]
		for layer in all:
			var index={}
			for previous in layers:
				if is_same(previous.index.grid,layer.terrain):index=previous.index;break
			if index.is_empty():index=_index(layer.terrain,options.get("prepareControl"))
			if index.is_empty():return _fail("nonfinite-source-controls")
			layers.append({"bounds":layer.bounds,"index":index})
		_cached_world=world;_cached_display=display;_cached_layers=layers
	var token=options.get("prepareControl");var crown=float(options.get("crownHeightM",20.0));var radius=float(options.get("maximumCrownRadiusM",7.56))*(1.56 if crown>=32.0 else 1.0)
	var pad=.05+float(camera.far)*.000001
	var planes=_planes(camera);var stack:Array=[]
	# Partition every physical source domain. Union height ranges of ALL overlapping
	# original/display layers before culling: parent-child feathering is convex.
	for layer in domains:stack.append({"bounds":layer.bounds,"spacing":float(layer.terrain.spacingM)})
	var visits=0;var visible_bounds={};var min_height=INF;var max_height=-INF
	while not stack.is_empty():
		visits+=1
		if visits>int(options.get("maxVisits",MAX_VISITS)):return _fail("visibility-node-budget",visits)
		if visits%64==0 and PrepareToken.hit(token,"visibility-plan"):return _fail("visibility-cancelled",visits)
		var node:Dictionary=stack.pop_back();var bounds:Dictionary=node.bounds;var low=INF;var high=-INF
		for layer in layers:
			# RF display interpolation may use a neighbour just across this
			# source-cell partition. Include two actual display samples as support.
			var overlap=_intersect(View.expanded(bounds,spacing*2.0),layer.bounds)
			if overlap.is_empty():continue
			var interval=control_range(layer.index,overlap);low=minf(low,interval[0]);high=maxf(high,interval[1])
		var enlarged=View.expanded(bounds,radius+pad)
		if not _visible(enlarged,low-(12.0 if crown>=32.0 else 0.0),high+crown,camera,planes,pad):continue
		var extent=maxf(float(bounds.maxX)-float(bounds.minX),float(bounds.maxZ)-float(bounds.minZ))
		if extent<=float(node.spacing)*1.01 or extent<=.000001:
			visible_bounds=_union(visible_bounds,enlarged);min_height=minf(min_height,low);max_height=maxf(max_height,high);continue
		var mx=(float(bounds.minX)+float(bounds.maxX))*.5;var mz=(float(bounds.minZ)+float(bounds.maxZ))*.5
		for z in 2:
			for x in 2:stack.append({"spacing":node.spacing,"bounds":{"minX":float(bounds.minX) if x==0 else mx,"maxX":mx if x==0 else float(bounds.maxX),"minZ":float(bounds.minZ) if z==0 else mz,"maxZ":mz if z==0 else float(bounds.maxZ)}})
	if visible_bounds.is_empty():return _fail("no-visible-source-support",visits)
	var halo=float(options.get("haloM",40.0));var needed=View.expanded(visible_bounds,maxf(128.0,halo+View.TRANSITION_M+pad))
	var pb:Dictionary=page.bounds
	if not _encloses(pb,needed):return _fail("complete-tree-page-does-not-cover-visible-support-plus-halo",visits)
	var planned_origin=origin.duplicate()
	var snap=spacing*64.0
	var cx=(float(needed.minX)+float(needed.maxX))*.5;var cz=(float(needed.minZ)+float(needed.maxZ))*.5
	planned_origin.x=float(world.terrain.originX)+round((cx-float(world.terrain.originX))/snap)*snap
	planned_origin.z=float(world.terrain.originZ)+round((cz-float(world.terrain.originZ))/snap)*snap
	var centre_height=Geometry.raw_height_at(world,float(planned_origin.x),float(planned_origin.z))
	if is_finite(centre_height):planned_origin.y=centre_height
	else:planned_origin=origin.duplicate() # never manufacture an anchor in a hole
	var max_side=mini(MAX_RESIDENT_SIDE,int(options.get("maxResidentSide",MAX_RESIDENT_SIDE)))
	if max_side not in [512,1024,2048,4096]:return _fail("invalid-resident-size-budget",visits)
	var image_size=512
	while image_size<max_side and not _encloses(resident_bounds(planned_origin,spacing,image_size),needed):image_size*=2
	if not _encloses(resident_bounds(planned_origin,spacing,image_size),needed):
		var failure=_fail("resident-height-budget",visits)
		failure["visibleBounds"]=visible_bounds;failure["requestedAtlasBounds"]=needed;failure["heightEnvelopeWorld"]=[min_height,max_height+crown];return failure
	var atlas_extent=maxf(float(needed.maxX)-float(needed.minX),float(needed.maxZ)-float(needed.minZ))
	var atlas_spacing=pow(2.0,ceil(log(maxf(atlas_extent/(2048.0-128.0),.000001))/log(2.0)))
	var ax=floor(float(needed.minX)/atlas_spacing/64.0)*64.0*atlas_spacing;var az=floor(float(needed.minZ)/atlas_spacing/64.0)*64.0*atlas_spacing
	var aw=2;var ah=2
	while aw<ceili((float(needed.maxX)-ax)/atlas_spacing)+1:aw*=2
	while ah<ceili((float(needed.maxZ)-az)/atlas_spacing)+1:ah*=2
	# Resident RF+control CPU, native/GPU backing and transfer allowance; atlas
	# float buffers (56 B/texel), images+mips (~64), GPU (~64), temporary byte
	# copies/uploads (~48), rounded up to240. Retained old atlas/resident coexist
	# during worker preparation. Unknown engine allocations are NOT bounded here.
	var active_side=clampi(int(options.get("activeResidentSide",0)),0,MAX_RESIDENT_SIDE)
	var active_atlas=clampi(int(options.get("activeAtlasTexels",0)),0,2048*2048)
	var old_origin:Dictionary=options.get("activeResidentOrigin",{})
	var reuse=options.get("reuseResidentCandidate",false) and active_side==image_size and not old_origin.is_empty()
	if reuse:
		for axis in ["x","y","z"]:
			if absf(float(old_origin[axis])-float(planned_origin[axis]))>.00001:reuse=false;break
	var budget={"newResidentRfControlBackingTransferBytes":0 if reuse else image_size*image_size*24,"activeResidentRfControlBackingBytes":active_side*active_side*16,"newAtlasArraysImagesMipsUploadUpperBytes":aw*ah*240,"activeAtlasImagesMipsTextureUpperBytes":active_atlas*128,"heightIndexUpperBytes":estimate,"sourceContextReserveBytes":SOURCE_CONTEXT_RESERVE_BYTES,"reuseResident":reuse}
	budget["extraKnownFeatureBytes"]=int(features.totalBytes)
	var total=0
	for key in budget:
		if key!="reuseResident":total+=int(budget[key])
	budget["estimatedKnownPeakBytes"]=total;budget["limitBytes"]=mini(MAX_ESTIMATED_WORKING_BYTES,int(options.get("maxEstimatedWorkingBytes",MAX_ESTIMATED_WORKING_BYTES)));budget["rssOrVramBoundClaimed"]=false
	budget["knownFeatureLedger"]=features.items
	if total>int(budget.limitBytes):
		var failure=_fail("estimated-working-memory-budget",visits);failure["memoryBudget"]=budget;return failure
	var binding=[]
	for layer in layers:
		var g:Dictionary=layer.index.grid
		binding.append({"originX":g.originX,"originZ":g.originZ,"width":g.width,"height":g.height,"spacingM":g.spacingM,"kernel":g.get("reconstruction","bilinear-samples"),"source":g.source.duplicate(true),"bounds":layer.bounds.duplicate()})
	return {"version":VERSION,"available":true,"reason":"conservative-source-control-frustum","worldId":str(world.id),"contextId":str(world.get("canonicalContextRef",{}).get("id","")),"terrainVersion":str(world.get("versions",{}).get("terrain","")),"source":world.terrain.source.duplicate(true),"heightSources":binding,"cameraSha256":_camera_hash(camera),"camera":camera,"_world":world,
		"visibleBounds":visible_bounds,"atlasBounds":needed,"atlasGridEstimate":{"width":aw,"height":ah,"spacingM":atlas_spacing},"residentBounds":resident_bounds(planned_origin,spacing,image_size),"residentImageSize":image_size,"residentOrigin":planned_origin,"memoryBudget":budget,"heightEnvelopeWorld":[min_height,max_height+crown],"crownHeightEnvelopeM":crown,"haloM":halo,"visitedNodes":visits,"indexedSamples":samples,"indexBudgetBytes":estimate,"kernelPolicy":"union of positive-kernel original/display source controls; parent seams included"}

static func _encloses(a:Dictionary,b:Dictionary)->bool:
	return float(a.minX)<=float(b.minX) and float(a.minZ)<=float(b.minZ) and float(a.maxX)>=float(b.maxX) and float(a.maxZ)>=float(b.maxZ)

static func resident_bounds(origin:Dictionary,spacing:float,size:int)->Dictionary:
	var extent=float(size)*spacing*.5
	return {"minX":float(origin.x)-extent+2*spacing,"minZ":float(origin.z)-extent+2*spacing,"maxX":float(origin.x)+extent-3*spacing,"maxZ":float(origin.z)+extent-3*spacing}

static func guard(plan:Dictionary,world:Dictionary,camera:Dictionary,safe_bounds:Dictionary,halo:float,reference_y:float)->Dictionary:
	if not plan.get("available",false):return {"safePhase":0.0,"reason":plan.get("reason","no-oblique-visibility-plan"),"visibilityPlanVersion":VERSION}
	if not is_same(plan.get("_world"),world):return {"safePhase":0.0,"reason":"visibility-plan-source-changed"}
	if not same_camera(plan.camera,camera):return {"safePhase":0.0,"reason":"visibility-plan-camera-changed"}
	var v:Dictionary=plan.visibleBounds
	var margin=minf(minf(float(v.minX)-float(safe_bounds.minX),float(safe_bounds.maxX)-float(v.maxX)),minf(float(v.minZ)-float(safe_bounds.minZ),float(safe_bounds.maxZ)-float(v.maxZ)))-halo
	var vp:Projection=camera.projection*Projection(Transform3D(camera.basis,Vector3.ZERO).affine_inverse())
	var analytic=View.footprint_bound(vp,camera.viewport,reference_y-float(camera.position.y),camera.position,v)
	if not analytic.get("valid",false):return {"safePhase":0.0,"reason":"visibility-reference-plane-footprint-not-finite","maximumPixelFootprintM":INF,"analyticFootprintBound":analytic,"visibilityPlan":describe(plan)}
	return {"safePhase":2.0*smoothstep(0.0,View.TRANSITION_M,margin),"reason":"planned-source-support-plus-halo" if margin>=0 else "planned-support-outside-active-atlas-or-resident","frustumBounds":v,"marginM":margin,"haloM":halo,"maximumPixelFootprintM":analytic.upperBoundM,"analyticFootprintBound":analytic,"heightEnvelopeWorld":plan.heightEnvelopeWorld,"visibilityPlanVersion":VERSION,"visitedNodes":plan.visitedNodes,"visibilityPlan":describe(plan)}

static func describe(plan:Dictionary)->Dictionary:
	var result={}
	for key in ["version","available","reason","worldId","contextId","terrainVersion","source","heightSources","cameraSha256","visibleBounds","atlasBounds","atlasGridEstimate","residentBounds","residentImageSize","residentOrigin","memoryBudget","heightEnvelopeWorld","crownHeightEnvelopeM","haloM","visitedNodes","indexedSamples","indexBudgetBytes","kernelPolicy"]:
		if plan.has(key):result[key]=plan[key]
	return result
