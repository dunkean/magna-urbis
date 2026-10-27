extends Node3D
## One terrain mesh, one material, two camera projections. All distances are metres.
const TileLocale = preload("res://tile_locale.gd")
const MaterialLocale = preload("res://tile_material_locale.gd")
const LayerLocale = preload("res://tile_layer_locale.gd")
var language:=TileLocale.normalize(OS.get_locale())
var ui_labels:Dictionary={}
var catalog:Dictionary
var catalog_dir:String
var current_index:=-1
var camera:=Camera3D.new()
var terrain:=MeshInstance3D.new()
var material:=ShaderMaterial.new()
var sun:=DirectionalLight3D.new()
var focus:=Vector3(20000,0,20000)
var view_width:=65000.0
var yaw:=0.0
var elevation:=PI/2.0
var top_view:=true
var orbit_yaw:=0.0
var orbit_elevation:=deg_to_rad(50)
var drag_pan:=false
var drag_orbit:=false
var selector:OptionButton
var family_filter:OptionButton
var climate_filter:OptionButton
var mode_button:Button
var status:Label
var hud:VBoxContainer
var capture_path:=""
var capture_frames:=0
var initial_tile:=""
var startup_frames:=0
var test_orbit:=false
var height_image:Image
var survey:Control
var altitude_label:Label
var cursor_altitude:Label
var vertex_height_cache:Dictionary={}
var terrain_max_height:=12000.0
var mesh_cells:=512
var survey_mouse:=Vector2(INF,INF)
var survey_transform:=Transform3D()
var survey_size:=Vector2.ZERO
var survey_tile:=-1
var cursor_hit:Variant=null
var info_selector:OptionButton
var info_legend:Label
var info_palette:GridContainer
var info_opacity:=1.0
var tile_layers:Array=[]
var tile_dir:=""
var selected_info:="none"
var ground_library=preload("res://ground_textures.gd").new()
var ground_view_selector:OptionButton
var ground_state_selector:OptionButton
var variants_button:Button
var ground_status:Label
var ground_view:=0
var ground_state:=0
var surface_meta:Dictionary={}
var current_meta:Dictionary={}
var ground_ids_image:Image
var ground_weights_image:Image
var ground_ids_extra_image:Image
var ground_weights_extra_image:Image
var ground_snow_image:Image
var cover_ids_image:Image
var cover_weights_image:Image
var ground_water_image:Image
var ground_river_image:Image
var ground_attributes_image:Image
var ground_states:=["mean","dry","wet","fresh-snow","rough-snow","compact-snow","old-snow","wind-snow","partial-snow","melt","ice-fine","ice-fractured"]
var original_cover_meta:Dictionary={}
var original_cover_loaded_dir:=""
var original_cover_image:Image
var forest_placement_image:Image
var grid_warp:=0.0
var grid_focus:=Vector2(20000,20000)
var detail_amount:=0.0
var meso=preload("res://mesoscale.gd").new()
var detail_enabled:=true
var grid_scale:=20000.0
var grid_domain:=Vector4(-1,1,-1,1)
var detail_context_ready:=false
var pick_bounds_cache:Dictionary={}
var pick_bounds_image:=0

class SurveyOverlay extends Control:
	var app:Node3D
	func _draw()->void:
		var mpp:float=app.ruler_metres_per_pixel()
		if mpp<=0:return
		var target=mpp*180.0
		var magnitude=pow(10.0,floor(log(target)/log(10.0)))
		var distance=magnitude*(5.0 if target/magnitude>=5 else 2.0 if target/magnitude>=2 else 1.0)
		var length=distance/mpp
		var origin=Vector2(28,size.y-36)
		var font=ThemeDB.fallback_font
		draw_style_box(get_theme_stylebox("panel","Panel"),Rect2(16,size.y-78,maxf(length+32,220),66))
		draw_line(origin,origin+Vector2(length,0),Color.WHITE,2,true)
		for fraction in [0.0,.5,1.0]:
			var point=origin+Vector2(length*fraction,0)
			draw_line(point+Vector2(0,-6),point+Vector2(0,6),Color.WHITE,2,true)
		var label=("%.1f km"%(distance/1000.0)) if distance>=1000 else ("%.0f m"%distance)
		draw_string(font,origin+Vector2(0,-12),"0",HORIZONTAL_ALIGNMENT_LEFT,-1,14,Color.WHITE)
		draw_string(font,origin+Vector2(length-font.get_string_size(label,HORIZONTAL_ALIGNMENT_LEFT,-1,14).x,-12),label,HORIZONTAL_ALIGNMENT_LEFT,-1,14,Color.WHITE)
		draw_string(font,origin+Vector2(0,23),app.locale_text("scale_center" if not app.top_view else "scale"),HORIZONTAL_ALIGNMENT_LEFT,-1,12,Color("c6cfd8"))

func locale_text(key:String)->String:return TileLocale.text(language,key)

func _ready()->void:
	var catalog_path="res://tiles/catalog.json"
	var args=OS.get_cmdline_user_args();var i=0
	while i<args.size():
		match args[i]:
			"--catalog":i+=1;catalog_path=args[i]
			"--lang":i+=1;language=TileLocale.normalize(args[i])
			"--tile":i+=1;initial_tile=args[i]
			"--capture":i+=1;capture_path=args[i];capture_frames=8
			"--oblique":test_orbit=true
			_:push_error("Unknown viewer option: "+args[i]);get_tree().quit(1);return
		i+=1
	var parsed=JSON.parse_string(FileAccess.get_file_as_string(catalog_path))
	if not parsed is Dictionary or parsed.get("format")!="magna-tile40-catalog" or parsed.get("tiles",[]).size()!=42:
		push_error("Catalogue incomplet : 42 tuiles requises — "+catalog_path);get_tree().quit(1);return
	catalog=parsed;catalog_dir=catalog_path.get_base_dir()
	get_window().title="Magna Urbis · Tuiles 40 × 40 km · Dessus / 3D"
	var environment:=WorldEnvironment.new();var env:=Environment.new()
	env.background_mode=Environment.BG_COLOR;env.background_color=Color("202a34")
	env.tonemap_mode=Environment.TONE_MAPPER_LINEAR;environment.environment=env;add_child(environment)
	env.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR;env.ambient_light_color=Color("d9e4ef");env.ambient_light_energy=.24
	sun.rotation_degrees=Vector3(-38,-35,0);sun.light_energy=1.25;sun.shadow_enabled=true
	sun.directional_shadow_mode=DirectionalLight3D.SHADOW_ORTHOGONAL
	sun.directional_shadow_max_distance=130000;sun.directional_shadow_fade_start=1.0
	sun.directional_shadow_pancake_size=0;sun.shadow_bias=.015;sun.shadow_normal_bias=.6;add_child(sun)
	add_child(camera);camera.current=true;camera.near=1;camera.far=250000;camera.fov=50
	var plane:=PlaneMesh.new();plane.size=Vector2(40000,40000);plane.subdivide_width=511;plane.subdivide_depth=511
	terrain.mesh=plane;terrain.position=Vector3(20000,0,20000);terrain.extra_cull_margin=12000
	var shader:=Shader.new();shader.code=FileAccess.get_file_as_string("res://tile_terrain.gdshader")
	material.shader=shader;terrain.material_override=material;add_child(terrain)
	for role in ["ripples","capillary"]:
		var water_image=load_local_png("res://materials/water/"+role+".png")
		if water_image==null:push_error("Textures eau absentes : lancer prepare_surface_water.py");get_tree().quit(1);return
		water_image.generate_mipmaps();material.set_shader_parameter("water_"+role,ImageTexture.create_from_image(water_image))
	build_ui()
	var chosen=str(catalog.get("defaultTile","mountains--temperate")) if initial_tile.is_empty() else initial_tile
	for index in catalog.tiles.size():
		if catalog.tiles[index].id==chosen:load_tile(index);break
	if current_index<0:push_error("Tuile inconnue : "+chosen);get_tree().quit(1);return
	if test_orbit:toggle_mode()
	update_camera()

