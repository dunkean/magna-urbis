class_name SurfaceCanopy
extends RefCounted

# canopy-r1: exact provided crown discs, no procedural noise. RGB is LINEAR.
const LINEAR_ALBEDO := Color(0.055,0.105,0.036,1.0)
const RADII := [2.5,4.0,5.5,7.0]
const HALO_M := 16.0
const RESOLUTION := 2048
const MESO_CELL_M:=16.0
const REFERENCE_CROWN_DIAMETER_M:=11.4378640776699
const REFERENCE_CROWN_CENTRE_HEIGHT_M:=9.80388349514563
static var _cached_packet: Dictionary = {}
static var _cached_selection: Dictionary = {}
static var _cached_atlas: Dictionary = {}
static var _cached_unsupported: Dictionary = {}
static var _cached_view_bounds: Dictionary = {}

static func _power2(value:int)->int:
	return int(pow(2.0,ceil(log(float(value))/log(2.0))))

static func radius_class(radius: float) -> int:
	var best := 0
	for i in range(1,4):
		if absf(radius-float(RADII[i]))<absf(radius-float(RADII[best])): best=i
	return best

static func tree_page(packet:Dictionary)->Dictionary:
	var pages=packet.get("candidatePages",{})
	if not pages is Dictionary or pages.get("version")!="surface-candidate-pages-1":return {}
	var page=pages.get("tree",{})
	if not page is Dictionary or page.get("complete")!=true or page.get("includeOverhang")!=true or page.get("retention")!=1:return {}
	return page

# Whole-frustum safety replaces all local page-edge/rank transitions.
static func transition_widths(_bounds:Dictionary)->Dictionary:
	return {"paint":0.0,"geometry":0.0}

static func can_select(x:float,z:float,radius:float,bounds:Dictionary,_rank:float=0.0)->bool:
	return x+radius>=float(bounds.minX) and x-radius<=float(bounds.maxX) and z+radius>=float(bounds.minZ) and z-radius<=float(bounds.maxZ)

static func instance_weight(bin: int,footprint: float) -> float:
	return smoothstep(3.0,8.0,2.0*float(RADII[bin])/maxf(footprint,0.00001))

