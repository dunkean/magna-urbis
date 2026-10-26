class_name SurfaceGeometryDetail
extends RefCounted
const Geometry=preload("res://adapters/surface_geometry.gd")
const MAX_SAMPLES=1048576
static var _cached_world:Dictionary={}
static var _cached_info:Dictionary={}
static var _cached_packet:Dictionary={}
static var _cached_veto:Dictionary={}
static var _cached_veto_world:Dictionary={}
static var _population_packet:Dictionary={}
static var _population_source:Dictionary={}
static var _population_world:Dictionary={}
static func _number(v)->bool: return (v is int or v is float) and is_finite(float(v))
static func _array(v)->bool: return typeof(v) in [TYPE_ARRAY,TYPE_PACKED_BYTE_ARRAY,TYPE_PACKED_INT32_ARRAY,TYPE_PACKED_INT64_ARRAY,TYPE_PACKED_FLOAT32_ARRAY,TYPE_PACKED_FLOAT64_ARRAY]
static func _near(a:float,b:float,tolerance:=0.000002)->bool: return absf(a-b)<=tolerance
static func _field(v,n:int,minimum:float,maximum:float,integer:=false)->bool:
	if not _array(v) or v.size()!=n: return false
	for x in v:
		if not _number(x) or float(x)<minimum or float(x)>maximum or (integer and floorf(float(x))!=float(x)): return false
	return true
static func _smooth(a:float,b:float,x:float)->float:
	var t=clampf((x-a)/(b-a),0,1);return t*t*(3-2*t)
static func _unit(s:Dictionary,x:float,z:float,height:float)->int:
	var across=(x-float(s.originX))*-sin(float(s.strikeRadians))+(z-float(s.originZ))*cos(float(s.strikeRadians))
	var q=(height-float(s.basalContactElevationM))*cos(float(s.dipRadians))+across*sin(float(s.dipRadians))
	if q<0: return int(s.basementUnitId)
	for layer in s.strata:
		if layer.thicknessM==null or q<float(layer.thicknessM): return int(layer.unitId)
		q-=float(layer.thicknessM)
	return -1