func build_ui()->void:
	var layer:=CanvasLayer.new();add_child(layer)
	var panel:=PanelContainer.new();panel.position=Vector2(16,16);layer.add_child(panel)
	var margin:=MarginContainer.new();for side in ["left","right","top","bottom"]:margin.add_theme_constant_override("margin_"+side,12)
	panel.add_child(margin)
	var scroll:=ScrollContainer.new();scroll.custom_minimum_size=Vector2(438,610);scroll.horizontal_scroll_mode=ScrollContainer.SCROLL_MODE_DISABLED;margin.add_child(scroll)
	# The information legend and material controls remain reachable at 800px.
	hud=VBoxContainer.new();hud.size_flags_horizontal=Control.SIZE_EXPAND_FILL;hud.add_theme_constant_override("separation",8);scroll.add_child(hud)
	var title:=Label.new();title.text=TileLocale.text(language,"title");title.add_theme_font_size_override("font_size",20);hud.add_child(title);ui_labels["title"]=title
	var language_selector:=OptionButton.new();hud.add_child(language_selector)
	for entry in [["en","English"],["fr","Français"],["zh","中文"],["es","Español"],["pt","Português"]]:language_selector.add_item(entry[1])
	language_selector.select(TileLocale.LANGS.find(language));language_selector.item_selected.connect(func(index:int):language=TileLocale.LANGS[index];refresh_locale())
	var filters:=HBoxContainer.new();hud.add_child(filters)
	family_filter=OptionButton.new();climate_filter=OptionButton.new();filters.add_child(family_filter);filters.add_child(climate_filter)
	for f in catalog.families:family_filter.add_item(TileLocale.catalogue_label(language,"family",f.id,f.label))
	for c in catalog.climates:climate_filter.add_item(TileLocale.catalogue_label(language,"climate",c.id,c.label))
	family_filter.item_selected.connect(select_filtered);climate_filter.item_selected.connect(select_filtered)
	selector=OptionButton.new();selector.custom_minimum_size.x=410;hud.add_child(selector)
	for t in catalog.tiles:selector.add_item(tile_label(t))
	selector.item_selected.connect(load_tile)
	var buttons:=HBoxContainer.new();hud.add_child(buttons)
	for spec in [["previous",previous_tile],["next",next_tile],["reset",reset_view]]:
		var button:=Button.new();button.text=TileLocale.text(language,spec[0]);button.pressed.connect(spec[1]);buttons.add_child(button);ui_labels[spec[0]]=button
	mode_button=Button.new();mode_button.pressed.connect(toggle_mode);buttons.add_child(mode_button)
	status=Label.new();hud.add_child(status)
	var ground_row:=HBoxContainer.new();hud.add_child(ground_row)
	ground_view_selector=OptionButton.new();ground_row.add_child(ground_view_selector)
	for label in TileLocale.items(language,"views"):ground_view_selector.add_item(label)
	ground_view_selector.item_selected.connect(select_ground_view)
	ground_state_selector=OptionButton.new();ground_row.add_child(ground_state_selector)
	for label in TileLocale.items(language,"states"):ground_state_selector.add_item(label)
	ground_state_selector.tooltip_text=TileLocale.text(language,"state_help")
	ground_state_selector.item_selected.connect(select_ground_state)
	variants_button=Button.new();variants_button.text=TileLocale.text(language,"variants");variants_button.tooltip_text=TileLocale.text(language,"variants_help");variants_button.pressed.connect(randomize_ground_variants);hud.add_child(variants_button)
	ground_status=Label.new();ground_status.custom_minimum_size.x=410;ground_status.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;ground_status.add_theme_font_size_override("font_size",12);hud.add_child(ground_status)
	var info_title:=Label.new();info_title.text=TileLocale.text(language,"information");hud.add_child(info_title);ui_labels["information"]=info_title
	info_selector=OptionButton.new();info_selector.tooltip_text=TileLocale.text(language,"info_help");info_selector.get_popup().max_size.y=560;hud.add_child(info_selector)
	info_selector.item_selected.connect(select_info_layer)
	var opacity_row:=HBoxContainer.new();hud.add_child(opacity_row)
	var opacity_label:=Label.new();opacity_label.text=TileLocale.text(language,"opacity");opacity_row.add_child(opacity_label);ui_labels["opacity"]=opacity_label
	var opacity_slider:=HSlider.new();opacity_slider.min_value=0;opacity_slider.max_value=1;opacity_slider.step=.05;opacity_slider.value=info_opacity;opacity_slider.custom_minimum_size.x=180;opacity_row.add_child(opacity_slider)
	opacity_slider.value_changed.connect(func(value:float):info_opacity=value;material.set_shader_parameter("info_opacity",0.0 if selected_info=="none" else value))
	info_legend=Label.new();info_legend.custom_minimum_size.x=410;info_legend.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;info_legend.add_theme_font_size_override("font_size",12);hud.add_child(info_legend)
	info_palette=GridContainer.new();info_palette.columns=2;info_palette.add_theme_constant_override("h_separation",14);info_palette.add_theme_constant_override("v_separation",3);hud.add_child(info_palette)
	var help:=Label.new();help.text=TileLocale.text(language,"help");help.add_theme_font_size_override("font_size",13);hud.add_child(help);ui_labels["help"]=help
	survey=SurveyOverlay.new();survey.app=self;survey.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT);survey.mouse_filter=Control.MOUSE_FILTER_IGNORE;layer.add_child(survey)
	altitude_label=Label.new();altitude_label.mouse_filter=Control.MOUSE_FILTER_IGNORE
	altitude_label.add_theme_color_override("font_shadow_color",Color.BLACK);altitude_label.add_theme_constant_override("shadow_offset_x",2);altitude_label.add_theme_constant_override("shadow_offset_y",2)
	altitude_label.add_theme_font_size_override("font_size",16);survey.add_child(altitude_label)
	cursor_altitude=Label.new();cursor_altitude.mouse_filter=Control.MOUSE_FILTER_IGNORE;cursor_altitude.add_theme_font_size_override("font_size",15)
	cursor_altitude.add_theme_color_override("font_shadow_color",Color.BLACK);cursor_altitude.add_theme_constant_override("shadow_offset_x",2);cursor_altitude.add_theme_constant_override("shadow_offset_y",2);survey.add_child(cursor_altitude)

