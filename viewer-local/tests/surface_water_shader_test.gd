extends SceneTree
func _initialize():
	var shader=load("res://shaders/water.gdshader") as Shader
	var material=ShaderMaterial.new(); material.shader=shader
	var uniforms=shader.get_shader_uniform_list()
	var names=[]
	for uniform in uniforms: names.append(uniform.name)
	for name in ["coverage_enabled","coverage_map","bed_clip_enabled","bed_cubic","render_origin_y","tint","linear_tint","presentation_mode","class_enabled","class_map","linear_river_tint","linear_lake_tint","linear_sea_tint"]:
		if not names.has(name): push_error("Missing water shader uniform "+name); quit(1); return
	print(JSON.stringify({"uniformCount":uniforms.size(),"shaderLoaded":shader!=null}))
	quit(0)
