class_name SurfacePresentation
extends RefCounted

# Optional native preview of the shared mapper profile. Never changes the
# source geometry, material IDs, environment fields, source palette or layout.
const NativeMaterial=preload("res://adapters/surface_native_material.gd")
static var _catalogues: Dictionary = {}
static var _materials: Dictionary = {}
static var _road_textures:Dictionary={}

static func overrides(packet: Dictionary, style_name := "", catalogue_path := "") -> Dictionary:
	var result := packet.duplicate(false)
	result["_presentation_style"]=style_name
	result["_presentation_catalogue"]=catalogue_path
	return result

static func profile(packet: Dictionary, mode := "") -> Dictionary:
	var source_value=packet.get("source")
	var source:Dictionary=source_value if source_value is Dictionary else {}
	var presentation_value=packet.get("presentation",source.get("presentation"))
	var presentation:Dictionary=presentation_value if presentation_value is Dictionary else {}
	var palette_value=presentation.get("palette")
	var palette:Dictionary=palette_value if palette_value is Dictionary else {}
	var selected: String = packet.get("_presentation_style",packet.get("_style",""))
	var catalogue_path: String = packet.get("_presentation_catalogue",packet.get("_styleCatalogue",""))
	var terrain_style: Dictionary = {}
	if not selected.is_empty() and not catalogue_path.is_empty():
		var stamp := FileAccess.get_modified_time(catalogue_path)
		if not _catalogues.has(catalogue_path) or _catalogues[catalogue_path].stamp!=stamp:
			var value=JSON.parse_string(FileAccess.get_file_as_string(catalogue_path))
			if value is Dictionary and value.get("format","")=="magna-surface-palette-catalogue" and value.get("version",0)==1:
				_catalogues[catalogue_path]={"stamp":stamp,"value":value}
		if _catalogues.has(catalogue_path):
			var catalogue: Dictionary = _catalogues[catalogue_path].value
			terrain_style=catalogue.get("terrainStyles",{}).get(selected,{})
			palette=terrain_style.get("palette",catalogue.get("palettes",{}).get(selected,palette))
	var resolved := mode if not mode.is_empty() else str(presentation.get("defaultView","aerial"))
	var identity := selected if not selected.is_empty() else str(presentation.get("mapStyle",palette.get("name","unspecified")))
	return {"mode":resolved,"cartographic":resolved=="cartographic","palette":palette,"mapStyle":identity,"terrainStyle":terrain_style,"source":presentation,"coverage":"native geometry, palette, material groups and orthographic preview; SVG/Canvas retain brush effects, labels and final layout"}

static func color_linear(css: String, fallback := Vector3(0.3,0.3,0.3)) -> Vector3:
	if css.is_empty(): return fallback
	var color := Color.from_string(css,Color(fallback.x,fallback.y,fallback.z).linear_to_srgb()).srgb_to_linear()
	return Vector3(color.r,color.g,color.b)

static func _token(palette: Dictionary, key: String, fallback: Vector3) -> Vector3:
	return color_linear(str(palette.get(key,"")),fallback)

static func configure_environment(settings: Environment, mode: String, packet: Dictionary) -> void:
	var resolved := profile(packet,mode)
	if resolved.cartographic or mode=="diagnostic":
		settings.tonemap_mode=Environment.TONE_MAPPER_LINEAR
		settings.tonemap_exposure=1.0
	else:
		settings.tonemap_mode=Environment.TONE_MAPPER_FILMIC
		settings.tonemap_exposure=1.0
	if resolved.cartographic:
		if not settings.has_meta("surfaceAerialEnvironment"):
			settings.set_meta("surfaceAerialEnvironment",{"ssao":settings.ssao_enabled,"ssil":settings.ssil_enabled,"fog":settings.fog_enabled})
		# White ambient preserves CSS albedo and lets Forward+ Decals blend.
		# The scene owner must also set direct-light energy to zero.
		settings.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
		settings.ambient_light_color=Color.WHITE
		settings.ambient_light_energy=1.0
		settings.reflected_light_source=Environment.REFLECTION_SOURCE_DISABLED
		settings.ssao_enabled=false
		settings.ssil_enabled=false
		settings.fog_enabled=false
		settings.background_mode=Environment.BG_COLOR
		settings.background_color=Color.from_string(str(resolved.palette.get("paper","#eeeeee")),Color(0.93,0.93,0.93))
	else:
		settings.background_mode=Environment.BG_SKY
		settings.ambient_light_source=Environment.AMBIENT_SOURCE_SKY
		settings.ambient_light_energy=0.55
		settings.reflected_light_source=Environment.REFLECTION_SOURCE_BG
		if settings.has_meta("surfaceAerialEnvironment"):
			var previous: Dictionary = settings.get_meta("surfaceAerialEnvironment")
			settings.ssao_enabled=previous.ssao
			settings.ssil_enabled=previous.ssil
			settings.fog_enabled=previous.fog