func refresh_locale()->void:
	for key in ui_labels:ui_labels[key].text=TileLocale.text(language,key)
	for index in catalog.families.size():family_filter.set_item_text(index,TileLocale.catalogue_label(language,"family",catalog.families[index].id,catalog.families[index].label))
	for index in catalog.climates.size():climate_filter.set_item_text(index,TileLocale.catalogue_label(language,"climate",catalog.climates[index].id,catalog.climates[index].label))
	for index in catalog.tiles.size():selector.set_item_text(index,tile_label(catalog.tiles[index]))
	for index in ground_view_selector.item_count:ground_view_selector.set_item_text(index,TileLocale.items(language,"views")[index])
	for index in ground_state_selector.item_count:ground_state_selector.set_item_text(index,TileLocale.items(language,"states")[index])
	ground_state_selector.tooltip_text=TileLocale.text(language,"state_help")
	variants_button.text=TileLocale.text(language,"variants");variants_button.tooltip_text=TileLocale.text(language,"variants_help")
	info_selector.tooltip_text=TileLocale.text(language,"info_help")
	if info_selector.item_count>0:info_selector.set_item_text(0,TileLocale.text(language,"no_layer"))
	for index in tile_layers.size():
		var layer:Dictionary=tile_layers[index]
		info_selector.set_item_text(index+1,LayerLocale.label(language,str(layer.id),str(layer.label)))
		info_selector.set_item_tooltip(index+1,LayerLocale.legend(language,str(layer.id),str(layer.legend)))
	if info_selector.selected>0:
		var layer:Dictionary=tile_layers[info_selector.selected-1]
		info_legend.text=LayerLocale.legend(language,str(layer.id),str(layer.legend))
		var palette:Array=layer.get("palette",[])
		for index in mini(palette.size(),info_palette.get_child_count()):
			var row=info_palette.get_child(index)
			if row.get_child_count()>1:row.get_child(1).text=LayerLocale.palette(language,str(palette[index].label))
	mode_button.text=TileLocale.text(language,"to3d" if top_view else "totop")
	update_tile_status()
	if surface_meta.is_empty():ground_status.text=TileLocale.text(language,"ground_missing")
	elif ground_view==0:ground_status.text=TileLocale.text(language,"ground_available")
	elif ground_library.error.is_empty():ground_status.text=TileLocale.text(language,"materials_status")%[ground_library.assets.size(),ground_library.palette_seed]+TileLocale.text(language,"mineral_before" if ground_view==3 else "surface_description")
	if survey!=null:survey.queue_redraw()

func tile_label(tile:Dictionary)->String:
	var family_name="";var climate_name=""
	for family in catalog.families:
		if family.id==tile.family:family_name=TileLocale.catalogue_label(language,"family",family.id,family.label);break
	for climate in catalog.climates:
		if climate.id==tile.climate:climate_name=TileLocale.catalogue_label(language,"climate",climate.id,climate.label);break
	return family_name+" · "+climate_name if not family_name.is_empty() and not climate_name.is_empty() else str(tile.label)

func update_tile_status()->void:
	if current_meta.is_empty() or current_index<0:return
	var meta=current_meta;var hydro:Dictionary=meta.get("hydrology",{})
	status.text=TileLocale.text(language,"status")%[current_index+1,meta.min,meta.max,meta.seed,meta.temperature,meta.precipitation,float(meta.get("neural",{}).get("decoderNativeCell",40000.0/meta.n)),int(meta.n)]
	if not hydro.is_empty():status.text+=TileLocale.text(language,"water")%[hydro.rivers,hydro.riverKm,hydro.lakes]

func load_local_png(path:String)->Image:
	# Diagnostic data are external files, deliberately excluded from asset import.
	var image:=Image.new()
	if image.load_png_from_buffer(FileAccess.get_file_as_bytes(path))!=OK:return null
	return image

func load_tile(index:int)->void:
	if index<0 or index>=catalog.tiles.size():return
	var entry:Dictionary=catalog.tiles[index];var path=catalog_dir.path_join(entry.file)
	var meta=JSON.parse_string(FileAccess.get_file_as_string(path))
	if not meta is Dictionary:push_error("Descripteur absent : "+path);return
	current_meta=meta
	var dir=path.get_base_dir();var raw=FileAccess.get_file_as_bytes(dir.path_join(meta.height))
	if raw.size()!=int(meta.n)*int(meta.n)*4:push_error("Heightfield incomplet : "+path);return
	material.set_shader_parameter("original_height_map",ImageTexture.create_from_image(Image.create_from_data(int(meta.n),int(meta.n),false,Image.FORMAT_RF,raw)))
	# Keep the raw decoder source on disk; standing lakes use their hydraulic level.
	var hydro:Dictionary=meta.get("hydrology",{})
	if hydro.has("surface"):
		raw=FileAccess.get_file_as_bytes(dir.path_join(hydro.surface))
		if raw.size()!=int(meta.n)*int(meta.n)*4:push_error("Surface hydraulique incomplète : "+path);return
	var map_image=load_local_png(dir.path_join(meta.map))
	if map_image==null or map_image.is_empty():push_error("Carte absente : "+path);return
	map_image.generate_mipmaps()
	height_image=Image.create_from_data(int(meta.n),int(meta.n),false,Image.FORMAT_RF,raw)
	if mesh_cells!=int(meta.n):
		mesh_cells=int(meta.n);terrain.mesh.subdivide_width=mesh_cells-1;terrain.mesh.subdivide_depth=mesh_cells-1
	vertex_height_cache.clear();terrain_max_height=maxf(0,float(meta.max))+meso.MAX_HEIGHT+.25;survey_tile=-1
	terrain.custom_aabb=AABB(Vector3(-20000,0,-20000),Vector3(40000,terrain_max_height,40000));terrain.extra_cull_margin=.25
	material.set_shader_parameter("height_map",ImageTexture.create_from_image(height_image))
	material.set_shader_parameter("map_image",ImageTexture.create_from_image(map_image))
	material.set_shader_parameter("height_n",float(meta.n))
	current_index=index;selector.select(index)
	for j in catalog.families.size():
		if catalog.families[j].id==entry.family:family_filter.select(j)
	for j in catalog.climates.size():
		if catalog.climates[j].id==entry.climate:climate_filter.select(j)
	update_tile_status()
	tile_layers=hydro.get("layers",[]).duplicate();tile_layers.append_array(meta.get("ground",{}).get("layers",[]));tile_dir=dir
	original_cover_meta={}
	if FileAccess.file_exists(dir.path_join("original-cover.json")):
		original_cover_meta=JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("original-cover.json")))
	surface_meta=meta.get("groundSurface",{});tile_layers.append_array(surface_meta.get("layers",[]))
	load_detail_context(tile_dir)
	info_selector.clear();info_selector.add_item(TileLocale.text(language,"no_layer"))
	var selected=0
	for j in tile_layers.size():
		info_selector.add_item(LayerLocale.label(language,str(tile_layers[j].id),str(tile_layers[j].label)))
		info_selector.set_item_tooltip(j+1,LayerLocale.legend(language,str(tile_layers[j].id),str(tile_layers[j].legend)))
		if tile_layers[j].id==selected_info:selected=j+1
	select_info_layer(selected)
	update_ground_surface()
	update_camera()
	print(JSON.stringify({"event":"tile-loaded","id":entry.id,"widthM":40000,"n":meta.n,"heightSha256":meta.heightSha256}))

