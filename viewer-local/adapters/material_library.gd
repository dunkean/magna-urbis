class_name SurfaceMaterialLibrary
extends RefCounted
const ATLAS_SIZE := 1024
# Bump when channel packing, colour decode, filtering or mean-residual semantics change.
const PIPELINE_VERSION := "surface-pbr-linear-ah16f-normalgl-nr8-stochastic3-mean-residual-v2"
const MAP_NAMES := ["baseColor","normal","roughness","height"]
const MAP_ALIASES := ["Diffuse","NormalGL","Rough","Displacement"]
var asset_version: Dictionary = {}
var asset_digest := ""
var loaded_asset_bindings: Dictionary = {}
var _version_assets: Array = []
var _height_fallbacks: Array = []

static func _canonical(value):
	if value is Dictionary:
		var result := {}; var keys=value.keys(); keys.sort()
		for key in keys: result[key]=_canonical(value[key])
		return result
	if value is Array:
		var result := []
		for child in value: result.append(_canonical(child))
		return result
	return value

static func _asset_record(asset: Dictionary, height_fallback := false) -> Dictionary:
	var maps := {}; var input: Dictionary = asset.get("maps",{})
	for i in MAP_NAMES.size():
		var map=input.get(MAP_NAMES[i],input.get(MAP_ALIASES[i],{}))
		maps[MAP_NAMES[i]]={"sha256":str(map.get("sha256","")).to_lower(),"actualSha256":str(map.get("actualSha256","")).to_lower()} if map is Dictionary else {"sha256":"","actualSha256":""}
	var recipes: Array = asset.get("recipeIds",[]).duplicate(); recipes.sort()
	var families: Array = asset.get("families",[]).duplicate(); families.sort()
	return {"assetId":str(asset.get("id",asset.get("assetId","unknown"))),"providerAssetId":str(asset.get("assetId",asset.get("id","unknown"))),"recipeIds":recipes,"families":families,"physicalExtentMetres":float(asset.get("physicalExtentMetres",asset.get("physicalSizeM",4.0))),"heightAmplitudeMetres":float(asset.get("heightAmplitudeMetres",0.0)),"heightFallback":0.5 if height_fallback else null,"maps":maps}

# Pure provenance operation: paths, URLs and dictionary insertion order are not inputs.
static func describe_assets(assets: Array, height_fallbacks: Array = []) -> Dictionary:
	var records := []; var bindings := {}
	for asset in assets:
		var record := _asset_record(asset,height_fallbacks.has(str(asset.get("id",asset.get("assetId","unknown")))))
		records.append(record)
		bindings[record.assetId]=record.assetId
		for family in asset.get("families",[]):
			if not bindings.has(family): bindings[family]=record.assetId
		for recipe in asset.get("recipeIds",[]): bindings["recipe:"+str(recipe)]=record.assetId
	records.sort_custom(func(a,b): return a.assetId<b.assetId)
	var value := {"format":"magna-surface-render-assets","version":1,"pipelineVersion":PIPELINE_VERSION,"atlasSize":ATLAS_SIZE,"fallback":{"height":0.5,"kind":"analytic-neutral"},"assets":records,"bindings":bindings}
	value=_canonical(value)
	value["digest"]=JSON.stringify(value).sha256_text()
	return value

func _finish_asset_version() -> void:
	asset_version=describe_assets(_version_assets,_height_fallbacks)
	asset_digest=asset_version.digest
	loaded_asset_bindings.clear()
	for key in layers:
		var layer: int = layers[key]; var color: Color = layer_means[layer]
		loaded_asset_bindings[key]={"assetId":str(loaded_assets[layer-1]),"layer":layer,"physicalExtentMetres":scales[key],"meanColorLinear":[color.r,color.g,color.b]}

func _version_asset(asset: Dictionary, manifest_path: String) -> Dictionary:
	var record := asset.duplicate(true); var input: Dictionary = record.get("maps",{})
	for i in MAP_NAMES.size():
		var name: String = MAP_NAMES[i] if input.has(MAP_NAMES[i]) else MAP_ALIASES[i]
		var map=input.get(name,{})
		var value: String = str(map.get("path",map.get("localPath",""))) if map is Dictionary else str(map)
		if not map is Dictionary: map={}
		if not value.is_empty():
			var path := value if value.is_absolute_path() else manifest_path.get_base_dir().path_join(value)
			if FileAccess.file_exists(path): map["actualSha256"]=FileAccess.get_sha256(path)
		input[name]=map
	record["maps"]=input
	return record

var albedo_height := Texture2DArray.new()
var normal_rough := Texture2DArray.new()
var layers: Dictionary = {}
var scales: Dictionary = {}
var loaded_assets: Array = []
var layer_means := PackedColorArray()

