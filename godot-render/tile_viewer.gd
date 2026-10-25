extends Node3D
## One terrain mesh, one material, two camera projections. All distances are metres.
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
		draw_string(font,origin+Vector2(0,23),"Échelle au centre" if not app.top_view else "Échelle",HORIZONTAL_ALIGNMENT_LEFT,-1,12,Color("c6cfd8"))

func _ready()->void:
	var catalog_path="res://tiles/catalog.json"
	var args=OS.get_cmdline_user_args();var i=0
	while i<args.size():
		match args[i]:
			"--catalog":i+=1;catalog_path=args[i]
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
	var title:=Label.new();title.text="TUILES · 40 × 40 km";title.add_theme_font_size_override("font_size",20);hud.add_child(title)
	var filters:=HBoxContainer.new();hud.add_child(filters)
	family_filter=OptionButton.new();climate_filter=OptionButton.new();filters.add_child(family_filter);filters.add_child(climate_filter)
	for f in catalog.families:family_filter.add_item(f.label)
	for c in catalog.climates:climate_filter.add_item(c.label)
	family_filter.item_selected.connect(select_filtered);climate_filter.item_selected.connect(select_filtered)
	selector=OptionButton.new();selector.custom_minimum_size.x=410;hud.add_child(selector)
	for t in catalog.tiles:selector.add_item(t.label)
	selector.item_selected.connect(load_tile)
	var buttons:=HBoxContainer.new();hud.add_child(buttons)
	for spec in [["‹ Tuile",previous_tile],["Tuile ›",next_tile],["Recentrer",reset_view]]:
		var button:=Button.new();button.text=spec[0];button.pressed.connect(spec[1]);buttons.add_child(button)
	mode_button=Button.new();mode_button.pressed.connect(toggle_mode);buttons.add_child(mode_button)
	status=Label.new();hud.add_child(status)
	var ground_row:=HBoxContainer.new();hud.add_child(ground_row)
	ground_view_selector=OptionButton.new();ground_row.add_child(ground_view_selector)
	for label in ["Vue · Render", "Vue · Sol texturé", "Vue · Types de sol", "Vue · Support minéral"]:ground_view_selector.add_item(label)
	ground_view_selector.item_selected.connect(select_ground_view)
	ground_state_selector=OptionButton.new();ground_row.add_child(ground_state_selector)
	for label in ["État Render","Sec","Humide","Neige fraîche","Neige irrégulière","Neige compacte","Neige ancienne","Neige ventée","Neige partielle","Fonte","Glace fine","Glace fracturée"]:ground_state_selector.add_item(label)
	ground_state_selector.tooltip_text="État Render conserve automatiquement la neige du Render source. Les autres presets permettent les essais."
	ground_state_selector.item_selected.connect(select_ground_state)
	variants_button=Button.new();variants_button.text="Nouvelles variantes de textures";variants_button.tooltip_text="Un nouveau choix par type pour toute la carte ; les zones de sol restent fixes.";variants_button.pressed.connect(randomize_ground_variants);hud.add_child(variants_button)
	ground_status=Label.new();ground_status.custom_minimum_size.x=410;ground_status.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;ground_status.add_theme_font_size_override("font_size",12);hud.add_child(ground_status)
	var info_title:=Label.new();info_title.text="Informations";hud.add_child(info_title)
	info_selector=OptionButton.new();info_selector.tooltip_text="Superposer une couche calculée au terrain";info_selector.get_popup().max_size.y=560;hud.add_child(info_selector)
	info_selector.item_selected.connect(select_info_layer)
	var opacity_row:=HBoxContainer.new();hud.add_child(opacity_row)
	var opacity_label:=Label.new();opacity_label.text="Opacité du calque";opacity_row.add_child(opacity_label)
	var opacity_slider:=HSlider.new();opacity_slider.min_value=0;opacity_slider.max_value=1;opacity_slider.step=.05;opacity_slider.value=info_opacity;opacity_slider.custom_minimum_size.x=180;opacity_row.add_child(opacity_slider)
	opacity_slider.value_changed.connect(func(value:float):info_opacity=value;material.set_shader_parameter("info_opacity",0.0 if selected_info=="none" else value))
	info_legend=Label.new();info_legend.custom_minimum_size.x=410;info_legend.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART;info_legend.add_theme_font_size_override("font_size",12);hud.add_child(info_legend)
	info_palette=GridContainer.new();info_palette.columns=2;info_palette.add_theme_constant_override("h_separation",14);info_palette.add_theme_constant_override("v_separation",3);hud.add_child(info_palette)
	var help:=Label.new();help.text="Glisser gauche / milieu : déplacer · molette : zoom\nDroit ou Alt + gauche : orbiter · Tab : Dessus / 3D\nZQSD / WASD / flèches : strafe · Maj : accélérer\n[ / ] : tuile précédente / suivante · R : recentrer · H : aide";help.add_theme_font_size_override("font_size",13);hud.add_child(help)
	survey=SurveyOverlay.new();survey.app=self;survey.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT);survey.mouse_filter=Control.MOUSE_FILTER_IGNORE;layer.add_child(survey)
	altitude_label=Label.new();altitude_label.mouse_filter=Control.MOUSE_FILTER_IGNORE
	altitude_label.add_theme_color_override("font_shadow_color",Color.BLACK);altitude_label.add_theme_constant_override("shadow_offset_x",2);altitude_label.add_theme_constant_override("shadow_offset_y",2)
	altitude_label.add_theme_font_size_override("font_size",16);survey.add_child(altitude_label)
	cursor_altitude=Label.new();cursor_altitude.mouse_filter=Control.MOUSE_FILTER_IGNORE;cursor_altitude.add_theme_font_size_override("font_size",15)
	cursor_altitude.add_theme_color_override("font_shadow_color",Color.BLACK);cursor_altitude.add_theme_constant_override("shadow_offset_x",2);cursor_altitude.add_theme_constant_override("shadow_offset_y",2);survey.add_child(cursor_altitude)

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
	vertex_height_cache.clear();terrain_max_height=maxf(0,float(meta.max))+1;survey_tile=-1
	material.set_shader_parameter("height_map",ImageTexture.create_from_image(height_image))
	material.set_shader_parameter("map_image",ImageTexture.create_from_image(map_image))
	material.set_shader_parameter("height_n",float(meta.n))
	current_index=index;selector.select(index)
	for j in catalog.families.size():
		if catalog.families[j].id==entry.family:family_filter.select(j)
	for j in catalog.climates.size():
		if catalog.climates[j].id==entry.climate:climate_filter.select(j)
	status.text="%02d / 42 · altitude %.0f à %.0f m\n%s · %.0f °C · %.0f mm/an\nDécodeur : %.0f m · grille %d²"%[index+1,meta.min,meta.max,meta.seed,meta.temperature,meta.precipitation,float(meta.get("neural",{}).get("decoderNativeCell",40000.0/meta.n)),int(meta.n)]
	if not hydro.is_empty():status.text+="\nEau vectorielle : %d rivières · %.1f km · %d lacs"%[hydro.rivers,hydro.riverKm,hydro.lakes]
	tile_layers=hydro.get("layers",[]).duplicate();tile_layers.append_array(meta.get("ground",{}).get("layers",[]));tile_dir=dir
	original_cover_meta={}
	if FileAccess.file_exists(dir.path_join("original-cover.json")):
		original_cover_meta=JSON.parse_string(FileAccess.get_file_as_string(dir.path_join("original-cover.json")))
	surface_meta=meta.get("groundSurface",{});tile_layers.append_array(surface_meta.get("layers",[]))
	info_selector.clear();info_selector.add_item("Aucun calque")
	var selected=0
	for j in tile_layers.size():
		info_selector.add_item(tile_layers[j].label)
		info_selector.set_item_tooltip(j+1,tile_layers[j].legend)
		if tile_layers[j].id==selected_info:selected=j+1
	select_info_layer(selected)
	update_ground_surface()
	update_camera()
	print(JSON.stringify({"event":"tile-loaded","id":entry.id,"widthM":40000,"n":meta.n,"heightSha256":meta.heightSha256}))