func select_ground_view(index:int)->void:
	ground_view=index;ground_view_selector.select(index);update_ground_surface()

func select_ground_state(index:int)->void:
	ground_state=index;ground_state_selector.select(index);update_ground_surface()

func localized_ground_error(message:String)->String:
	if message=="Bibliothèque PBR absente : lancer prepare_ground_textures.py":return TileLocale.text(language,"pbr_library_missing")
	if message=="Création des tableaux de textures impossible":return TileLocale.text(language,"pbr_arrays_failed")
	for item in [["Texture PBR absente : ","pbr_texture_missing"],["Aucun candidat préparé : ","pbr_candidate_missing"]]:
		if message.begins_with(item[0]):return TileLocale.text(language,item[1])+message.substr(item[0].length())
	return message

func update_ground_surface()->void:
	survey_tile=-1
	material.set_shader_parameter("ground_view",0)
	ground_state_selector.disabled=surface_meta.is_empty()
	variants_button.disabled=surface_meta.is_empty()
	if surface_meta.is_empty():ground_status.text=TileLocale.text(language,"ground_missing");return
	if ground_view==0:
		update_camera();ground_status.text=TileLocale.text(language,"ground_available");return
	if not ground_library.initialize(material):ground_status.text=localized_ground_error(ground_library.error);return
	ground_library.resolve(str(current_meta.seed),material)
	if not ground_library.error.is_empty():ground_status.text=localized_ground_error(ground_library.error);return
	var state_key=ground_states[ground_state] if ground_state<3 else "mean"
	var state:Dictionary=surface_meta.states[state_key]
	ground_ids_image=load_local_png(tile_dir.path_join(state.indices))
	ground_weights_image=load_local_png(tile_dir.path_join(state.weights))
	ground_ids_extra_image=load_local_png(tile_dir.path_join(state.indicesExtra))
	ground_weights_extra_image=load_local_png(tile_dir.path_join(state.weightsExtra))
	cover_ids_image=load_local_png(tile_dir.path_join(state.coverIndices));cover_weights_image=load_local_png(tile_dir.path_join(state.coverWeights))
	if ground_ids_image==null or ground_weights_image==null:ground_status.text=TileLocale.text(language,"ground_classification_missing")+state_key;return
	material.set_shader_parameter("ground_indices",ImageTexture.create_from_image(ground_ids_image))
	material.set_shader_parameter("ground_weights",ImageTexture.create_from_image(ground_weights_image))
	material.set_shader_parameter("ground_indices_extra",ImageTexture.create_from_image(ground_ids_extra_image))
	material.set_shader_parameter("ground_weights_extra",ImageTexture.create_from_image(ground_weights_extra_image))
	material.set_shader_parameter("cover_indices",ImageTexture.create_from_image(cover_ids_image))
	material.set_shader_parameter("cover_weights",ImageTexture.create_from_image(cover_weights_image))
	for pair in [["ground_attributes",surface_meta.attributes],["ground_water",surface_meta.water],["river_footprint",surface_meta.riverFootprint],["ground_structure",surface_meta.get("structure","surface-structure.png")],["render_snow",surface_meta.renderSnow]]:
		var image=load_local_png(tile_dir.path_join(pair[1]))
		if image==null:ground_status.text=TileLocale.text(language,"ground_data_missing")+str(pair[1]);return
		if pair[0]=="ground_water":ground_water_image=image
		if pair[0]=="river_footprint":ground_river_image=image
		if pair[0]=="ground_attributes":ground_attributes_image=image
		if pair[0]=="render_snow":ground_snow_image=image
		if pair[0] in ["river_footprint","render_snow"]:image.generate_mipmaps()
		material.set_shader_parameter(pair[0],ImageTexture.create_from_image(image))
	material.set_shader_parameter("ground_state",ground_state)
	material.set_shader_parameter("ground_view",ground_view)
	load_original_cover()
	update_camera()
	ground_status.text=TileLocale.text(language,"materials_status")%[ground_library.assets.size(),ground_library.palette_seed]+TileLocale.text(language,"mineral_before" if ground_view==3 else "surface_description")
	print(JSON.stringify({"event":"ground-view","view":ground_view,"state":ground_states[ground_state],"seed":ground_library.palette_seed,"types":ground_library.selected.size()}))

func load_detail_context(directory:String,report_error:bool=true)->bool:
	detail_context_ready=meso.load_context(directory,int(current_meta.n),{"height":current_meta.heightSha256,"surface":surface_meta.get("grids",{}).get("sha256",""),"ground":current_meta.ground.grids.sha256})
	material.set_shader_parameter("meso_context",meso.texture);material.set_shader_parameter("meso_ready",detail_context_ready)
	material.set_shader_parameter("meso_profiles",meso.profile_texture);material.set_shader_parameter("meso_structure",meso.structure_texture)
	if detail_context_ready:meso.seed=int(str(current_meta.seed).sha256_buffer().decode_u32(0))&0x7fffffff
	elif report_error:push_error("Contexte méso absent ou périmé : lancer prepare_mesoscale.py")
	material.set_shader_parameter("terrain_detail_seed",meso.seed)
	vertex_height_cache.clear();update_camera();return detail_context_ready