static func validate(detail,world:Dictionary)->bool:
	if detail==null: return true
	if not detail is Dictionary or detail.get("format")!="surface-geometry-detail" or detail.get("version")!=1 or not detail.get("id") is String or not str(detail.id).begins_with("geometry-detail:"): return false
	var t:Dictionary=world.get("terrain",{});var g=detail.get("grid");var source=detail.get("source")
	if not g is Dictionary or not source is Dictionary or source!=t.get("source"): return false
	for key in ["width","height","originX","originZ","spacingM"]:
		if not _number(g.get(key)) or not _number(t.get(key)) or g[key]!=t[key]: return false
	var n=int(g.width)*int(g.height)
	if int(g.width)<2 or int(g.height)<2 or n>MAX_SAMPLES or n<4 or not _array(t.get("heights")) or t.heights.size()!=n: return false
	if detail.get("canonicalContextId")!=world.get("canonicalContextRef",{}).get("id") or detail.get("reconstruction")!=t.get("reconstruction","bilinear-samples"): return false
	if not _number(detail.get("supportM")) or float(detail.supportM)<maxf(float(g.spacingM),float(source.get("nativeSpacingM",INF))): return false
	var descriptor=detail.get("supportDescriptor")
	if not descriptor is Dictionary or descriptor.get("format")!="surface-source-support" or descriptor.get("version")!=1 or descriptor.get("geometryDetailId")!=detail.id or descriptor.get("canonicalContextId")!=detail.get("canonicalContextId") or descriptor.get("source")!=source or descriptor.get("supportM")!=detail.supportM or descriptor.get("vetoMinimumConfidence")!=1 or not _number(descriptor.get("treeMaximumSlopeRadians")) or not _near(float(descriptor.treeMaximumSlopeRadians),deg_to_rad(65.0)): return false
	if not descriptor.get("exposureRecipe") is Dictionary or not _number(descriptor.exposureRecipe.get("minimumSlopeRadians")) or not _number(descriptor.exposureRecipe.get("maximumSlopeRadians")) or not _near(float(descriptor.exposureRecipe.get("minimumSlopeRadians",-1)),deg_to_rad(22.0)) or not _near(float(descriptor.exposureRecipe.get("maximumSlopeRadians",-1)),deg_to_rad(60.0)) or not descriptor.get("provenance") is String or descriptor.provenance.strip_edges().is_empty(): return false
	for key in ["slopeRadians","aspectRadians","rockExposurePotential","edgeConfidence","bedrockExposure"]:
		if not _field(detail.get(key),n,-PI-0.000001 if key=="aspectRadians" else 0.0,PI+0.000001 if key=="aspectRadians" else PI/2 if key=="slopeRadians" else 1.0): return false
	if not _field(detail.get("normalXYZ"),n*3,-1,1) or not _field(detail.get("treeSupport"),n,0,1,true): return false
	var local=detail.get("localBedrockUnitId");var scenario=detail.get("geologyScenario")
	if (local==null)!=(scenario==null): return false
	var units:Dictionary={}
	for unit in world.get("geology",{}).get("units",[]):
		if not unit is Dictionary or not _field([unit.get("id")],1,1,65535,true) or not _field(unit.get("colorLinear"),3,0,1): return false
		units[int(unit.id)]=true
	if units.is_empty() or units.size()>64 or not _field(world.get("fields",{}).get("sourceRock"),n,1,65535,true): return false
	if local!=null:
		if not _field(local,n,1,65535,true) or not scenario is Dictionary or scenario!=world.get("geology",{}).get("scenario") or scenario.get("format")!="surface-geology-scenario" or scenario.get("id")!="tilted-strata-v1" or scenario.get("version")!=1: return false
		for key in ["originX","originZ","basalContactElevationM","strikeRadians","dipRadians"]:
			if not _number(scenario.get(key)): return false
		if not scenario.get("strata") is Array or scenario.strata.is_empty() or not _field([scenario.get("basementUnitId")],1,1,65535,true) or not units.has(int(scenario.basementUnitId)): return false
		for i in scenario.strata.size():
			var layer=scenario.strata[i]
			if not layer is Dictionary or not _field([layer.get("unitId")],1,1,65535,true) or not units.has(int(layer.unitId)): return false
			if i==scenario.strata.size()-1:
				if layer.get("thicknessM")!=null: return false
			elif not _number(layer.get("thicknessM")) or float(layer.thicknessM)<=0: return false
	var conditioning=detail.get("surfaceConditioning");var f:Dictionary=world.get("fields",{})
	if conditioning!=null:
		if not conditioning is Dictionary or conditioning.get("version")!="surface-conditioning-1" or conditioning.get("canonicalEnvironmentVersion")!=world.get("versions",{}).get("environment") or not _field(conditioning.get("bedrockExposure"),n,0,1): return false
		for key in ["soilDepthM","depositDepthM","stoniness","waterClass","occupation"]:
			if not _field(f.get(key),n,0,7 if key=="occupation" else 3 if key=="waterClass" else 1 if key=="stoniness" else 1000000.0,key in ["waterClass","occupation"]): return false
	var min_x=float(g.originX);var min_z=float(g.originZ);var max_x=min_x+(int(g.width)-1)*float(g.spacingM);var max_z=min_z+(int(g.height)-1)*float(g.spacingM)
	var padding=float(detail.supportM)+(2*float(g.spacingM) if detail.reconstruction=="cubic-bspline-controls" else 0.0)
	var full=detail.get("fullSupportBounds")
	if max_x-min_x>=2*padding and max_z-min_z>=2*padding:
		if not full is Dictionary: return false
		for pair in [["minX",min_x+padding],["minZ",min_z+padding],["maxX",max_x-padding],["maxZ",max_z-padding]]:
			if not _number(full.get(pair[0])) or not _near(float(full[pair[0]]),float(pair[1])): return false
	elif full!=null: return false
	var statistics=detail.get("statistics")
	if not statistics is Dictionary or not detail.get("limitations") is Array or detail.limitations.is_empty():return false
	for text in detail.limitations:
		if not text is String or text.strip_edges().is_empty():return false
	var minimum=INF;var maximum=-INF;var sum_slope=0.0;var sum_exposure=0.0;var supported=0
	# Validate every physical derivative against actual source heights on the decode worker.
	for i in n:
		var x=min_x+(i%int(g.width))*float(g.spacingM);var z=min_z+floori(float(i)/int(g.width))*float(g.spacingM)
		var left=maxf(min_x,x-float(detail.supportM));var right=minf(max_x,x+float(detail.supportM));var top=maxf(min_z,z-float(detail.supportM));var bottom=minf(max_z,z+float(detail.supportM))
		var dx=(Geometry.sample_grid_values(t,t.heights,right,z)-Geometry.sample_grid_values(t,t.heights,left,z))/(right-left)
		var dz=(Geometry.sample_grid_values(t,t.heights,x,bottom)-Geometry.sample_grid_values(t,t.heights,x,top))/(bottom-top)
		var length=sqrt(dx*dx+1+dz*dz);var slope=atan(sqrt(dx*dx+dz*dz));var confidence=clampf(minf(minf(x-min_x,max_x-x),minf(z-min_z,max_z-z))/padding,0,1);var potential=_smooth(deg_to_rad(22.0),deg_to_rad(60.0),slope)
		if not _near(float(detail.slopeRadians[i]),slope) or not _near(float(detail.normalXYZ[i*3]),-dx/length) or not _near(float(detail.normalXYZ[i*3+1]),1/length) or not _near(float(detail.normalXYZ[i*3+2]),-dz/length) or absf(wrapf(float(detail.aspectRadians[i])-atan2(-dz,-dx),-PI,PI))>0.000002 or not _near(float(detail.edgeConfidence[i]),confidence) or not _near(float(detail.rockExposurePotential[i]),potential) or not _near(float(detail.bedrockExposure[i]),potential*confidence) or int(detail.treeSupport[i])!=int(confidence<1 or slope<=deg_to_rad(65.0)): return false
		var height=Geometry.sample_grid_values(t,t.heights,x,z)
		minimum=minf(minimum,height);maximum=maxf(maximum,height);sum_slope+=slope;sum_exposure+=potential
		if float(detail.edgeConfidence[i])>=1:supported+=1
		if not units.has(int(world.fields.sourceRock[i])):return false
		if local!=null and (not units.has(int(local[i])) or int(local[i])!=_unit(scenario,x,z,height)): return false
		if conditioning!=null:
			var expected=0.0
			if int(f.waterClass[i])==0 and int(f.occupation[i])<2:
				var susceptibility=clampf((0.2+float(f.stoniness[i])*0.8)/(1+(float(f.soilDepthM[i])+float(f.depositDepthM[i]))/0.5),0,1)
				expected=maxf(potential*susceptibility,_smooth(deg_to_rad(55.0),deg_to_rad(72.0),slope))*confidence
			if not _near(float(conditioning.bedrockExposure[i]),expected): return false
	for pair in [["minimumHeightM",minimum],["maximumHeightM",maximum],["meanSlopeRadians",sum_slope/n],["meanRockExposurePotential",sum_exposure/n],["fullSupportFraction",float(supported)/n]]:
		if not _number(statistics.get(pair[0])) or not _near(float(statistics[pair[0]]),float(pair[1]),0.000001*maxf(1,absf(float(pair[1])))):return false
	return true

