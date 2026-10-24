extends SceneTree
# Explicit isolated soil experiment. Does not replace the mapper's Render view.
# Uses the existing immutable packet/camera controls; no trees, objects or shadows.
const Data=preload("res://adapters/surface_data.gd")
var viewer:Node
var controls:Node

class SoilControls extends Node:
	var scene:Node
	var label:=Label.new()
	var detail:=true
	var low:=true
	var mean_only:=false
	var elapsed:=0.0
	func _ready()->void:
		var canvas:=CanvasLayer.new();add_child(canvas);canvas.add_child(label)
		label.position=Vector2(16,16);label.add_theme_color_override("font_color",Color.WHITE)
		label.add_theme_color_override("font_shadow_color",Color.BLACK);label.add_theme_constant_override("shadow_offset_x",1);label.add_theme_constant_override("shadow_offset_y",1)
	func _input(event:InputEvent)->void:
		if event is InputEventKey and event.pressed and not event.echo:
			match event.keycode:
				KEY_F1:detail=not detail
				KEY_F2:low=not low
				KEY_F3:mean_only=not mean_only
				KEY_O,KEY_D:get_viewport().set_input_as_handled();return # fixed TOP
				_:return
			get_viewport().set_input_as_handled();apply()
	func apply()->void:
		if scene.get("terrain")==null:return
		scene.call("set_layer_visibility",true,low,false)
		scene.get("objects").visible=false;scene.get("sun").shadow_enabled=false
		scene.get("hud").visible=false
		var material=scene.get("terrain").get("material")
		material.call("set_shader_param","surface_detail_distribution_enabled",detail)
		material.call("set_shader_param","diagnostic",7 if mean_only else 0)
	func _process(delta:float)->void:
		elapsed+=delta
		if elapsed<.25:return
		elapsed=0.0;apply()
		var world:Dictionary=scene.get("rendered_world")
		if world.is_empty():label.text="Chargement du terrain retenu…";return
		var context:Dictionary=Data.context(world);var focus:Vector2=scene.get("focus")
		label.text="SOLS R4 — EXPERIMENTAL · TOP · sans arbres/objets/ombres\n%.2f m · centre %.2f / %.2f\nF1 : detail %s · F2 : couvert bas %s · F3 : moyenne physique %s\nMolette : zoom · glisser : deplacer · 1–7 : echelles · Echap : quitter\n%s\nRelief retenu ; repartition procedurale, pas de sols fins observes."%[float(scene.get("width_m")),focus.x,focus.y,"actif" if detail else "ancien uniforme","actif" if low else "masque","seule" if mean_only else "PBR",weights(world,context,focus.x,focus.y)]
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
	# Set flags before any asynchronous prepared scene can be applied.
	viewer.set("layer_visibility",{"ground":true,"lowCover":true,"trees":false});viewer.set("oblique",false)
	viewer.get("objects").visible=false;viewer.get("sun").shadow_enabled=false
	controls=SoilControls.new();controls.scene=viewer;root.add_child(controls)