func load_original_cover()->void:
	material.set_shader_parameter("original_cover_enabled",not original_cover_meta.is_empty())
	if original_cover_meta.is_empty():return
	if original_cover_loaded_dir==tile_dir:return
	forest_placement_image=load_local_png(tile_dir.path_join("forest-placement.png"))
	if forest_placement_image==null:push_error("Placement forestier absent : lancer forest_placement.py");return
	forest_placement_image.generate_mipmaps()
	material.set_shader_parameter("forest_placement",ImageTexture.create_from_image(forest_placement_image))
	for role in ["cover","color","open","closed"]:
		var image=load_local_png(tile_dir.path_join("original-"+role+".png"));image.generate_mipmaps()
		if role=="cover":original_cover_image=image
		material.set_shader_parameter("original_"+role,ImageTexture.create_from_image(image))
	var forest:Dictionary=JSON.parse_string(FileAccess.get_file_as_string(tile_dir.path_join("original-forest.json")))
	var image=load_local_png(tile_dir.path_join("forest-placed-field.png"));image.generate_mipmaps()
	material.set_shader_parameter("uForestField",ImageTexture.create_from_image(image))
	var montane_image=load_local_png(tile_dir.path_join("montane-forest.png"));montane_image.generate_mipmaps()
	material.set_shader_parameter("montane_forest",ImageTexture.create_from_image(montane_image))
	material.set_shader_parameter("uMaterialClimate",Vector2(current_meta.temperature,current_meta.precipitation))
	material.set_shader_parameter("uMaterialSeed",int(forest.seed))
	# Isolated gallery/shrub candidates must not bypass the forest biome gate.
	material.set_shader_parameter("uHasForestBank",0)
	material.set_shader_parameter("uForestBankDensity",float(forest.bankDensity))
	material.set_shader_parameter("original_light",sun.global_basis.z.normalized())
	var water_image=load_local_png(tile_dir.path_join("surface-water-detail.png"))
	if water_image!=null:material.set_shader_parameter("water_detail",ImageTexture.create_from_image(water_image))
	var shore_image=load_local_png(tile_dir.path_join("surface-shoreline.png"))
	material.set_shader_parameter("water_shoreline",ImageTexture.create_from_image(shore_image) if shore_image!=null else null)
	var shore_ready=shore_image!=null
	for role in ["dry","wet"]:
		var reference=load_local_png(tile_dir.path_join("surface-shore-"+role+".png"))
		if reference!=null:reference.generate_mipmaps()
		else:shore_ready=false
		material.set_shader_parameter("water_reference_"+role,ImageTexture.create_from_image(reference) if reference!=null else null)
	material.set_shader_parameter("water_shore_ready",shore_ready)
	original_cover_loaded_dir=tile_dir

func randomize_ground_variants()->void:
	if surface_meta.is_empty():return
	if not ground_library.initialize(material):ground_status.text=ground_library.error;return
	ground_library.resolve(str(current_meta.seed),material,true)
	if ground_view==0:ground_view=1;ground_view_selector.select(1)
	# Reuse classifications and physical fields: this button only changes palette.
	update_ground_surface()

func material_label(index:int)->String:
	if index<0 or index>=ground_library.selected.size():return ""
	var type:Dictionary=ground_library.types[index];var choice:Dictionary=ground_library.selected[index]
	return MaterialLocale.label(language,str(type.id),str(type.label))+" · "+str(choice.asset)

func ground_at(x:float,z:float)->String:
	if ground_view==0 or ground_ids_image==null:return ""
	var p=Vector2i(clampi(int(x/40000.0*ground_ids_image.get_width()),0,ground_ids_image.get_width()-1),clampi(int(z/40000.0*ground_ids_image.get_height()),0,ground_ids_image.get_height()-1))
	var ids=ground_ids_image.get_pixelv(p);var shares=ground_weights_image.get_pixelv(p)
	var extra_ids=ground_ids_extra_image.get_pixelv(p);var extra_shares=ground_weights_extra_image.get_pixelv(p)
	var water=ground_water_image.get_pixelv(p)
	var rp=Vector2i(clampi(int(x/40000.0*ground_river_image.get_width()),0,ground_river_image.get_width()-1),clampi(int(z/40000.0*ground_river_image.get_height()),0,ground_river_image.get_height()-1))
	var river=ground_river_image.get_pixelv(rp).a
	var water_mask=maxf(maxf(water.g,water.b),river)
	var domain=locale_text("sea" if water.b>.5 else ("lake" if water.g>.5 else "river"))
	if water_mask>.5:
		if ground_view!=3 and ground_state>=10 and ground_attributes_image.get_pixelv(p).g*70.0-48.0<3.0:return domain+" · "+material_label(88 if ground_state==10 else 89)
		return domain+" · "+locale_text("water_surface")
	var best_weight=shares[0];var best_id=roundi(ids[0]*255)
	for j in range(1,6):
		var share=shares[j] if j<4 else extra_shares[j-4]
		if share>best_weight:best_weight=share;best_id=roundi((ids[j] if j<4 else extra_ids[j-4])*255)
	var support=material_label(best_id)
	if ground_view==3:return locale_text("mineral")+" · "+support
	var cover_shares=cover_weights_image.get_pixelv(p)
	if forest_placement_image!=null:
		var policy=sample_map(forest_placement_image,x,z)
		var matrix=shares.a+extra_shares.r+extra_shares.g
		var amount=cover_shares.a*policy.g*matrix
		if amount>.05:
			var cover_ids=cover_ids_image.get_pixelv(p);var context=Vector3(cover_shares.r*policy.r,cover_shares.g,cover_shares.b);var best=0
			for j in range(1,3):
				if context[j]>context[best]:best=j
			support=locale_text("forest" if policy.r>.5 else "low_cover")+" · "+material_label(roundi(cover_ids[best]*255))+" · %d %%\n"%roundi(amount*100)+locale_text("support")+" : "+support
		elif policy.b>.3:support=locale_text("bare")+" · "+support
	elif cover_shares.a>.05:
		var cover_ids=cover_ids_image.get_pixelv(p);var cover_best=0
		for j in range(1,3):
			if cover_shares[j]>cover_shares[cover_best]:cover_best=j
		support=locale_text("surface")+" %d %% · "%roundi(cover_shares.a*100)+material_label(roundi(cover_ids[cover_best]*255))+"\n"+locale_text("support")+" : "+support
	if ground_state<3:
		var snow_p=Vector2i(clampi(int(x/40000.0*ground_snow_image.get_width()),0,ground_snow_image.get_width()-1),clampi(int(z/40000.0*ground_snow_image.get_height()),0,ground_snow_image.get_height()-1))
		if ground_snow_image.get_pixelv(snow_p).r>.05:return locale_text("render_snow")+" · "+material_label(80)+"\n"+locale_text("support")+" : "+support
	if ground_state>=3 and ground_state<=9:
		var attrs=ground_attributes_image.get_pixelv(p)
		var temperature=attrs.g*70.0-30.0-18.0
		var t=clampf((temperature+4.0)/8.0,0,1)
		var snow=attrs.b*(1-t*t*(3-2*t))*(1-water_mask)
		if ground_state==8 or ground_state==9:snow*=.55
		if snow>.05:
			var on_grass=cover_shares.a>.25 and cover_shares.g>cover_shares.r and cover_shares.g>cover_shares.b
			var snow_type=[80,81,82,83,84,86 if on_grass else 87,85][ground_state-3]
			return material_label(snow_type)+"\n"+locale_text("support")+" : "+support
	return support