static func prepare(world:Dictionary)->Dictionary:
	if is_same(world,_cached_world):return _cached_info
	var detail=world.get("geometryDetail")
	if not detail is Dictionary: return {"available":false}
	var g:Dictionary=detail.grid;var n=int(g.width)*int(g.height)
	var rgba=PackedFloat32Array();rgba.resize(n*4)
	var colors=PackedVector4Array();colors.resize(64);var unit_indices={}
	var units:Array=world.geology.units
	for i in units.size():
		var unit:Dictionary=units[i];var c=unit.colorLinear;colors[i]=Vector4(c[0],c[1],c[2],1);unit_indices[int(unit.id)]=i
	var local=detail.get("localBedrockUnitId");var conditioned:Dictionary=detail.get("surfaceConditioning",{});var exposure=conditioned.get("bedrockExposure")
	for i in n:
		var x=float(g.originX)+(i%int(g.width))*float(g.spacingM);var z=float(g.originZ)+floori(float(i)/int(g.width))*float(g.spacingM)
		var unit=int(local[i]) if local!=null else int(world.fields.sourceRock[i])
		rgba[i*4]=detail.slopeRadians[i];rgba[i*4+1]=float(exposure[i]) if exposure!=null else 0.0;rgba[i*4+2]=unit_indices.get(unit,-1);rgba[i*4+3]=detail.edgeConfidence[i]
	var recipe=-1
	for i in world.materials.size():
		if world.materials[i].id=="fractured-bedrock":recipe=i;break
	_cached_world=world
	var bytes=rgba.to_byte_array();var digest=HashingContext.new();digest.start(HashingContext.HASH_SHA256);digest.update(bytes)
	_cached_info={"available":true,"cacheKey":str(detail.id)+":"+digest.finish().hex_encode(),"id":detail.id,"source":detail.source,"grid":g,"image":Image.create_from_data(int(g.width),int(g.height),false,Image.FORMAT_RGBAF,bytes),"colors":colors,"recipe":recipe,"conditioned":exposure!=null}
	return _cached_info

