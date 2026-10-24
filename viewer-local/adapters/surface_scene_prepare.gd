class_name SurfaceScenePrepare
extends RefCounted
const PrepareControl=preload("res://adapters/surface_prepare_control.gd")
const Data = preload("res://adapters/surface_data.gd")
const Population = preload("res://adapters/surface_population.gd")
const Detail=preload("res://adapters/surface_geometry_detail.gd")
const CityMap=preload("res://adapters/surface_city_map.gd")
const Presentation=preload("res://adapters/surface_presentation.gd")
const Roads = preload("res://adapters/surface_roads.gd")
const VisibilityPlan=preload("res://adapters/surface_visibility_plan.gd")
const Canopy=preload("res://adapters/surface_canopy.gd")
const Solar=preload("res://adapters/surface_tree_solar.gd")

# Prepare winding, normals and material batches without touching the scene tree.
static func mesh_arrays(vertices: PackedVector3Array, normals: PackedVector3Array = PackedVector3Array()) -> Array:
	var points := PackedVector3Array(); points.resize(vertices.size())
	var output_normals := PackedVector3Array(); output_normals.resize(vertices.size())
	for i in range(0,vertices.size(),3):
		points[i]=vertices[i]; points[i+1]=vertices[i+2]; points[i+2]=vertices[i+1]
		if normals.size()==vertices.size():
			output_normals[i]=normals[i]; output_normals[i+1]=normals[i+2]; output_normals[i+2]=normals[i+1]
		else:
			var n := (vertices[i+1]-vertices[i]).cross(vertices[i+2]-vertices[i]).normalized()
			output_normals[i]=n; output_normals[i+1]=n; output_normals[i+2]=n
	var arrays := []; arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX]=points; arrays[Mesh.ARRAY_NORMAL]=output_normals
	return arrays