func select_info_layer(index:int)->void:
	if index<0 or index>tile_layers.size():return
	info_selector.select(index)
	for child in info_palette.get_children():info_palette.remove_child(child);child.queue_free()
	if index==0:
		selected_info="none";info_legend.text="";material.set_shader_parameter("info_opacity",0.0);return
	var layer:Dictionary=tile_layers[index-1]
	var image=load_local_png(tile_dir.path_join(layer.file))
	if image==null or image.is_empty():push_error("Calque absent : "+str(layer.file));return
	var smooth_layer:bool=layer.get("filter","")=="linear"
	if smooth_layer:image.generate_mipmaps()
	selected_info=layer.id;info_legend.text=LayerLocale.legend(language,str(layer.id),str(layer.legend))
	for entry in layer.get("palette",[]):
		var row:=HBoxContainer.new();info_palette.add_child(row)
		var swatch:=ColorRect.new();swatch.color=Color(entry.color);swatch.custom_minimum_size=Vector2(14,14);row.add_child(swatch)
		var label:=Label.new();label.text=LayerLocale.palette(language,str(entry.label));label.add_theme_font_size_override("font_size",12);row.add_child(label)
	var texture:=ImageTexture.create_from_image(image)
	material.set_shader_parameter("info_image",texture)
	material.set_shader_parameter("info_image_linear",texture)
	material.set_shader_parameter("info_smooth",smooth_layer)
	material.set_shader_parameter("info_opacity",info_opacity)

func select_filtered(_index:int)->void:
	var f=catalog.families[family_filter.selected].id;var c=catalog.climates[climate_filter.selected].id
	for index in catalog.tiles.size():
		if catalog.tiles[index].family==f and catalog.tiles[index].climate==c:load_tile(index);return

func previous_tile()->void:load_tile(posmod(current_index-1,42))
func next_tile()->void:load_tile(posmod(current_index+1,42))
func reset_view()->void:
	focus=Vector3(20000,0,20000);view_width=65000;yaw=0;update_camera()
func toggle_mode()->void:
	if top_view:
		top_view=false;yaw=orbit_yaw;elevation=orbit_elevation
	else:
		orbit_yaw=yaw;orbit_elevation=elevation;top_view=true;yaw=0;elevation=PI/2.0
	update_camera()
func update_camera()->void:
	var next_warp=clampf(log(240000.0/maxf(view_width,1)),0,6.5)
	var next_focus=Vector2(clampf(focus.x,1,39999),clampf(focus.z,1,39999))
	var next_detail=1.0 if ground_view>0 and detail_enabled and detail_context_ready else 0.0
	if next_warp!=grid_warp or next_focus!=grid_focus or next_detail!=detail_amount:vertex_height_cache.clear()
	grid_warp=next_warp;grid_focus=next_focus;detail_amount=next_detail
	grid_scale=PackedFloat32Array([20000.0/sinh(maxf(grid_warp,.001))])[0]
	grid_domain=Vector4(inverse_sinh(-grid_focus.x/grid_scale),inverse_sinh((40000-grid_focus.x)/grid_scale),inverse_sinh(-grid_focus.y/grid_scale),inverse_sinh((40000-grid_focus.y)/grid_scale))
	material.set_shader_parameter("terrain_grid_warp",grid_warp)
	material.set_shader_parameter("terrain_grid_focus",grid_focus)
	material.set_shader_parameter("terrain_grid_scale",grid_scale)
	material.set_shader_parameter("terrain_grid_domain",grid_domain)
	material.set_shader_parameter("terrain_detail_amount",detail_amount)
	if height_image!=null:focus.y=surface_height(focus.x,focus.z)
	var viewport=get_viewport().get_visible_rect().size
	var aspect=viewport.x/maxf(1,viewport.y)
	var distance=view_width/aspect/(2*tan(deg_to_rad(camera.fov)*.5))
	sun.directional_shadow_max_distance=clampf(distance+view_width*1.8+terrain_max_height*2,1500,130000)
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL if top_view else Camera3D.PROJECTION_PERSPECTIVE
	camera.size=view_width/aspect
	camera.position=focus+Vector3(sin(yaw)*cos(elevation),sin(elevation),cos(yaw)*cos(elevation))*distance
	camera.look_at(focus,Vector3.FORWARD if top_view else Vector3.UP)
	mode_button.text=TileLocale.text(language,"to3d" if top_view else "totop")

func surface_height(x:float,z:float)->float:
	var n=height_image.get_width();var p=Vector2(x,z)/40000.0*n-Vector2(.5,.5)
	var base=p.floor();var t=p-base
	var wx=spline_weights(t.x);var wy=spline_weights(t.y);var h=0.0
	for j in 4:
		for i in 4:h+=height_image.get_pixel(clampi(int(base.x)+i-1,0,n-1),clampi(int(base.y)+j-1,0,n-1)).r*wx[i]*wy[j]
	return maxf(0,h+terrain_detail_height(x,z))

func sample_map(image:Image,x:float,z:float)->Color:
	var p=Vector2(x,z)/40000.0*Vector2(image.get_width(),image.get_height())-Vector2(.5,.5)
	var b=p.floor();var t=p-b;var n=image.get_size()-Vector2i.ONE
	var a=image.get_pixelv(Vector2i(b).clamp(Vector2i.ZERO,n)).lerp(image.get_pixelv((Vector2i(b)+Vector2i(1,0)).clamp(Vector2i.ZERO,n)),t.x)
	var c=image.get_pixelv((Vector2i(b)+Vector2i(0,1)).clamp(Vector2i.ZERO,n)).lerp(image.get_pixelv((Vector2i(b)+Vector2i.ONE).clamp(Vector2i.ZERO,n)),t.x)
	return a.lerp(c,t.y)

func terrain_detail_height(x:float,z:float)->float:
	if detail_amount<=0 or not detail_enabled:return 0.0
	return meso.sample_field(Vector2(x,z),grid_density(Vector2(x,z))).x*detail_amount

func set_detail_enabled(enabled:bool)->void:
	detail_enabled=enabled;material.set_shader_parameter("terrain_detail_enabled",enabled)
	vertex_height_cache.clear();survey_tile=-1;update_camera()