# Called on the population preparation worker; GPU texture creation stays on UI.
static func prepare(packet: Dictionary,selected: Dictionary,view_bounds:Dictionary={}) -> Dictionary:
	# Packets are immutable snapshots. A sequential preparation worker may reuse
	# the exact atlas while panning if neither packet identity nor selected ids changed.
	var unsupported: Dictionary = packet.get("_unsupportedTreeIDs",{})
	if is_same(packet,_cached_packet) and selected==_cached_selection and unsupported==_cached_unsupported and view_bounds==_cached_view_bounds: return _cached_atlas
	var page=tree_page(packet)
	if view_bounds.get("disabled",false):return {"available":false,"reason":"Complete tree page does not cover this view","page":page}
	if page.is_empty():return {"available":false,"reason":"No declared complete tree page"}
	var page_bounds:Dictionary=page.bounds
	var bounds:Dictionary=page_bounds if view_bounds.is_empty() else preload("res://adapters/surface_canopy_view.gd").intersection(page_bounds,view_bounds)
	if bounds.is_empty(): return {"available":false,"reason":"No declared candidate query bounds"}
	var extent := maxf(float(bounds.maxX)-float(bounds.minX),float(bounds.maxZ)-float(bounds.minZ))
	if extent<=0.0: return {"available":false,"reason":"Empty candidate query bounds"}
	var spacing := pow(2.0,ceil(log(maxf(extent/float(RESOLUTION-128),0.000001))/log(2.0)))
	var base_x=floor(float(bounds.minX)/spacing/64.0)*64.0*spacing;var base_z=floor(float(bounds.minZ)/spacing/64.0)*64.0*spacing
	var width := _power2(maxi(2,ceili((float(bounds.maxX)-base_x)/spacing)+1))
	var height := _power2(maxi(2,ceili((float(bounds.maxZ)-base_z)/spacing)+1))
	var coverage := PackedFloat32Array(); coverage.resize(width*height)
	var counts := PackedFloat32Array(); counts.resize(width*height*4)
	var normal_values:=PackedFloat32Array();normal_values.resize(width*height*4)
	var crown_heights:=PackedFloat32Array();crown_heights.resize(width*height);crown_heights.fill(-INF)
	var height_origin:=0.0;var has_height_origin:=false
	# Keep absolute regional coordinates in scalar doubles. Vector2 is FP32;
	# the UI creates a Vector2 only after subtracting its render origin.
	var origin := {"x":base_x+spacing/2.0,"z":base_z+spacing/2.0}
	var candidates: Array = packet.get("candidates",packet.get("populations",[]))
	var columns: Dictionary = packet.get("candidateColumns",{})
	var count := int(columns.count) if not columns.is_empty() else candidates.size()
	var trees := 0; var selected_trees := 0;var unsupported_trees := 0
	for i in range(count):
		var family: String = str(columns.families[int(columns.family[i])]) if not columns.is_empty() else str(candidates[i].family)
		if family!="tree": continue
		var x: float = float(columns.positions[i*3]) if not columns.is_empty() else float(candidates[i].x)
		var z: float = float(columns.positions[i*3+2]) if not columns.is_empty() else float(candidates[i].z)
		var radius: float = float(columns.crownRadiusM[i]) if not columns.is_empty() else float(candidates[i].get("crownRadiusM",float(candidates[i].size)*0.42))
		if not is_finite(radius) or radius<=0.0: continue
		var tree_y:float=float(columns.positions[i*3+1]) if not columns.is_empty() else float(candidates[i].y)
		var tree_size:float=float(columns.size[i]) if not columns.is_empty() else float(candidates[i].size)
		if not has_height_origin:height_origin=tree_y;has_height_origin=true
		var id: String = str(columns.ids[i]) if not columns.is_empty() else str(candidates[i].stableId)
		if unsupported.has(id):
			unsupported_trees+=1
			continue
		var is_selected := selected.has(id)
		var bin := radius_class(radius)
		trees+=1
		if is_selected: selected_trees+=1
		for iz in range(maxi(0,ceili((z-radius-float(origin.z))/spacing)),mini(height-1,floori((z+radius-float(origin.z))/spacing))+1):
			var dz := float(origin.z)+float(iz)*spacing-z
			var half := sqrt(maxf(0.0,radius*radius-dz*dz))
			for ix in range(maxi(0,ceili((x-half-float(origin.x))/spacing)),mini(width-1,floori((x+half-float(origin.x))/spacing))+1):
				var index := iz*width+ix
				coverage[index]=1.0
				var dx=float(origin.x)+float(ix)*spacing-x
				var top=sqrt(maxf(0.0,1.0-(dx*dx+dz*dz)/(radius*radius)))
				var vertical_radius=tree_size*.33
				var crown_height=tree_y-height_origin+tree_size*.72+top*vertical_radius
				if crown_height>crown_heights[index]:
					crown_heights[index]=crown_height
					var normal=Vector3(dx/radius,top*radius/maxf(vertical_radius,.01),dz/radius).normalized()
					normal_values[index*4]=normal.x*.5+.5;normal_values[index*4+1]=normal.y*.5+.5;normal_values[index*4+2]=normal.z*.5+.5;normal_values[index*4+3]=1.0
				if is_selected: counts[index*4+bin]+=1.0
	var coverage_image := Image.create_from_data(width,height,false,Image.FORMAT_RF,coverage.to_byte_array())
	coverage_image.generate_mipmaps() # Linear coverage, not sRGB and not overlap counts.
	var normal_image:=Image.create_from_data(width,height,false,Image.FORMAT_RGBAF,normal_values.to_byte_array());normal_image.generate_mipmaps()
	var counts_image := Image.create_from_data(width,height,false,Image.FORMAT_RGBAF,counts.to_byte_array())
	var digest=HashingContext.new();digest.start(HashingContext.HASH_SHA256)
	for image in [coverage_image,counts_image,normal_image]:digest.update(image.get_data())
	var world:Dictionary=packet.get("world",{})
	var source:Dictionary=packet.get("source",{})
	var source_descriptor={"worldId":world.get("id"),"seed":world.get("seed"),"sourceEpoch":source.get("sourceEpoch"),"sceneEpoch":source.get("sceneEpoch"),"canonicalContextId":world.get("canonicalContextRef",{}).get("id",world.get("canonicalContext",{}).get("id")),"versions":world.get("versions",{}),"terrainSource":world.get("terrain",{}).get("source",{}),"completeTreePage":page}
	var atlas := {"atlasHash":digest.finish().hex_encode(),"sourceDescriptor":source_descriptor,"available":true,"version":"canopy-r5-whole-frustum-phase","coverageImage":coverage_image,"countsImage":counts_image,"normalImage":normal_image,
		"worldId":str(packet.get("world",{}).get("id","")),"page":page,"pageBounds":page_bounds,"origin":origin,"spacingM":spacing,"gridSize":Vector2(width,height),"bounds":bounds,"fallbackBlendM":transition_widths(bounds).paint,"geometryBlendM":transition_widths(bounds).geometry,
		"linearAlbedo":LINEAR_ALBEDO,"treeCount":trees,"selectedTreeCount":selected_trees,"unsupportedTreeCount":unsupported_trees,
		"scope":"Exact inventory only when the whole viewport and halo are covered; otherwise whole-view renderer-only meso, never candidate IDs"}
	_cached_packet=packet
	_cached_selection=selected.duplicate()
	_cached_view_bounds=view_bounds.duplicate()
	_cached_unsupported=unsupported.duplicate()
	_cached_atlas=atlas
	return atlas

# Stable renderer phase depends only on canonical seed and absolute double origin.
# Tile IDs, source versions and levels never enter the approximate crown layout.
static func meso_parameters(world:Dictionary,origin:Dictionary)->Dictionary:
	return {"canopy_meso_phase":Vector4(fposmod(float(origin.x)/MESO_CELL_M,1.0),fposmod(float(origin.z)/MESO_CELL_M,1.0),posmod(floori(float(origin.x)/MESO_CELL_M),1048576),posmod(floori(float(origin.z)/MESO_CELL_M),1048576)),"canopy_meso_seed":int(str(world.get("seed",0)).hash()&0x7fffffff)}

static func shadow_offset(to_light:Vector3,height_m:float=8.0)->Vector2:
	return -Vector2(to_light.x,to_light.z)*clampf(height_m,0.0,32.0)/maxf(to_light.y,.1)