func load_manifest(path: String) -> void:
	layers.clear(); scales.clear(); loaded_assets.clear(); layer_means.clear(); _version_assets.clear(); _height_fallbacks.clear()
	var albedos: Array[Image] = []
	var normals: Array[Image] = []
	# Neutral fallback is an explicit analytic material, usable offline.
	var alb := Image.create(64,64,false,Image.FORMAT_RGBAH)
	var nrm := Image.create(64,64,false,Image.FORMAT_RGBA8)
	var fallback_sum := Color(0,0,0,0)
	for y in 64:
		for x in 64:
			var grain := sin(float(x)*2.43+sin(float(y)*1.79))*0.04
			var linear := Color(0.5+grain,0.5+grain,0.5+grain).srgb_to_linear()
			fallback_sum += linear
			linear.a=0.5+grain
			alb.set_pixel(x,y,linear)
			nrm.set_pixel(x,y,Color(0.5+grain,0.5-grain,1.0,0.85))
	alb.resize(ATLAS_SIZE,ATLAS_SIZE)
	nrm.resize(ATLAS_SIZE,ATLAS_SIZE)
	alb.generate_mipmaps()
	nrm.generate_mipmaps()
	albedos.append(alb)
	normals.append(nrm)
	layer_means.append(fallback_sum/4096.0)
	if not path.is_empty():
		var manifest := SurfaceData.read_json(path)
		var assets = manifest.get("assets",manifest.get("materials",[]))
		if assets is Dictionary:
			assets = assets.values()
		for asset in assets:
			var maps: Dictionary = asset.get("maps",{})
			var diffuse := _load_image(maps.get("baseColor",maps.get("Diffuse","")),path)
			var normal := _load_image(maps.get("normal",maps.get("NormalGL","")),path)
			var rough := _load_image(maps.get("roughness",maps.get("Rough","")),path)
			var height := _load_image(maps.get("height",maps.get("Displacement","")),path)
			if diffuse == null or normal == null or rough == null:
				continue
			if height==null:
				_height_fallbacks.append(str(asset.get("id",asset.get("assetId","unknown"))))
				height=Image.create(ATLAS_SIZE,ATLAS_SIZE,false,Image.FORMAT_RF)
				height.fill(Color(0.5,0,0,1))
				push_warning("PBR height unavailable for "+str(asset.get("id","unknown"))+"; using explicit flat-height fallback")
			var ah := Image.create(ATLAS_SIZE,ATLAS_SIZE,false,Image.FORMAT_RGBAH)
			var nr := Image.create(ATLAS_SIZE,ATLAS_SIZE,false,Image.FORMAT_RGBA8)
			var red := 0.0
			var green := 0.0
			var blue := 0.0
			for y in ATLAS_SIZE:
				for x in ATLAS_SIZE:
					var color := diffuse.get_pixel(x,y)
					var linear := color.srgb_to_linear()
					red+=linear.r; green+=linear.g; blue+=linear.b
					linear.a = height.get_pixel(x,y).r
					ah.set_pixel(x,y,linear)
					color = normal.get_pixel(x,y)
					color.a = rough.get_pixel(x,y).r
					nr.set_pixel(x,y,color)
			ah.generate_mipmaps()
			nr.generate_mipmaps()
			var layer := albedos.size()
			var asset_id: String = asset.get("id",asset.get("assetId","unknown"))
			layers[asset_id] = layer
			scales[asset_id] = float(asset.get("physicalExtentMetres",asset.get("physicalSizeM",4.0)))
			for family in asset.get("families",[]):
				if not layers.has(family):
					layers[family] = layer
					scales[family] = scales[asset_id]
			for recipe_id in asset.get("recipeIds",[]):
				layers["recipe:"+str(recipe_id)]=layer
				scales["recipe:"+str(recipe_id)]=scales[asset_id]
			_version_assets.append(_version_asset(asset,path))
			loaded_assets.append(asset_id)
			albedos.append(ah)
			normals.append(nr)
			layer_means.append(Color(red/(ATLAS_SIZE*ATLAS_SIZE),green/(ATLAS_SIZE*ATLAS_SIZE),blue/(ATLAS_SIZE*ATLAS_SIZE),1))
	albedo_height.create_from_images(albedos)
	normal_rough.create_from_images(normals)
	_finish_asset_version()

func _load_image(value, manifest_path: String) -> Image:
	if value is Dictionary:
		value = value.get("path",value.get("localPath",""))
	if not value is String or value.is_empty():
		return null
	var path: String = value
	if not path.is_absolute_path():
		path = manifest_path.get_base_dir().path_join(path)
	var img := Image.load_from_file(path)
	if img == null or img.is_empty():
		return null
	img.convert(Image.FORMAT_RGBA8)
	img.resize(ATLAS_SIZE,ATLAS_SIZE,Image.INTERPOLATE_LANCZOS)
	return img