static func prepare(request: Dictionary) -> Dictionary:
	var started := Time.get_ticks_usec()
	var control=request.get("prepareControl")
	var phase_tick=started;var phases={}
	if PrepareControl.hit(control,"scene-start"):return PrepareControl.result(control,"scene-start",started)
	var visibility_plan:Dictionary={}
	if request.oblique:
		# One worker snapshot supplies BOTH resident heights and the atlas query.
		request=request.duplicate(false);request.sceneRequest=request.sceneRequest.duplicate(false)
		var spacing=Data.display_spacing(request.world.terrain,request.width,int(request.get("displaySamples",256)))
		if request.displaySource.is_empty():request.displaySource=Data.build_display_source(request.world,spacing,control)
		var plan_options:Dictionary=request.get("visibilityOptions",{}).duplicate(false)
		plan_options["activeResidentSide"]=request.get("renderedHeightImageSize",0)
		plan_options["activeResidentOrigin"]=request.get("renderedOrigin",{})
		plan_options["reuseResidentCandidate"]=request.get("reuseObliqueHeight",false)
		visibility_plan=VisibilityPlan.build(request.world,request.displaySource,request.get("visibilityCamera",{}),request.origin,spacing,Canopy.tree_page(request.packet),plan_options)
		if PrepareControl.hit(control,"visibility-complete"):return PrepareControl.result(control,"visibility-complete",started)
		request.sceneRequest["canopyAtlasBounds"]=visibility_plan.atlasBounds
		if visibility_plan.get("available",false):
			request.sceneRequest["visibilityResidentImageSize"]=int(visibility_plan.residentImageSize)
			request.sceneRequest["visibilityCameraSha256"]=visibility_plan.cameraSha256
			request.origin=visibility_plan.residentOrigin
			request.heightImageSize=int(visibility_plan.residentImageSize)
			var old:Dictionary=request.get("renderedOrigin",{})
			var same_origin=not old.is_empty() and absf(float(old.x)-float(request.origin.x))<.00001 and absf(float(old.z)-float(request.origin.z))<.00001 and absf(float(old.y)-float(request.origin.y))<.00001
			request.skipHeight=request.get("reuseObliqueHeight",false) and same_origin and int(request.get("renderedHeightImageSize",0))==int(visibility_plan.residentImageSize)
		else:request.skipHeight=false
	phases["visibilityPlanMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	var result := Data.prepare(request.world,request.origin,request.width,request.generation,request.packet,request.skipContext,request.displaySource,request.skipHeight,request.sceneRequest)
	if result.get("cancelled",false) or result.get("failed",false):return result
	phases["dataMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	result["prepareControl"]=control
	result.worldRevision=request.get("worldRevision",0)
	result.viewWidth=request.width
	result.focus=request.focus
	result.oblique=request.oblique
	if request.oblique:result.visibilityPlan=visibility_plan
	for key in ["heightImageSize","displaySamples","physicalLineage","contextKey","heightKey","liveSerial","presentationMode"]:
		if request.has(key):result[key]=request[key]
	if PrepareControl.hit(control,"detail"):return PrepareControl.result(control,"detail",started)
	phases["metadataMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	result.geometryDetail=Detail.prepare(request.world)
	if PrepareControl.hit(control,"tree-support"):return PrepareControl.result(control,"tree-support",started)
	phases["detailMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	var population_packet:Dictionary=Detail.population_packet(request.packet,request.world)
	result.unsupportedTreeCount=population_packet._unsupportedTreeIDs.size()
	if PrepareControl.hit(control,"population"):return PrepareControl.result(control,"population",started)
	phases["treeSupportMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	result.populations=Population.prepare(population_packet,request.focus,request.width,request.viewportWidth,request.oblique,not request.get("groundOnly",false),request.sceneRequest.get("canopyAtlasBounds",{}))
	if request.get("solarShadows",false):
		result.treeSolar=Solar.prepare(population_packet,request.world,request.origin)
	if request.oblique:
		result.populations.canopy["visibilityPlan"]=visibility_plan
		if not visibility_plan.get("available",false):result.populations.canopy["reason"]=visibility_plan.reason
	if PrepareControl.hit(control,"city-map"):return PrepareControl.result(control,"city-map",started)
	phases["populationMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	if request.get("presentationMode","")=="cartographic" and not request.get("groundOnly",false):
		var palette:Dictionary=Presentation.profile(request.packet,"cartographic").palette.get("urban",{})
		result.cityMap=CityMap.prepare(request.packet,request.origin,request.focus,request.width,maxf(0.0,float(palette.get("massEdgeW",0.04))))
		result.cityMapArrays=mesh_arrays(result.cityMap.vertices,result.cityMap.normals)
		result.cityMapOutlineArrays=mesh_arrays(result.cityMap.outlineVertices,result.cityMap.outlineNormals)
	if PrepareControl.hit(control,"roads"):return PrepareControl.result(control,"roads",started)
	phases["cityMapMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	if request.get("projectRoads",false) and not request.get("groundOnly",false): result.roadProjectors=Roads.prepareRoadProjectors(request.packet,request.world,request.origin,request.focus,request.width)
	if PrepareControl.hit(control,"buffers"):return PrepareControl.result(control,"buffers",started)
	phases["roadsMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	result.populations.buffers={}
	var cartographic:bool=request.get("presentationMode","")=="cartographic"
	var map_palette:Dictionary=Presentation.profile(request.packet,"cartographic").palette if cartographic else {}
	var rock_colors: Dictionary = {}
	for rock in request.world.geology.units: rock_colors[int(rock.id)]=rock.colorLinear
	for family in result.populations.families:
		for i in result.populations.families[family].size():
			var candidate: Dictionary = result.populations.families[family][i].duplicate(false)
			var rgb: Array = [0.055,0.105,0.036] if family=="tree" else [0.10,0.20,0.065]
			if family=="boulder": rgb=rock_colors.get(int(Data.field_at(request.world,"sourceRock",candidate.x,candidate.z,true)),[0.33,0.32,0.29])
			elif family=="debris" or family=="grass":
				# A blade is live low vegetation, never an arbitrary terrain recipe.
				var recipe_id="forest-litter" if family=="debris" else "vegetation-litter"
				for recipe in request.world.materials:
					if recipe.id==recipe_id: rgb=recipe.colorLinear;break
			if cartographic:
				var css=str(map_palette.get("treeFill" if family=="tree" or family=="shrub" else "grass" if family=="grass" else "inkSoft",""))
				var color=Presentation.color_linear(css,Vector3(0.2,0.3,0.2));rgb=[color.x,color.y,color.z]
			# Only the visible support is updated; candidate inventory and IDs stay immutable.
			if request.world.has("geometryDetail") and Data.contains(request.world.bounds,float(candidate.x),float(candidate.z)):
				candidate["y"]=Data.height_at(request.world,float(candidate.x),float(candidate.z))
			candidate["_linearAlbedo"]=rgb
			result.populations.families[family][i]=candidate
		result.populations.buffers[family]=population_buffer(result.populations.families[family],family,request.origin)
	result.populations.trunkBuffer=population_buffer(result.populations.families.tree,"trunk",request.origin)
	if PrepareControl.hit(control,"water-geometry"):return PrepareControl.result(control,"water-geometry",started)
	phases["buffersMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	if result.has("waterGeometry"):
		if ResourceLoader.exists("res://adapters/surface_hydrology.gd"):
			var hydrology=load("res://adapters/surface_hydrology.gd")
			result.waterGeometry=hydrology.prepare(request.packet,request.world,request.origin,request.focus,request.width,result.waterGeometry)
		result.waterArrays=mesh_arrays(result.waterGeometry.vertices)
	if PrepareControl.hit(control,"urban-arrays"):return PrepareControl.result(control,"urban-arrays",started)
	phases["hydrologyMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0;phase_tick=Time.get_ticks_usec()
	if result.has("urbanGeometry"):
		var urban: Dictionary = result.urbanGeometry
		result.roadArrays=mesh_arrays(urban.roadVertices)
		var buckets: Dictionary = {}
		for group in urban.get("materialGroups",[]):
			var key := str(group.materialId)+":"+str(group.surface)+":"+JSON.stringify(group.slots)
			if not buckets.has(key): buckets[key]={"vertices":PackedVector3Array(),"normals":PackedVector3Array(),"materialId":group.materialId,"surface":group.surface,"slots":group.slots,"buildingIds":[]}
			var b: Dictionary = buckets[key]
			b.vertices.append_array(urban.vertices.slice(int(group.start),int(group.start)+int(group.count)))
			b.normals.append_array(urban.normals.slice(int(group.start),int(group.start)+int(group.count)))
			if not b.buildingIds.has(group.buildingId): b.buildingIds.append(group.buildingId)
		var batches: Array = []
		for key in buckets:
			var b: Dictionary = buckets[key]
			b.arrays=mesh_arrays(b.vertices,b.normals); b.erase("vertices"); b.erase("normals"); batches.append(b)
		if batches.is_empty() and not urban.vertices.is_empty(): batches.append({"arrays":mesh_arrays(urban.vertices,urban.normals),"materialId":"","surface":"wall","slots":{},"buildingIds":urban.get("buildingIds",[])})
		result.urbanBatches=batches
	result.prepareMs=(Time.get_ticks_usec()-started)/1000.0
	if PrepareControl.hit(control,"scene-complete"):return PrepareControl.result(control,"scene-complete",started)
	phases["urbanArraysMs"]=(Time.get_ticks_usec()-phase_tick)/1000.0
	result["cpuPhasesMs"]=phases
	return result

# MultiMesh's documented 3x4 row-major transform + linear RGBA colour and four custom float channels.
# The raw buffer avoids thousands of main-thread transform setter calls.
static func population_buffer(candidates: Array, family: String, origin: Dictionary) -> PackedFloat32Array:
	var buffer := PackedFloat32Array(); buffer.resize(candidates.size()*20)
	for i in candidates.size():
		var c: Dictionary = candidates[i]
		var size := float(c.size)
		var crown: bool = family=="tree"
		var radius := float(c.get("crownRadiusM",size*0.42))
		if not is_finite(radius): radius=size*0.42
		var sx := radius/0.42 if crown else size
		var sy := size*(0.66 if crown else 1.0)
		var elevation := size*(0.72 if crown else 0.37 if family=="trunk" else 0.35 if family=="boulder" or family=="debris" else 0.5)
		var angle := 0.0 if family=="trunk" else float(c.orientation)
		var cosine := cos(angle); var sine := sin(angle); var at := i*20
		buffer[at]=cosine*sx; buffer[at+1]=0.0; buffer[at+2]=sine*sx; buffer[at+3]=float(c.x)-float(origin.x)
		buffer[at+4]=0.0; buffer[at+5]=sy; buffer[at+6]=0.0; buffer[at+7]=float(c.y)+elevation-float(origin.y)
		buffer[at+8]=-sine*sx; buffer[at+9]=0.0; buffer[at+10]=cosine*sx; buffer[at+11]=float(c.z)-float(origin.z)
		var rgb: Array = c.get("_linearAlbedo",[0.33,0.32,0.29])
		buffer[at+12]=float(rgb[0]); buffer[at+13]=float(rgb[1]); buffer[at+14]=float(rgb[2]); buffer[at+15]=1.0
		buffer[at+16]=size; buffer[at+17]=float(c.get("canopyClass",0)); buffer[at+18]=float(c.get("rank",0.0)); buffer[at+19]=1.0
	return buffer