static func configure_terrain(material: Object, packet: Dictionary, mode: String) -> void:
	var resolved := profile(packet,mode)
	var palette: Dictionary = resolved.palette
	var land: Dictionary = palette.get("land",{})
	var urban: Dictionary = palette.get("urban",{})
	var paper := _token(palette,"paper",Vector3(0.7,0.66,0.55))
	var meadow := _token(land,"meadow",paper)
	var colors := PackedVector4Array()
	var recipes: Array = packet.get("world",{}).get("materials",[])
	for i in 32:
		var color := meadow
		if not recipes.is_empty():
			var recipe: Dictionary = recipes[mini(i,recipes.size()-1)]
			var family: String = recipe.get("family","")
			if family in ["bedrock","gravity","karst","volcanic","rocky-coast","arid-erosion"]: color=paper*0.85
			elif family in ["aeolian","sedimentary-coast","alluvial"]: color=paper
			elif family=="wetland": color=_token(land,"marsh",meadow)
			elif family in ["inland-water","marine"]: color=_token(palette,"lakeFill",Vector3(0.2,0.35,0.4))
			elif family=="snow-ice": color=Vector3(0.9,0.92,0.94)
			if recipe.get("id","")=="compacted-road": color=_token(palette,"roadFill",paper)
			if recipe.get("id","")=="cultivated-soil": color=_token(land,"field",paper)
			if recipe.get("id","")=="built-foundation": color=_token(urban,"yard",paper)
		colors.append(Vector4(color.x,color.y,color.z,1))
	material.call("set_shader_param","presentation_mode",1 if resolved.cartographic else 0)
	material.call("set_shader_param","map_palette",colors)
	material.call("set_shader_param","map_relief_shade",float(palette.get("shade",0.0)))
	material.call("set_shader_param","canopy_linear_albedo",canopy_color(packet,mode))

static func canopy_color(packet: Dictionary, mode: String) -> Vector3:
	var resolved := profile(packet,mode)
	return _token(resolved.palette,"treeFill",Vector3(0.055,0.105,0.036)) if resolved.cartographic else Vector3(0.055,0.105,0.036)

static func _flat_shader_material(color: Vector3, name: String) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	var shader := Shader.new()
	shader.code='shader_type spatial; render_mode unshaded,cull_back;\n#include "res://shaders/color_space.gdshaderinc"\nuniform vec3 linear_tint; void fragment(){ ALBEDO=display_color(linear_tint); }'
	material.shader=shader
	material.resource_name=name
	material.set_shader_parameter("linear_tint",color)
	return material

static func building_material(material_id, slots: Dictionary, surface_name: String, packet: Dictionary, mode: String) -> Material:
	var resolved := profile(packet,mode)
	var id := NativeMaterial.resolve(material_id,slots,surface_name)
	var pattern := "plain"
	for source_material in packet.get("urban",{}).get("materials",[]):
		if str(source_material.get("id",""))==id: pattern=str(source_material.get("pattern","plain")); break
	var key := JSON.stringify([resolved.mapStyle,resolved.mode,resolved.palette,id,pattern,surface_name,slots]).sha256_text()
	if _materials.has(key): return _materials[key]
	var material: Material
	if resolved.cartographic:
		var palette: Dictionary = resolved.palette.get("urban",{})
		var color := _token(palette,"mass" if surface_name=="roof" else "wallFill",Vector3(0.35,0.26,0.17))
		material=_flat_shader_material(color,"cartographic:"+id+":"+surface_name)
		var edge := _token(palette,"massEdge",Vector3(0.09,0.07,0.05))
		var outline := ShaderMaterial.new()
		var shader := Shader.new()
		shader.code='shader_type spatial; render_mode unshaded,cull_front;\n#include "res://shaders/color_space.gdshaderinc"\nuniform vec3 linear_tint; uniform float width_m; void vertex(){VERTEX+=NORMAL*width_m;} void fragment(){ALBEDO=display_color(linear_tint);}'
		outline.shader=shader
		outline.set_shader_parameter("linear_tint",edge)
		outline.set_shader_parameter("width_m",maxf(0.0,float(palette.get("massEdgeW",0.04))))
		material.next_pass=outline
	else:
		var tints := {"tile":Vector3(0.36,0.13,0.065),"thatch":Vector3(0.34,0.27,0.11),"wood":Vector3(0.16,0.085,0.04),"stone":Vector3(0.42,0.39,0.32),"earth":Vector3(0.33,0.24,0.15),"fabric":Vector3(0.46,0.39,0.28),"snow":Vector3(0.82,0.87,0.9),"plain":Vector3(0.55,0.48,0.36)}
		var color: Vector3 = tints.get(pattern,tints.plain)
		var physical := StandardMaterial3D.new()
		physical.albedo_color=Color(color.x,color.y,color.z).linear_to_srgb()
		physical.roughness=0.88
		physical.cull_mode=BaseMaterial3D.CULL_BACK
		physical.resource_name="native-pattern-preview:"+id
		material=physical
	material.set_meta("nativeMaterialId",id)
	material.set_meta("nativeMaterialSlots",slots.duplicate(true))
	material.set_meta("nativePattern",pattern)
	material.set_meta("nativeSurface",surface_name)
	material.set_meta("previewTintPolicy","shared cartographic palette or authored native pattern tint; source material IDs remain unchanged")
	# Bound native preview cache even across many source palette epochs.
	if _materials.size()>=512: _materials.erase(_materials.keys()[0])
	_materials[key]=material
	return material

