extends SceneTree
# Isolated soil comparison only. Nine native palettes are not Canvas brush styles.
const Data=preload("res://adapters/surface_data.gd")
const Presentation=preload("res://adapters/surface_presentation.gd")
const PALETTE_IDS=["parchment","atlas","watabou","engraving","cadastre","blueprint","illuminated","topographic","night"]
var viewer:Node
var controls:Node

static func style_choices(catalogue_path:String)->Array:
	var value=JSON.parse_string(FileAccess.get_file_as_string(catalogue_path))
	if not value is Dictionary or value.get("format")!="magna-surface-palette-catalogue" or value.get("version")!=1:return []
	var choices=[{"id":"aerial","label":"Aerien R4 - experimental","mode":"aerial","style":"","coverage":"PBR physique + repartition R4 ou reference uniforme"}]
	for id in PALETTE_IDS:
		if not value.get("palettes",{}).get(id) is Dictionary:return []
		choices.append({"id":id,"label":str(value.get("terrainStyles",{}).get(id,{}).get("label",id)),"mode":"cartographic","style":id,"coverage":"Palette native du sol + relief ; sans brosses, hachures ni mise en page Canvas"})
	return choices

class SoilControls extends Node:
	var scene:Node
	var styles:Array=[]
	var style_index:=0
	var catalogue_path:=""
	var label:=Label.new()
	var picker:=OptionButton.new()
	var detail_button:=Button.new()
	var low_button:=Button.new()
	var mean_button:=Button.new()
	var capture_button:=Button.new()
	var detail:=true
	var low:=true
	var mean_only:=false
	var elapsed:=0.0
	var style_dirty:=true
	var bound_generation:=-1
	var capturing:=false
	var captures:Array=[]
	var last_capture:=""
	func _ready()->void:
		var canvas:=CanvasLayer.new();add_child(canvas)
		var panel:=PanelContainer.new();canvas.add_child(panel);panel.position=Vector2(12,12)
		var column:=VBoxContainer.new();panel.add_child(column)
		var navigation:=HBoxContainer.new();column.add_child(navigation)
		var previous:=Button.new();previous.text="<";previous.tooltip_text="Palette precedente (fleche gauche)";previous.pressed.connect(func():select_style(style_index-1));navigation.add_child(previous)
		for entry in styles:picker.add_item(entry.label)
		picker.selected=style_index;picker.item_selected.connect(select_style);picker.custom_minimum_size.x=265;navigation.add_child(picker)
		var following:=Button.new();following.text=">";following.tooltip_text="Palette suivante (fleche droite)";following.pressed.connect(func():select_style(style_index+1));navigation.add_child(following)
		capture_button.disabled=true;capture_button.text="Capture PNG + JSON (S)";capture_button.pressed.connect(capture_view);navigation.add_child(capture_button)
		var toggles:=HBoxContainer.new();column.add_child(toggles)
		detail_button.pressed.connect(toggle_detail);low_button.pressed.connect(toggle_low);mean_button.pressed.connect(toggle_mean)
		for button in [detail_button,low_button,mean_button]:toggles.add_child(button)
		column.add_child(label);label.add_theme_font_size_override("font_size",14)
		apply()
	func current_style()->Dictionary:return styles[style_index].duplicate(true) if not styles.is_empty() else {}
	func select_style(index:int)->bool:
		if styles.is_empty():return false
		style_index=posmod(index,styles.size());picker.select(style_index);style_dirty=true;apply();return true
	func toggle_detail()->void:detail=not detail;apply()
	func toggle_low()->void:low=not low;apply()
	func toggle_mean()->void:mean_only=not mean_only;style_dirty=true;apply()
	func _input(event:InputEvent)->void:
		if event is InputEventKey and event.pressed and not event.echo:
			match event.keycode:
				KEY_F1:toggle_detail()
				KEY_F2:toggle_low()
				KEY_F3:toggle_mean()
				KEY_LEFT:select_style(style_index-1)
				KEY_RIGHT:select_style(style_index+1)
				KEY_S:capture_view()
				KEY_O,KEY_D:pass # fixed TOP, explicit diagnostic only
				_:return
			get_viewport().set_input_as_handled()
	func settled()->bool:
		if scene.get("terrain")==null or scene.get("worker")!=null or scene.get("packet_worker")!=null:return false
		if bool(scene.get("view_dirty")) or bool(scene.get("water_projection_busy")) or bool(scene.get("canopy_transition_busy")):return false
		var shown:Dictionary=scene.get("rendered_world");var requested:Dictionary=scene.get("world")
		return not shown.is_empty() and shown.get("id")==requested.get("id")
	func apply()->void:
		if scene.get("terrain")==null or styles.is_empty():return
		scene.call("set_layer_visibility",true,low,false)
		scene.get("objects").visible=false;scene.get("sun").shadow_enabled=false;scene.get("hud").visible=false
		var material=scene.get("terrain").get("material")
		var generation=int(scene.get("applied_generation"))
		if style_dirty or generation!=bound_generation:
			var selected=current_style();var mode="diagnostic" if mean_only else str(selected.mode)
			var packet=Presentation.overrides(scene.get("packet"),selected.style,catalogue_path)
			scene.set("packet",packet);scene.set("rendered_packet",Presentation.overrides(scene.get("rendered_packet"),selected.style,catalogue_path))
			# The existing binder changes uniforms/environment only, never source or geometry.
			Presentation.configure_environment(scene.get("environment_settings"),mode,packet)
			Presentation.configure_terrain(material,packet,mode)
			scene.set("presentation_mode",selected.mode);scene.set("rendered_presentation_mode",selected.mode)
			var options:Dictionary=scene.get("options");options["--presentation"]=selected.mode
			if str(selected.style).is_empty():options.erase("--style")
			else:options["--style"]=selected.style
			scene.get("sun").visible=mode=="aerial";scene.get("sun").light_energy=1.5 if mode=="aerial" else 0.0
			bound_generation=generation;style_dirty=false
		scene.set("diagnostic",7 if mean_only else 0)
		material.call("set_shader_param","surface_detail_distribution_enabled",detail)
		material.call("set_shader_param","diagnostic",7 if mean_only else 0)
		detail_button.text="F1 R4 : "+("ON" if detail else "reference uniforme")
		detail_button.disabled=current_style().mode!="aerial"
		low_button.text="F2 Couvert bas : "+("ON" if low else "OFF")
		mean_button.text="F3 Moyenne physique : "+("ON" if mean_only else "OFF")
		capture_button.disabled=capturing or not settled()
	func snapshot()->Dictionary:
		var focus:Dictionary=scene.get("focus")
		var world:Dictionary=scene.get("rendered_world")
		var context:Dictionary=Data.context(world) if not world.is_empty() else {}
		var x=float(focus.get("x",0));var z=float(focus.get("y",0));var width=float(scene.get("width_m"));var size=scene.get_viewport().get_visible_rect().size
		var half_z=width*float(size.y)/maxf(1,float(size.x))*.5;var probes=[]
		for delta in [[0.0,0.0],[-width*.5,-half_z],[width*.5,-half_z],[-width*.5,half_z],[width*.5,half_z]]:
			var px=x+float(delta[0]);var pz=z+float(delta[1]);var height=Data.height_at(world,px,pz) if not world.is_empty() else NAN
			probes.append({"x":px,"z":pz,"covered":not world.is_empty() and Data.covered(world,px,pz),"heightM":height if is_finite(height) else null,"finiteHeight":is_finite(height)})
		return {"settled":settled(),"sourceCoverage":{"scope":"focus and four TOP viewport corners; not a continuous domain certificate","probes":probes,"allProbesFinite":probes.all(func(p):return p.covered and p.finiteHeight)},"mapProjection":scene.call("_map_projection") if scene.get("terrain")!=null else {},"style":current_style(),"focus":{"x":float(focus.get("x",0)),"z":float(focus.get("y",0))},"widthM":float(scene.get("width_m")),"detail":detail,"lowCover":low,"meanOnly":mean_only,"component":"surface-detail-distribution-4","objectsVisible":false,"treesVisible":false,"engineShadows":false,"worldId":world.get("id",""),"canonicalContextId":context.get("id",""),"groundResponseId":context.get("groundResponse",{}).get("id",""),"source":world.get("terrain",{}).get("source",{}),"scope":"native soil/palette preview; no Canvas brush, no new source/generation"}
	func capture_view()->Dictionary:
		if capturing or not settled():return {"status":"not-ready","reason":"terrain/source preparation pending"}
		capturing=true;capture_button.disabled=true;apply()
		for frame in 2:await get_tree().process_frame
		if not settled():capturing=false;apply();return {"status":"not-ready","reason":"view changed before capture"}
		var record=snapshot();var stamp=Time.get_datetime_string_from_system().replace(":","-")
		var directory=str(scene.get("options").get("--soil-capture-dir","user://soil-preview-r4"))
		directory=ProjectSettings.globalize_path(directory);DirAccess.make_dir_recursive_absolute(directory)
		var filename="soil-%s-x%.2f-z%.2f-w%.2f-%s-%d"%[record.style.id,record.focus.x,record.focus.z,record.widthM,stamp,Time.get_ticks_msec()]
		var image_path=directory.path_join(filename+".png");await scene.call("_capture",image_path)
		record["captureStatus"]="complete" if settled() and FileAccess.file_exists(image_path) else "unstable-or-failed"
		record["format"]="surface-soil-user-capture";record["version"]=1;record["imagePath"]=image_path;record["imageSha256"]=FileAccess.get_sha256(image_path)
		var json_path=directory.path_join(filename+".json");var output=FileAccess.open(json_path,FileAccess.WRITE)
		if output!=null:output.store_string(JSON.stringify(record,"  "));output=null
		else:push_error("Cannot save soil capture metadata: "+json_path)
		record["jsonPath"]=json_path;captures.append(record);last_capture=json_path.get_file();capturing=false;capture_button.disabled=false;return record
	func _process(delta:float)->void:
		elapsed+=delta
		if elapsed<.25:return
		elapsed=0.0;apply()
		var world:Dictionary=scene.get("rendered_world")
		if world.is_empty():label.text="Chargement du terrain retenu...";return
		var context:Dictionary=Data.context(world);var focus:Dictionary=scene.get("focus")
		var x=float(focus.get("x",0));var z=float(focus.get("y",0));var chosen=current_style()
		label.text="SOLS EXPERIMENTAUX - TOP - sans arbres/objets/ombres\n%s - %s\n%.2f m | X %.2f / Z %.2f\nFleches : palettes | molette : zoom | glisser : deplacer | 1-7 : echelles\nF1 R4 : aerien seulement | F2 : couvert bas | F3 : moyenne physique | S : capture\n%s\n%s\nRepartition procedurale, pas de sols fins observes.%s"%[chosen.label,"moyenne physique hors palette" if mean_only else chosen.mode,float(scene.get("width_m")),x,z,weights(world,context,x,z),chosen.coverage,"\nCapture : "+last_capture if not last_capture.is_empty() else ""]
	func weights(world:Dictionary,context:Dictionary,x:float,z:float)->String:
		if not context.get("groundResponse") is Dictionary:return "Poids physiques complets indisponibles : legacy explicite."
		var grid:Dictionary=context.grid;var fields:Dictionary=context.fields;var response:Dictionary=context.groundResponse.fields
		var rock=clampf((Data.sample_grid(grid,fields.stoniness,x,z)-.08)/.75,0,1)
		var slope=Data.sample_grid(grid,fields.slope,x,z);var organic=Data.sample_grid(grid,fields.organic,x,z)
		var moisture=Data.sample_grid(grid,response.moisturePreSaturation,x,z);var aridity=Data.sample_grid(grid,response.aridity,x,z)
		var transport=[Data.sample_grid(grid,response.alluvial,x,z),Data.sample_grid(grid,response.gravity,x,z),Data.sample_grid(grid,response.wind,x,z),Data.sample_grid(grid,response.coastal,x,z)]
		var total:float=transport.reduce(func(a,b):return a+b,0.0);var scale=maxf(1,total);var rest=(1-rock)*(1-minf(1,total))
		var dry=clampf((.65-aridity)/.4,0,1);var humus=smoothstep(.72,.88,moisture)*(1-smoothstep(.08,.16,slope))*smoothstep(.02,.16,organic)
		var values=[rock,rest*(1-dry)*(1-humus),rest*(1-dry)*humus,rest*dry]
		for p in transport:values.append(p/scale*(1-rock))
		var names=["roche","mineral","humus","sec","alluvial","gravitaire","eolien","cotier"];var parts:PackedStringArray=[]
		var occupation=int(Data.sample_grid(grid,fields.occupation,x,z,true))
		if occupation==2:parts.append("culture (voir recette source)")
		else:
			for i in values.size():
				if values[i]>.0005:parts.append("%s %.1f%%"%[names[i],values[i]*100])
		var alpha=Data.sample_grid(grid,fields.lowCoverOpacity,x,z)
		return "Poids GR au centre (CPU arrondi) : "+", ".join(parts)+" · couvert bas %.1f%% · contexte %.3fm"%[alpha*100,float(grid.spacingM)]

func _initialize()->void:call_deferred("run")
func run()->void:
	viewer=load("res://scene/main.tscn").instantiate();root.add_child(viewer);current_scene=viewer
	viewer.set("layer_visibility",{"ground":true,"lowCover":true,"trees":false});viewer.set("oblique",false)
	viewer.get("objects").visible=false;viewer.get("sun").shadow_enabled=false
	var options:Dictionary=viewer.get("options")
	var catalogue=str(options.get("--style-catalogue",ProjectSettings.globalize_path("res://").path_join("../surface/presentation/palettes.json").simplify_path()))
	var choices=style_choices(catalogue)
	if choices.is_empty():push_error("Soil preview requires the local nine-palette catalogue: "+catalogue);quit(2);return
	controls=SoilControls.new();controls.scene=viewer;controls.styles=choices;controls.catalogue_path=catalogue
	var requested=str(options.get("--style","aerial")).to_lower()
	if requested in ["","soil-r4"]:requested="aerial"
	var found=false
	for i in choices.size():
		if choices[i].id==requested:controls.style_index=i;found=true;break
	if not found:push_error("Unsupported native soil style: "+requested);quit(2);return
	root.add_child(controls)