func select_ground_view(index:int)->void:
	ground_view=index;ground_view_selector.select(index);update_ground_surface()

func select_ground_state(index:int)->void:
	ground_state=index;ground_state_selector.select(index);update_ground_surface()

func update_ground_surface()->void:
	survey_tile=-1
	material.set_shader_parameter("ground_view",0)
	ground_state_selector.disabled=surface_meta.is_empty()
	variants_button.disabled=surface_meta.is_empty()
	if surface_meta.is_empty():ground_status.text="N1–N4 absents pour cette tuile : lancer ground_surface.py.";return
	if ground_view==0:
		update_camera();ground_status.text="Sol : 90 types · N1–N4 disponibles";return
	if not ground_library.initialize(material):ground_status.text=ground_library.error;return
	ground_library.resolve(str(current_meta.seed),material)
	if not ground_library.error.is_empty():ground_status.text=ground_library.error;return
	var state_key=ground_states[ground_state] if ground_state<3 else "mean"
	var state:Dictionary=surface_meta.states[state_key]
	ground_ids_image=load_local_png(tile_dir.path_join(state.indices))
	ground_weights_image=load_local_png(tile_dir.path_join(state.weights))
	ground_ids_extra_image=load_local_png(tile_dir.path_join(state.indicesExtra))
	ground_weights_extra_image=load_local_png(tile_dir.path_join(state.weightsExtra))
	cover_ids_image=load_local_png(tile_dir.path_join(state.coverIndices));cover_weights_image=load_local_png(tile_dir.path_join(state.coverWeights))
	if ground_ids_image==null or ground_weights_image==null:ground_status.text="Classification du sol absente : "+state_key;return
	material.set_shader_parameter("ground_indices",ImageTexture.create_from_image(ground_ids_image))
	material.set_shader_parameter("ground_weights",ImageTexture.create_from_image(ground_weights_image))
	material.set_shader_parameter("ground_indices_extra",ImageTexture.create_from_image(ground_ids_extra_image))
	material.set_shader_parameter("ground_weights_extra",ImageTexture.create_from_image(ground_weights_extra_image))
	material.set_shader_parameter("cover_indices",ImageTexture.create_from_image(cover_ids_image))
	material.set_shader_parameter("cover_weights",ImageTexture.create_from_image(cover_weights_image))
	for pair in [["ground_attributes",surface_meta.attributes],["ground_water",surface_meta.water],["river_footprint",surface_meta.riverFootprint],["ground_structure",surface_meta.get("structure","surface-structure.png")],["render_snow",surface_meta.renderSnow]]:
		var image=load_local_png(tile_dir.path_join(pair[1]))
		if image==null:ground_status.text="Donnée sol absente : "+str(pair[1]);return
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
	ground_status.text="90 types · %d sources PBR · palette %d\n"%[ground_library.assets.size(),ground_library.palette_seed]+("Support minéral · avant les couvertures" if ground_view==3 else "Surface du sol · ombres · neige Render")
	print(JSON.stringify({"event":"ground-view","view":ground_view,"state":ground_states[ground_state],"seed":ground_library.palette_seed,"types":ground_library.selected.size()}))

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
	material.set_shader_parameter("uMaterialClimate",Vector2(current_meta.temperature,current_meta.precipitation))
	material.set_shader_parameter("uMaterialSeed",int(forest.seed))
	# Isolated gallery/shrub candidates must not bypass the forest biome gate.
	material.set_shader_parameter("uHasForestBank",0)
	material.set_shader_parameter("uForestBankDensity",float(forest.bankDensity))
	material.set_shader_parameter("original_light",sun.global_basis.z.normalized())
	var water_image=load_local_png(tile_dir.path_join("surface-water-detail.png"))
	if water_image!=null:material.set_shader_parameter("water_detail",ImageTexture.create_from_image(water_image))
	original_cover_loaded_dir=tile_dir