static func road_material(packet: Dictionary, mode: String, road: Dictionary = {}) -> Material:
	var resolved := profile(packet,mode)
	if resolved.cartographic: return _flat_shader_material(_token(resolved.palette,"roadFill",Vector3(0.7,0.66,0.55)),"cartographic-road:"+str(road.get("class","road")))
	var material := ShaderMaterial.new()
	material.shader=load("res://shaders/road.gdshader")
	material.render_priority=2
	return material

static func water_material(packet: Dictionary, mode: String, kind := "lake") -> ShaderMaterial:
	var resolved := profile(packet,mode)
	var material := ShaderMaterial.new()
	material.shader=load("res://shaders/water.gdshader")
	material.render_priority=1
	var color := Vector3(0.018,0.095,0.125) if kind=="sea" else Vector3(0.028,0.10,0.115)
	if resolved.cartographic: color=_token(resolved.palette,"seaFill" if kind=="sea" else "riverFill" if kind=="river" else "lakeFill",color)
	material.set_shader_parameter("linear_tint",color)
	for entry in [["river","riverFill",Vector3(0.035,0.17,0.20)],["lake","lakeFill",Vector3(0.028,0.10,0.115)],["sea","seaFill",Vector3(0.018,0.095,0.125)]]:
		var tint:Vector3=_token(resolved.palette,entry[1],entry[2]) if resolved.cartographic else entry[2]
		material.set_shader_parameter("linear_"+str(entry[0])+"_tint",tint)
	material.set_shader_parameter("presentation_mode",1 if resolved.cartographic else 0)
	return material

static func city_map_material(packet:Dictionary,outline:=false)->Material:
	var palette:Dictionary=profile(packet,"cartographic").palette.get("urban",{})
	var color=_token(palette,"massEdge" if outline else "mass",Vector3(0.09,0.07,0.05) if outline else Vector3(0.35,0.26,0.17))
	return _flat_shader_material(color,"source-city-map-outline" if outline else "source-city-map-fill")

static func canopy_trunk_color(packet:Dictionary,mode:String)->Vector3:
	var resolved=profile(packet,mode)
	return _token(resolved.palette,"treeInk",Vector3(0.055,0.105,0.036)) if resolved.cartographic else Vector3(0.16,0.105,0.067)

# Decal textures are authored sRGB pixels. White modulation avoids an implicit
# second colour conversion; the border stays inside the declared source width.
static func road_decal_style(packet:Dictionary,mode:String,road:Dictionary={})->Dictionary:
	var resolved=profile(packet,mode)
	if not resolved.cartographic:return {"cartographic":false}
	var palette:Dictionary=resolved.palette
	var road_class=str(road.get("class","")).to_lower()
	var rural=road_class in ["track","path","way","headland","farm-track","rural-track"] or road.get("rural",false)==true
	var fill_css=str(palette.get("trackFill" if rural else "roadFill","#bbbbbb"))
	var edge_css=str(palette.get("roadEdge",fill_css))
	var key=JSON.stringify([fill_css,edge_css,"border-inside-1of8-v1"])
	if not _road_textures.has(key):
		var image=Image.create(128,8,false,Image.FORMAT_RGBA8)
		var fill=Color.from_string(fill_css,Color(0.73,0.73,0.73))
		var edge=Color.from_string(edge_css,fill)
		for y in 8:
			for x in 128:image.set_pixel(x,y,edge if x<16 or x>=112 else fill)
		if _road_textures.size()>=128:_road_textures.erase(_road_textures.keys()[0])
		_road_textures[key]=ImageTexture.create_from_image(image)
	return {"cartographic":true,"texture":_road_textures[key],"modulate":Color.WHITE,"albedoMix":1.0,"fillCSS":fill_css,"edgeCSS":edge_css,"borderFraction":0.125,"rural":rural}