static func unsupported_trees(packet:Dictionary,world:Dictionary)->Dictionary:
	if is_same(packet,_cached_packet) and is_same(world,_cached_veto_world):return _cached_veto
	var result={};var detail=world.get("geometryDetail")
	if not detail is Dictionary:return result
	var g:Dictionary=detail.grid;var columns:Dictionary=packet.get("candidateColumns",{});var candidates:Array=packet.get("candidates",[])
	var count=int(columns.count) if not columns.is_empty() else candidates.size()
	for i in count:
		var family=str(columns.families[int(columns.family[i])]) if not columns.is_empty() else str(candidates[i].family)
		if family!="tree":continue
		var x=float(columns.positions[i*3]) if not columns.is_empty() else float(candidates[i].x);var z=float(columns.positions[i*3+2]) if not columns.is_empty() else float(candidates[i].z)
		var u=(x-float(g.originX))/float(g.spacingM);var v=(z-float(g.originZ))/float(g.spacingM)
		if u<0 or v<0 or u>int(g.width)-1 or v>int(g.height)-1:continue
		var conf=Geometry.sample_grid_values(g,detail.edgeConfidence,x,z)
		if conf<1.0:continue
		var nx=0.0;var ny=0.0;var nz=0.0
		var ix=floori(u);var iz=floori(v)
		for dz in 2:
			for dx in 2:
				var at=(mini(iz+dz,int(g.height)-1)*int(g.width)+mini(ix+dx,int(g.width)-1))*3
				var weight=(u-ix if dx else 1-(u-ix))*(v-iz if dz else 1-(v-iz))
				nx+=float(detail.normalXYZ[at])*weight;ny+=float(detail.normalXYZ[at+1])*weight;nz+=float(detail.normalXYZ[at+2])*weight
		if acos(clampf(ny/sqrt(nx*nx+ny*ny+nz*nz),-1,1))>deg_to_rad(65.0):result[str(columns.ids[i]) if not columns.is_empty() else str(candidates[i].stableId)]=true
	_cached_packet=packet;_cached_veto_world=world;_cached_veto=result
	return result

static func population_packet(packet:Dictionary,world:Dictionary)->Dictionary:
	if is_same(packet,_population_source) and is_same(world,_population_world):return _population_packet
	var veto=unsupported_trees(packet,world)
	_population_source=packet;_population_world=world
	_population_packet=packet.duplicate(false);_population_packet["_unsupportedTreeIDs"]=veto
	return _population_packet