func inverse_sinh(x:float)->float:return log(x+sqrt(x*x+1))
func grid_density(world:Vector2)->Vector4:
	if grid_warp<.001:return Vector4(40000.0/mesh_cells,40000.0/mesh_cells,0,0)
	var delta=world-grid_focus;var root=Vector2(sqrt(grid_scale*grid_scale+delta.x*delta.x),sqrt(grid_scale*grid_scale+delta.y*delta.y))
	var factor=Vector2(grid_domain.y-grid_domain.x,grid_domain.w-grid_domain.z)/mesh_cells
	return Vector4(root.x*factor.x,root.y*factor.y,delta.x/root.x*factor.x,delta.y/root.y*factor.y)

func grid_spacing(world:float,axis:int)->float:
	if grid_warp<.001:return 40000.0/mesh_cells
	return sqrt(grid_scale*grid_scale+pow(world-grid_focus[axis],2))*(grid_domain[axis*2+1]-grid_domain[axis*2])/mesh_cells

func grid_coordinate(t:float,axis:int)->float:
	if t<=0:return 0.0
	if t>=1:return 40000.0
	if grid_warp<.001:return t*40000.0
	return grid_focus[axis]+grid_scale*sinh(lerpf(grid_domain[axis*2],grid_domain[axis*2+1],t))
func grid_index(world:float,axis:int)->int:
	var index:int
	if grid_warp<.001:index=clampi(int(floor(world/40000.0*mesh_cells)),0,mesh_cells-1)
	else:
		var q=inverse_sinh((world-grid_focus[axis])/grid_scale)
		index=clampi(int(floor((q-grid_domain[axis*2])/(grid_domain[axis*2+1]-grid_domain[axis*2])*mesh_cells)),0,mesh_cells-1)
	# Triangle coordinates are float32. An exact ray on a rounded grid edge
	# must select its actual cell, rather than the float64 inverse's neighbour.
	while index<mesh_cells-1 and world>=grid_node(index+1,axis):index+=1
	while index>0 and world<grid_node(index,axis):index-=1
	return index
func grid_node(index:int,axis:int)->float:
	return PackedFloat32Array([grid_coordinate(float(index)/mesh_cells,axis)])[0]
func spline_weights(t:float)->Vector4:
	var u=1-t
	return Vector4(u*u*u,3*t*t*t-6*t*t+4,-3*t*t*t+3*t*t+3*t+1,t*t*t)/6.0

func mesh_vertex(x:int,z:int)->Vector3:
	var key=z*(mesh_cells+1)+x
	var px=grid_node(x,0);var pz=grid_node(z,1)
	if not vertex_height_cache.has(key):vertex_height_cache[key]=surface_height(px,pz)
	return Vector3(px,vertex_height_cache[key],pz)

func pick_terrain(screen:Vector2,accelerated:bool=true)->Variant:
	# Traverse rendered grid cells and intersect their actual displaced triangles.
	# A flat collision plane would report the wrong point in perspective.
	var origin=camera.project_ray_origin(screen);var direction=camera.project_ray_normal(screen)
	var start=0.0;var stop=250000.0
	for axis in 3:
		var lo=0.0;var hi=terrain_max_height if axis==1 else 40000.0
		if absf(direction[axis])<1e-10:
			if origin[axis]<lo or origin[axis]>hi:return null
		else:
			var a=(lo-origin[axis])/direction[axis];var b=(hi-origin[axis])/direction[axis]
			start=maxf(start,minf(a,b));stop=minf(stop,maxf(a,b))
	if stop<start:return null
	if accelerated and not top_view and ground_view>0 and view_width<8000:
		return pick_blocks(origin,direction,start,stop)
	return pick_grid_interval(origin,direction,start,stop)

func pick_block_bounds(bx:int,bz:int)->Vector2:
	var n=height_image.get_width();var identity=height_image.get_instance_id()
	if pick_bounds_image!=identity:pick_bounds_image=identity;pick_bounds_cache.clear()
	var x0=clampi(int(floor(grid_node(bx*8,0)/40000.0*n-.5))-2,0,n-1)
	var z0=clampi(int(floor(grid_node(bz*8,1)/40000.0*n-.5))-2,0,n-1)
	var x1=clampi(int(floor(grid_node(mini((bx+1)*8,mesh_cells),0)/40000.0*n-.5))+3,0,n-1)
	var z1=clampi(int(floor(grid_node(mini((bz+1)*8,mesh_cells),1)/40000.0*n-.5))+3,0,n-1)
	# Bound every rendered vertex in this block from the positive B-spline
	# source support, plus the entire residual envelope; triangles are convex.
	if (x1-x0+1)*(z1-z0+1)>256:return Vector2(0,terrain_max_height)
	var key=x0|(z0<<14)|(x1<<28)|(z1<<42)
	if pick_bounds_cache.has(key):return pick_bounds_cache[key]
	var lo=INF;var hi=-INF
	for z in range(z0,z1+1):
		for x in range(x0,x1+1):
			var h=height_image.get_pixel(x,z).r;lo=minf(lo,h);hi=maxf(hi,h)
	var bounds=Vector2(maxf(0,lo-meso.MAX_HEIGHT-.25),maxf(0,hi+meso.MAX_HEIGHT+.25))
	if pick_bounds_cache.size()>=8192:pick_bounds_cache.clear()
	pick_bounds_cache[key]=bounds;return bounds

func pick_blocks(origin:Vector3,direction:Vector3,start:float,stop:float)->Variant:
	var p=origin+direction*(start+.001);var x=int(grid_index(p.x,0)/8);var z=int(grid_index(p.z,1)/8)
	var count=int(ceil(mesh_cells/8.0));var step_x=1 if direction.x>=0 else -1;var step_z=1 if direction.z>=0 else -1
	var entry=start
	for iteration in count*2+2:
		var tx=(grid_node(mini((x+1)*8,mesh_cells) if step_x>0 else x*8,0)-origin.x)/direction.x if absf(direction.x)>1e-10 else INF
		var tz=(grid_node(mini((z+1)*8,mesh_cells) if step_z>0 else z*8,1)-origin.z)/direction.z if absf(direction.z)>1e-10 else INF
		var finish=minf(stop,minf(tx,tz));var bounds=pick_block_bounds(x,z);var a=entry;var b=finish
		if absf(direction.y)>1e-10:
			var lower=(bounds.x-origin.y)/direction.y;var upper=(bounds.y-origin.y)/direction.y
			a=maxf(a,minf(lower,upper));b=minf(b,maxf(lower,upper))
		elif origin.y<bounds.x or origin.y>bounds.y:a=INF
		if a<=b:
			var hit=pick_grid_interval(origin,direction,a,b)
			if hit!=null:return hit
		if finish>=stop:return null
		entry=minf(tx,tz)
		if tx<tz:x+=step_x
		else:z+=step_z
		if x<0 or z<0 or x>=count or z>=count:return null
	return null