func configure(material: Object, world: Dictionary, origin: Dictionary) -> void:
	var colors := PackedVector4Array()
	var material_scales := PackedFloat32Array()
	var material_layers := PackedInt32Array()
	var phases := PackedVector2Array()
	var y_phases := PackedFloat32Array()
	var lattice_xz: Array[Vector4] = []
	var lattice_zy: Array[Vector4] = []
	var lattice_xy: Array[Vector4] = []
	for i in 32:
		var recipe: Dictionary = world.materials[mini(i,world.materials.size()-1)]
		var rgb: Array = recipe.colorLinear
		colors.append(Vector4(float(rgb[0]),float(rgb[1]),float(rgb[2]),float(recipe.roughness)))
		var family: String = recipe.family
		var material_key: String = {"forest-litter":"litter","vegetation-litter":"grass","mineral-soil":"soil","organic-soil":"soil","alluvial-bars":"gravel","angular-talus":"gravel","fractured-bedrock":"rock","wind-ripple-sand":"sand"}.get(recipe.id,family)
		if layers.has("recipe:"+str(recipe.id)): material_key="recipe:"+str(recipe.id)
		var scale: float = scales.get(material_key,float(recipe.physicalExtentMetres))
		material_scales.append(scale)
		material_layers.append(layers.get(material_key,0))
		phases.append(Vector2(fposmod(origin.x/scale,1.0),fposmod(origin.z/scale,1.0)))
		y_phases.append(fposmod(-origin.y/scale,1.0))
		lattice_xz.append(_lattice_phase(origin.x/scale,origin.z/scale))
		lattice_zy.append(_lattice_phase(origin.z/scale,-origin.y/scale))
		lattice_xy.append(_lattice_phase(origin.x/scale,-origin.y/scale))
	material.set_shader_param("material_phase_y",y_phases)
	material.set_shader_param("material_lattice_xz",lattice_xz)
	material.set_shader_param("material_lattice_zy",lattice_zy)
	material.set_shader_param("material_lattice_xy",lattice_xy)
	material.set_shader_param("noise_phase_16",_cell_phase(origin.x/16.0,origin.z/16.0))
	material.set_shader_param("noise_phase_9",_cell_phase(origin.x/9.0,origin.z/9.0))
	# Color Variants are implicitly sRGB-decoded by Godot's uniform uploader even
	# for numeric vec4 arrays. Explicit Vector4 values preserve these linear means.
	var means := PackedVector4Array()
	for i in 32:
		var mean_color := layer_means[mini(i,layer_means.size()-1)]
		means.append(Vector4(mean_color.r,mean_color.g,mean_color.b,mean_color.a))
	material.set_shader_param("layer_mean",means)
	var parameters := {"palette":colors,"material_scales":material_scales,"material_layers":material_layers,"material_phase":phases,"pbr_albedo_height":albedo_height,"pbr_normal_rough":normal_rough}
	for entry in parameters: material.set_shader_param(entry,parameters[entry])

func _lattice_phase(u: float, v: float) -> Vector4:
	return _cell_phase(u-0.577350269*v,1.154700538*v)

# Shares the loaded arrays, registered means and authored physical texture scale.
# Projection is anchored at each clast's centre, with a renderer-only variant phase.
func configure_clast(material:ShaderMaterial,recipe_id:String,variant:int)->Dictionary:
	var key="recipe:"+recipe_id
	var exact=layers.has(key)
	if not layers.has(key):key={"carbonate-karst":"karst","volcanic-crust":"volcanic"}.get(recipe_id,"rock")
	if not layers.has(key):key="rock"
	var layer=int(layers.get(key,0));var scale=maxf(float(scales.get(key,3.0)),.25)
	var phase=Vector3(fposmod(float(variant*13),31),fposmod(float(variant*7),29),fposmod(float(variant*19),37))
	var means=PackedVector4Array()
	for i in 32:
		var mean:Color=layer_means[mini(i,layer_means.size()-1)];means.append(Vector4(mean.r,mean.g,mean.b,mean.a))
	var values={"pbr_albedo_height":albedo_height,"pbr_normal_rough":normal_rough,"layer_mean":means,"clast_layer":layer,"clast_scale_m":scale,"clast_phase":Vector3(fposmod(phase.x,1),fposmod(phase.y,1),fposmod(phase.z,1)),"clast_lattice_xz":_lattice_phase(phase.x,phase.z),"clast_lattice_zy":_lattice_phase(phase.z,phase.y),"clast_lattice_xy":_lattice_phase(phase.x,phase.y)}
	for name in values:material.set_shader_parameter(name,values[name])
	return {"recipeId":recipe_id,"recipeBindingExact":exact,"materialKey":key,"analyticFallback":layer==0,"assetId":loaded_assets[layer-1] if layer>0 else "analytic-neutral","layer":layer,"physicalExtentMetres":scale,"assetDigest":asset_digest,"projection":"centre-anchored world-oriented physical metres; stable renderer variant phase","heightUsage":"sampled registered channel; no displacement or source/pivot change"}

func _cell_phase(u: float, v: float) -> Vector4:
	return Vector4(fposmod(u,1.0),fposmod(v,1.0),floorf(u),floorf(v))

