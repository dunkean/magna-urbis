class_name SurfaceMaterialLibrary
extends RefCounted
const ATLAS_SIZE := 1024

var albedo_height := Texture2DArray.new()
var normal_rough := Texture2DArray.new()
var layers: Dictionary = {}
var scales: Dictionary = {}
var loaded_assets: Array = []
var layer_means := PackedColorArray()

func load_manifest(path: String) -> void:
	var albedos: Array[Image] = []
	var normals: Array[Image] = []
	# Neutral fallback is an explicit analytic material, usable offline.
	var alb := Image.create(64,64,false,Image.FORMAT_RGBA8)
	var nrm := Image.create(64,64,false,Image.FORMAT_RGBA8)
	var fallback_sum := Color(0,0,0,0)
	for y in 64:
		for x in 64:
			var grain := sin(float(x)*2.43+sin(float(y)*1.79))*0.04
			alb.set_pixel(x,y,Color(0.5+grain,0.5+grain,0.5+grain,0.5+grain))
			fallback_sum += Color(0.5+grain,0.5+grain,0.5+grain).srgb_to_linear()
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
			if diffuse == null or normal == null or rough == null or height == null:
				continue
			var ah := Image.create(ATLAS_SIZE,ATLAS_SIZE,false,Image.FORMAT_RGBA8)
			var nr := Image.create(ATLAS_SIZE,ATLAS_SIZE,false,Image.FORMAT_RGBA8)
			var red := 0.0
			var green := 0.0
			var blue := 0.0
			for y in ATLAS_SIZE:
				for x in ATLAS_SIZE:
					var color := diffuse.get_pixel(x,y)
					var linear := color.srgb_to_linear()
					red+=linear.r; green+=linear.g; blue+=linear.b
					color.a = height.get_pixel(x,y).r
					ah.set_pixel(x,y,color)
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
				layers[family] = layer
				scales[family] = scales[asset_id]
			loaded_assets.append(asset_id)
			albedos.append(ah)
			normals.append(nr)
			layer_means.append(Color(red/(ATLAS_SIZE*ATLAS_SIZE),green/(ATLAS_SIZE*ATLAS_SIZE),blue/(ATLAS_SIZE*ATLAS_SIZE),1))
	albedo_height.create_from_images(albedos)
	normal_rough.create_from_images(normals)

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
	var colors := PackedColorArray()
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
		colors.append(Color(float(rgb[0]),float(rgb[1]),float(rgb[2]),float(recipe.roughness)))
		var family: String = recipe.family
		var material_key: String = {"forest-litter":"litter","vegetation-litter":"grass","mineral-soil":"soil","alluvial-bars":"gravel","angular-talus":"gravel","fractured-bedrock":"rock","wind-ripple-sand":"sand"}.get(recipe.id,family)
		var scale: float = scales.get(material_key,float(recipe.physicalExtentMetres))
		material_scales.append(scale)
		material_layers.append(layers.get(material_key,0))
		phases.append(Vector2(fposmod(origin.x/scale,1.0),fposmod(origin.z/scale,1.0)))
		y_phases.append(fposmod(origin.y/scale,1.0))
		lattice_xz.append(_lattice_phase(origin.x/scale,origin.z/scale))
		lattice_zy.append(_lattice_phase(origin.z/scale,origin.y/scale))
		lattice_xy.append(_lattice_phase(origin.x/scale,origin.y/scale))
	material.set_shader_param("material_phase_y",y_phases)
	material.set_shader_param("material_lattice_xz",lattice_xz)
	material.set_shader_param("material_lattice_zy",lattice_zy)
	material.set_shader_param("material_lattice_xy",lattice_xy)
	material.set_shader_param("noise_phase_16",_cell_phase(origin.x/16.0,origin.z/16.0))
	material.set_shader_param("noise_phase_9",_cell_phase(origin.x/9.0,origin.z/9.0))
	var means := PackedColorArray()
	for i in 32: means.append(layer_means[mini(i,layer_means.size()-1)])
	material.set_shader_param("layer_mean",means)
	for entry in {"palette":colors,"material_scales":material_scales,"material_layers":material_layers,"material_phase":phases,"pbr_albedo_height":albedo_height,"pbr_normal_rough":normal_rough,"world_phase":Vector2(fposmod(origin.x,4096.0),fposmod(origin.z,4096.0))}:
		material.set_shader_param(entry,{"palette":colors,"material_scales":material_scales,"material_layers":material_layers,"material_phase":phases,"pbr_albedo_height":albedo_height,"pbr_normal_rough":normal_rough,"world_phase":Vector2(fposmod(origin.x,4096.0),fposmod(origin.z,4096.0))}[entry])

func _lattice_phase(u: float, v: float) -> Vector4:
	return _cell_phase(u-0.577350269*v,1.154700538*v)

func _cell_phase(u: float, v: float) -> Vector4:
	return Vector4(fposmod(u,1.0),fposmod(v,1.0),floorf(u),floorf(v))

