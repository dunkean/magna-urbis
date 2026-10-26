extends SceneTree
const ShaderSource = preload("res://adapters/surface_shader.gd")

func _initialize() -> void:
	var script = load("res://scene/main.gd")
	assert(script!=null)
	assert(ClassDB.class_exists("Terrain3D"),"Run bootstrap.ps1 to install Terrain3D")
	var addon = ClassDB.instantiate("Terrain3D")
	assert(addon.get("version")=="1.0.2","Expected pinned Terrain3D 1.0.2")
	addon.free()
	var shader := Shader.new()
	shader.code = ShaderSource.build()
	assert(shader.get_shader_uniform_list().size()>0,"Surface shader parse failed")
	print("Surface viewer GDScript, addon version, minimum-shader anchors and shader parser: PASS. Full GPU compilation still requires a rendered capture.")
	quit()