func randomize_ground_variants()->void:
	if surface_meta.is_empty():return
	if not ground_library.initialize(material):ground_status.text=ground_library.error;return
	ground_library.resolve(str(current_meta.seed),material,true)
	if ground_view==0:ground_view=1;ground_view_selector.select(1)
	# Reuse classifications and physical fields: this button only changes palette.
	update_ground_surface()

func ground_at(x:float,z:float)->String:
	if ground_view==0 or ground_ids_image==null:return ""
	var p=Vector2i(clampi(int(x/40000.0*ground_ids_image.get_width()),0,ground_ids_image.get_width()-1),clampi(int(z/40000.0*ground_ids_image.get_height()),0,ground_ids_image.get_height()-1))
	var ids=ground_ids_image.get_pixelv(p);var shares=ground_weights_image.get_pixelv(p)
	var extra_ids=ground_ids_extra_image.get_pixelv(p);var extra_shares=ground_weights_extra_image.get_pixelv(p)
	var water=ground_water_image.get_pixelv(p)
	var rp=Vector2i(clampi(int(x/40000.0*ground_river_image.get_width()),0,ground_river_image.get_width()-1),clampi(int(z/40000.0*ground_river_image.get_height()),0,ground_river_image.get_height()-1))
	var river=ground_river_image.get_pixelv(rp).a
	var water_mask=maxf(maxf(water.g,water.b),river)
	var domain="Mer" if water.b>.5 else ("Lac" if water.g>.5 else "Rivière")
	if water_mask>.5:
		if ground_view!=3 and ground_state>=10 and ground_attributes_image.get_pixelv(p).g*70.0-48.0<3.0:return domain+" · "+ground_library.describe(88 if ground_state==10 else 89)
		return domain+" · surface d’eau"
	var best_weight=shares[0];var best_id=roundi(ids[0]*255)
	for j in range(1,6):
		var share=shares[j] if j<4 else extra_shares[j-4]
		if share>best_weight:best_weight=share;best_id=roundi((ids[j] if j<4 else extra_ids[j-4])*255)
	var support=ground_library.describe(best_id)
	if ground_view==3:return "Support minéral · "+support
	var cover_shares=cover_weights_image.get_pixelv(p)
	if forest_placement_image!=null:
		var policy=sample_map(forest_placement_image,x,z)
		var matrix=shares.a+extra_shares.r+extra_shares.g
		var amount=cover_shares.a*policy.g*matrix
		if amount>.05:
			var cover_ids=cover_ids_image.get_pixelv(p);var context=Vector3(cover_shares.r*policy.r,cover_shares.g,cover_shares.b);var best=0
			for j in range(1,3):
				if context[j]>context[best]:best=j
			support=("Forêt · " if policy.r>.5 else "Couvert bas · ")+ground_library.describe(roundi(cover_ids[best]*255))+" · %d %%\nSupport : "%roundi(amount*100)+support
		elif policy.b>.3:support="Sol découvert / affleurement · "+support
	elif cover_shares.a>.05:
		var cover_ids=cover_ids_image.get_pixelv(p);var cover_best=0
		for j in range(1,3):
			if cover_shares[j]>cover_shares[cover_best]:cover_best=j
		support="Surface %d %% · "%roundi(cover_shares.a*100)+ground_library.describe(roundi(cover_ids[cover_best]*255))+"\nSupport : "+support
	if ground_state<3:
		var snow_p=Vector2i(clampi(int(x/40000.0*ground_snow_image.get_width()),0,ground_snow_image.get_width()-1),clampi(int(z/40000.0*ground_snow_image.get_height()),0,ground_snow_image.get_height()-1))
		if ground_snow_image.get_pixelv(snow_p).r>.05:return "Neige Render · "+ground_library.describe(80)+"\nSupport : "+support
	if ground_state>=3 and ground_state<=9:
		var attrs=ground_attributes_image.get_pixelv(p)
		var temperature=attrs.g*70.0-30.0-18.0
		var t=clampf((temperature+4.0)/8.0,0,1)
		var snow=attrs.b*(1-t*t*(3-2*t))*(1-water_mask)
		if ground_state==8 or ground_state==9:snow*=.55
		if snow>.05:
			var on_grass=cover_shares.a>.25 and cover_shares.g>cover_shares.r and cover_shares.g>cover_shares.b
			var snow_type=[80,81,82,83,84,86 if on_grass else 87,85][ground_state-3]
			return ground_library.describe(snow_type)+"\nSupport : "+support
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
	selected_info=layer.id;info_legend.text=layer.legend
	for entry in layer.get("palette",[]):
		var row:=HBoxContainer.new();info_palette.add_child(row)
		var swatch:=ColorRect.new();swatch.color=Color(entry.color);swatch.custom_minimum_size=Vector2(14,14);row.add_child(swatch)
		var label:=Label.new();label.text=entry.label;label.add_theme_font_size_override("font_size",12);row.add_child(label)
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
	var next_warp=clampf(log(12000.0/maxf(view_width,1)),0,6)
	var next_focus=Vector2(clampf(focus.x,1,39999),clampf(focus.z,1,39999))
	var next_detail=1.0-smoothstep(300.0,4000.0,view_width) if ground_view>0 else 0.0
	if next_warp!=grid_warp or next_focus!=grid_focus or next_detail!=detail_amount:vertex_height_cache.clear()
	grid_warp=next_warp;grid_focus=next_focus;detail_amount=next_detail
	material.set_shader_parameter("terrain_grid_warp",grid_warp)
	material.set_shader_parameter("terrain_grid_focus",grid_focus)
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
	mode_button.text="Passer en 3D" if top_view else "Vue de dessus"

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