func pick_grid_interval(origin:Vector3,direction:Vector3,start:float,stop:float)->Variant:
	var p=origin+direction*(start+.001)
	var x=grid_index(p.x,0);var z=grid_index(p.z,1)
	var step_x=1 if direction.x>=0 else -1;var step_z=1 if direction.z>=0 else -1
	for _iteration in mesh_cells*2+2:
		var tx=(grid_node(x+1 if step_x>0 else x,0)-origin.x)/direction.x if absf(direction.x)>1e-10 else INF
		var tz=(grid_node(z+1 if step_z>0 else z,1)-origin.z)/direction.z if absf(direction.z)>1e-10 else INF
		var a=mesh_vertex(x,z);var b=mesh_vertex(x+1,z);var c=mesh_vertex(x,z+1);var d=mesh_vertex(x+1,z+1)
		var first=Geometry3D.ray_intersects_triangle(origin,direction,a,b,c)
		var second=Geometry3D.ray_intersects_triangle(origin,direction,b,d,c)
		if first!=null:
			var t=(first-origin).dot(direction)
			if t<start-.02 or t>stop+.02:first=null
		if second!=null:
			var t=(second-origin).dot(direction)
			if t<start-.02 or t>stop+.02:second=null
		if first!=null and second!=null:return first if origin.distance_squared_to(first)<origin.distance_squared_to(second) else second
		if first!=null:return first
		if second!=null:return second
		if minf(tx,tz)>stop:return null
		if tx<tz:x+=step_x
		else:z+=step_z
		if x<0 or z<0 or x>=mesh_cells or z>=mesh_cells:return null
	return null

func ruler_metres_per_pixel()->float:
	var centre=get_viewport().get_visible_rect().size*.5
	var plane=Plane(Vector3.UP,focus.y)
	var left=plane.intersects_ray(camera.project_ray_origin(centre-Vector2(50,0)),camera.project_ray_normal(centre-Vector2(50,0)))
	var right=plane.intersects_ray(camera.project_ray_origin(centre+Vector2(50,0)),camera.project_ray_normal(centre+Vector2(50,0)))
	return left.distance_to(right)/100.0 if left!=null and right!=null else 0.0

func update_survey(mouse_override:Variant=null)->void:
	var mouse:Vector2=get_viewport().get_mouse_position() if mouse_override==null else mouse_override
	var viewport_size=get_viewport().get_visible_rect().size
	if mouse==survey_mouse and camera.global_transform==survey_transform and viewport_size==survey_size and current_index==survey_tile:return
	survey_mouse=mouse;survey_transform=camera.global_transform;survey_size=viewport_size;survey_tile=current_index
	cursor_hit=pick_terrain(mouse)
	altitude_label.text="Altitude sous le curseur : —" if cursor_hit==null else "Altitude : %.1f m  ·  X %.0f m / Y %.0f m"%[cursor_hit.y,cursor_hit.x,cursor_hit.z]
	altitude_label.position=Vector2(maxf(260,viewport_size.x-altitude_label.get_minimum_size().x-24),viewport_size.y-38)
	cursor_altitude.visible=cursor_hit!=null
	if cursor_hit!=null:
		cursor_altitude.text="%.1f m"%cursor_hit.y
		var ground_label=ground_at(cursor_hit.x,cursor_hit.z)
		if not ground_label.is_empty():cursor_altitude.text+="\n"+ground_label
		cursor_altitude.position=Vector2(clampf(mouse.x+16,0,viewport_size.x-cursor_altitude.get_minimum_size().x-8),clampf(mouse.y+20,0,viewport_size.y-60))
	survey.queue_redraw()

func pan(delta:Vector2)->void:
	var right=camera.global_basis.x;right.y=0;right=right.normalized()
	var up=Vector3(sin(yaw),0,cos(yaw))*-1
	focus+=(-right*delta.x+up*delta.y)*(view_width/get_viewport().get_visible_rect().size.x)
	focus.x=clampf(focus.x,-20000,60000);focus.z=clampf(focus.z,-20000,60000);update_camera()

func _input(event:InputEvent)->void:
	if capture_frames>0:return
	# Release even over the UI so a drag cannot remain stuck after crossing it.
	if event is InputEventMouseButton and not event.pressed:
		drag_pan=false;drag_orbit=false
	if event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_ESCAPE:get_tree().quit()
			KEY_TAB:toggle_mode();get_viewport().set_input_as_handled()
			KEY_R:reset_view()
			KEY_H:hud.get_parent().get_parent().visible=not hud.get_parent().get_parent().visible
			KEY_BRACKETLEFT:previous_tile()
			KEY_BRACKETRIGHT:next_tile()

func _unhandled_input(event:InputEvent)->void:
	if capture_frames>0:return
	if event is InputEventMouseButton:
		if event.button_index==MOUSE_BUTTON_RIGHT or (event.button_index==MOUSE_BUTTON_LEFT and event.alt_pressed):drag_orbit=event.pressed
		elif event.button_index in [MOUSE_BUTTON_LEFT,MOUSE_BUTTON_MIDDLE]:drag_pan=event.pressed
		if not event.pressed:drag_pan=false;drag_orbit=false
		if event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP,MOUSE_BUTTON_WHEEL_DOWN]:
			view_width=clampf(view_width*(.85 if event.button_index==MOUSE_BUTTON_WHEEL_UP else 1/.85),12,140000);update_camera()
	if event is InputEventMouseMotion:
		if drag_orbit:
			if top_view:top_view=false;elevation=deg_to_rad(89)
			yaw-=event.relative.x*.006;elevation=clampf(elevation+event.relative.y*.006,deg_to_rad(8),deg_to_rad(89));update_camera()
		elif drag_pan:pan(event.relative)

func _process(delta:float)->void:
	if current_index<0:return
	var direction=Vector2(float(Input.is_physical_key_pressed(KEY_D) or Input.is_key_pressed(KEY_RIGHT))-float(Input.is_physical_key_pressed(KEY_A) or Input.is_key_pressed(KEY_LEFT)),float(Input.is_physical_key_pressed(KEY_S) or Input.is_key_pressed(KEY_DOWN))-float(Input.is_physical_key_pressed(KEY_W) or Input.is_key_pressed(KEY_UP)))
	if direction.length_squared()>0:pan(-direction.normalized()*delta*get_viewport().get_visible_rect().size.x*(.8 if Input.is_key_pressed(KEY_SHIFT) else .2))
	if get_viewport().get_visible_rect().size!=Vector2.ZERO:update_camera()
	update_survey()
	if capture_frames>0:
		startup_frames+=1
		if startup_frames==capture_frames:save_capture.call_deferred()

func save_capture()->void:
	await RenderingServer.frame_post_draw
	DirAccess.make_dir_recursive_absolute(capture_path.get_base_dir())
	var result=get_viewport().get_texture().get_image().save_png(capture_path)
	print(JSON.stringify({"event":"tile-capture","tile":catalog.tiles[current_index].id,"top":top_view,"path":capture_path,"error":result}))
	get_tree().quit(0 if result==OK else 1)
