class_name SurfaceMaterialLibrary
extends RefCounted

var albedo_height := Texture2DArray.new()
var normal_rough := Texture2DArray.new()
var layers: Dictionary = {}
var scales: Dictionary = {}
var loaded_assets: Array = []

func load_manifest(path: String) -> void:
	var albedos: Array[Image] = []
	var normals: Array[Image] = []
	# Neutral fallback is an explicit analytic material, usable offline.
	var alb := Image.create(64,64,false,Image.FORMAT_RGBA8)
	var nrm := Image.create(64,64,false,Image.FORMAT_RGBA8)
	for y in 64:
		for x in 64:
			var grain := sin(float(x)*2.43+sin(float(y)*1.79))*0.04
			alb.set_pixel(x,y,Color(0.5+grain,0.5+grain,0.5+grain,0.5+grain))
			nrm.set_pixel(x,y,Color(0.5+grain,0.5-grain,1.0,0.85))
	alb.resize(512,512)
	nrm.resize(512,512)
	alb.generate_mipmaps()
	nrm.generate_mipmaps()
	albedos.append(alb)
	normals.append(nrm)
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
			var ah := Image.create(512,512,false,Image.FORMAT_RGBA8)
			var nr := Image.create(512,512,false,Image.FORMAT_RGBA8)
			for y in 512:
				for x in 512:
					var color := diffuse.get_pixel(x,y)
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
	img.resize(512,512,Image.INTERPOLATE_LANCZOS)
	return img

func configure(material: Object, world: Dictionary, origin: Dictionary) -> void:
	var colors := PackedColorArray()
	var material_scales := PackedFloat32Array()
	var material_layers := PackedInt32Array()
	var phases := PackedVector2Array()
	for i in 32:
		var recipe: Dictionary = world.materials[mini(i,world.materials.size()-1)]
		var rgb: Array = recipe.colorLinear
		colors.append(Color(float(rgb[0]),float(rgb[1]),float(rgb[2]),float(recipe.roughness)))
		var family: String = recipe.family
		var scale: float = scales.get(family,float(recipe.physicalExtentMetres))
		material_scales.append(scale)
		material_layers.append(layers.get(family,0))
		phases.append(Vector2(fposmod(origin.x/scale,4096.0),fposmod(origin.z/scale,4096.0)))
	for entry in {"palette":colors,"material_scales":material_scales,"material_layers":material_layers,"material_phase":phases,"pbr_albedo_height":albedo_height,"pbr_normal_rough":normal_rough,"world_phase":Vector2(fposmod(origin.x,4096.0),fposmod(origin.z,4096.0))}:
		material.set_shader_param(entry,{"palette":colors,"material_scales":material_scales,"material_layers":material_layers,"material_phase":phases,"pbr_albedo_height":albedo_height,"pbr_normal_rough":normal_rough,"world_phase":Vector2(fposmod(origin.x,4096.0),fposmod(origin.z,4096.0))}[entry])