func detail_permute(x:float)->float:return fposmod((34*x+1)*x,289)
func detail_hash(x:float,z:float)->float:return detail_permute(fposmod(x,289)+detail_permute(fposmod(z,289)))/144.0-1.0
func terrain_detail_height(x:float,z:float)->float:
	if detail_amount<=0 or ground_water_image==null:return 0.0
	var water=sample_map(ground_water_image,x,z);var river=sample_map(ground_river_image,x,z).a
	var dry=1.0-smoothstep(0.0,.05,maxf(maxf(water.g,water.b),maxf(water.r,river)))
	var amplitude=.55
	if original_cover_image!=null and not original_cover_meta.is_empty():
		var cover=sample_map(original_cover_image,x,z)
		amplitude=lerpf(lerpf(.55,.14,maxf(cover.r,cover.b)),.08,cover.g)
	var p=Vector2(x,z)/9.5;var b=p.floor();var t=p-b
	var u=Vector2(t.x*t.x*t.x*(t.x*(t.x*6-15)+10),t.y*t.y*t.y*(t.y*(t.y*6-15)+10))
	var value=lerpf(lerpf(detail_hash(b.x,b.y),detail_hash(b.x+1,b.y),u.x),lerpf(detail_hash(b.x,b.y+1),detail_hash(b.x+1,b.y+1),u.x),u.y)
	var spacing=maxf(grid_spacing(x,0),grid_spacing(z,1))
	return value*amplitude*dry*detail_amount*(1.0-smoothstep(2.0,8.0,spacing))

