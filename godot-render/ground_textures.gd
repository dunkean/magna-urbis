extends RefCounted
## Local PBR library and one persistent asset choice per type and world.
const CATALOGUE="res://ground_texture_catalogue.json"
const LIBRARY="res://materials/prepared/library.json"
const SAVE="user://ground-texture-palettes-v1.json"
var catalogue:Dictionary={}
var library:Dictionary={}
var assets:Dictionary={}
var types:Array=[]
var selected:Array=[]
var settings:Dictionary={"seed":0,"worlds":{}}
var world_seed:=""
var palette_seed:=0
var color_array:=Texture2DArray.new()
var nr_array:=Texture2DArray.new()
var height_array:=Texture2DArray.new()
var palette_texture:ImageTexture
var ready:=false
var error:=""

func initialize(shader_material:ShaderMaterial)->bool:
	if ready:return true
	error=""
	if not FileAccess.file_exists(LIBRARY):error="Bibliothèque PBR absente : lancer prepare_ground_textures.py";return false
	catalogue=JSON.parse_string(FileAccess.get_file_as_string(CATALOGUE))
	library=JSON.parse_string(FileAccess.get_file_as_string(LIBRARY))
	types=catalogue.types
	var colors:Array[Image]=[];var normals:Array[Image]=[];var heights:Array[Image]=[]
	for entry in library.assets:
		var index=colors.size();assets[entry.ref]={"index":index,"entry":entry}
		for pair in [["color",colors],["normalRoughness",normals],["height",heights]]:
			var path=LIBRARY.get_base_dir().path_join(entry[pair[0]])
			var image=Image.new()
			if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path))!=OK:error="Texture PBR absente : "+path;return false
			image.convert(Image.FORMAT_R8 if pair[0]=="height" else Image.FORMAT_RGBA8)
			image.generate_mipmaps();pair[1].append(image)
	if color_array.create_from_images(colors)!=OK or nr_array.create_from_images(normals)!=OK or height_array.create_from_images(heights)!=OK:
		error="Création des tableaux de textures impossible";return false
	shader_material.set_shader_parameter("ground_colors",color_array)
	shader_material.set_shader_parameter("ground_normals",nr_array)
	shader_material.set_shader_parameter("ground_heights",height_array)
	if FileAccess.file_exists(SAVE):
		var saved=JSON.parse_string(FileAccess.get_file_as_string(SAVE))
		if saved is Dictionary and saved.get("worlds") is Dictionary:settings=saved
	palette_seed=int(settings.get("seed",0));ready=true
	return true

func hash_number(key:String)->int:return key.sha256_buffer().decode_u32(0)

func base_scale(id:String)->float:
	if id.begins_with("R"):return 5.0
	if id.begins_with("G"):return 3.0
	if id.begins_with("F"):return 2.5
	if id.begins_with("P") or id.begins_with("H"):return 2.0
	if id.begins_with("N") or id.begins_with("I"):return 4.0
	return 3.0

func target_color(id:String,mean:Vector3)->Vector3:
	# Bare-rock means share a restrained mineral palette. Image mean differences
	# must not expose the repeating geological prior at map scale. Litter,
	# herbs, moss and snow keep their own source palettes.
	if id.begins_with("R") and int(id.substr(1))<=20:
		var targets=[Vector3(.235,.232,.220),Vector3(.245,.240,.220),Vector3(.237,.222,.200),Vector3(.225,.220,.209),Vector3(.200,.207,.208)]
		return targets[int((int(id.substr(1))-1)/4)]
	return mean

func resolve(seed_value:String,shader_material:ShaderMaterial,reroll:bool=false)->void:
	error=""
	world_seed=seed_value
	if reroll:
		settings.seed=int(settings.get("seed",0))+1;settings.worlds.erase(world_seed)
	var saved:Dictionary=settings.worlds.get(world_seed,{})
	var keep:bool=saved.get("version","")==catalogue.paletteVersion and saved.get("choices",[]).size()==types.size()
	palette_seed=int(saved.get("seed",0)) if keep else int(settings.get("seed",0))
	selected=[]
	var image=Image.create(types.size(),4,false,Image.FORMAT_RGBAF)
	for i in types.size():
		var type:Dictionary=types[i];var pool:Array=[]
		for ref in type.candidates:
			if assets.has(ref):pool.append(ref)
		pool.sort()
		if pool.is_empty():error="Aucun candidat préparé : "+str(type.id);return
		var key=world_seed+"|"+str(palette_seed)+"|"+str(catalogue.paletteVersion)+"|"+str(type.id)
		if pool.size()==1:key=world_seed+"|fixed|"+str(catalogue.paletteVersion)+"|"+str(type.id)
		var chosen:String=pool[hash_number(key)%pool.size()]
		if keep and saved.choices[i].get("asset","") in pool:chosen=saved.choices[i].asset
		var asset:Dictionary=assets[chosen]
		var mean=Vector3(asset.entry.meanLinear[0],asset.entry.meanLinear[1],asset.entry.meanLinear[2])
		var target=target_color(type.id,mean)
		# Affine, mean-centred recolouring keeps [0,1] in [0,1], without
		# amplifying a dark source or introducing a different distant mean.
		var gain=Vector3.ONE
		for channel in 3:gain[channel]=minf(1.0,minf(target[channel]/maxf(mean[channel],.00001),(1-target[channel])/maxf(1-mean[channel],.00001)))
		var scale=base_scale(type.id)*(.92+.16*float(hash_number(key+"|scale")%1000)/999.0)
		if keep:scale=float(saved.choices[i].get("scale",scale))
		var orient:bool=type.id in ["R06","R09","R15","S05","N05"]
		var amplitude=.45 if type.id.begins_with("R") else .28
		image.set_pixel(i,0,Color(float(asset.index),scale,1.0 if orient else 0.0,amplitude))
		image.set_pixel(i,1,Color(target.x,target.y,target.z,1))
		image.set_pixel(i,2,Color(gain.x,gain.y,gain.z,0))
		# Data row for the material inspector; source hashes live in library.json.
		image.set_pixel(i,3,Color(float(hash_number(key+"|uv")%1000)/999.0,mean.x,mean.y,mean.z))
		selected.append({"type":type.id,"asset":chosen,"scale":scale,"meanLinear":[target.x,target.y,target.z],"preparedSha256":asset.entry.preparedSha256})
	palette_texture=ImageTexture.create_from_image(image)
	shader_material.set_shader_parameter("ground_palette",palette_texture)
	settings.worlds[world_seed]={"version":catalogue.paletteVersion,"seed":palette_seed,"choices":selected}
	var file=FileAccess.open(SAVE,FileAccess.WRITE)
	if file:file.store_string(JSON.stringify(settings,"  "))

func describe(index:int)->String:
	if index<0 or index>=selected.size():return ""
	return str(types[index].label)+" · "+str(selected[index].asset)