func grid_spacing(world:float,axis:int)->float:
	if grid_warp<.001:return 40000.0/mesh_cells
	var centre=grid_focus[axis];var extent=centre if world<centre else 40000-centre
	var s=(world-centre)*sinh(grid_warp)/extent
	var t=(log(s+sqrt(s*s+1))/grid_warp+1)*.5
	return grid_coordinate(minf(t+.5/mesh_cells,1),axis)-grid_coordinate(maxf(t-.5/mesh_cells,0),axis)

func grid_coordinate(t:float,axis:int)->float:
	if grid_warp<.001:return t*40000.0
	var q=t*2-1;var centre=grid_focus[axis]
	return centre+(centre if q<0 else 40000-centre)*sinh(grid_warp*q)/sinh(grid_warp)
func grid_index(world:float,axis:int)->int:
	if grid_warp<.001:return clampi(int(floor(world/40000.0*mesh_cells)),0,mesh_cells-1)
	var centre=grid_focus[axis]
	var s=(world-centre)*sinh(grid_warp)/(centre if world<centre else 40000-centre)
	var inverse=log(s+sqrt(s*s+1))
	return clampi(int(floor((inverse/grid_warp+1)*.5*mesh_cells)),0,mesh_cells-1)
func spline_weights(t:float)->Vector4:
	var u=1-t
	return Vector4(u*u*u,3*t*t*t-6*t*t+4,-3*t*t*t+3*t*t+3*t+1,t*t*t)/6.0

func mesh_vertex(x:int,z:int)->Vector3:
	var key=z*(mesh_cells+1)+x
	var px=grid_coordinate(float(x)/mesh_cells,0);var pz=grid_coordinate(float(z)/mesh_cells,1)
	if not vertex_height_cache.has(key):vertex_height_cache[key]=surface_height(px,pz)
	return Vector3(px,vertex_height_cache[key],pz)

func pick_terrain(screen:Vector2)->Variant:
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
	var p=origin+direction*(start+.001)
	var x=grid_index(p.x,0);var z=grid_index(p.z,1)
	var step_x=1 if direction.x>=0 else -1;var step_z=1 if direction.z>=0 else -1
	for _iteration in mesh_cells*2+2:
		var tx=(grid_coordinate(float(x+1 if step_x>0 else x)/mesh_cells,0)-origin.x)/direction.x if absf(direction.x)>1e-10 else INF
		var tz=(grid_coordinate(float(z+1 if step_z>0 else z)/mesh_cells,1)-origin.z)/direction.z if absf(direction.z)>1e-10 else INF
		var a=mesh_vertex(x,z);var b=mesh_vertex(x+1,z);var c=mesh_vertex(x,z+1);var d=mesh_vertex(x+1,z+1)
		var first=Geometry3D.ray_intersects_triangle(origin,direction,a,b,c)
		var second=Geometry3D.ray_intersects_triangle(origin,direction,b,d,c)
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
