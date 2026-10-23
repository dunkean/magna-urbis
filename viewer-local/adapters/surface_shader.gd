class_name SurfaceShader
extends RefCounted

static func build() -> String:
	var code := FileAccess.get_file_as_string("res://addons/terrain_3d/extras/shaders/minimum.gdshader").replace("\r", "")
	var header := "// Public Uniforms"
	var body := "ALBEDO = vec3(.2);\n\tROUGHNESS = .7;"
	assert(code.count(header)==1 and code.count(body)==1,"Pinned Terrain3D minimum shader anchors changed")
	assert(code.contains("varying vec3 v_vertex;") and code.contains("void vertex()") and code.contains("bool hole ="),"Terrain3D shader contract changed")
	code = code.replace(header,FileAccess.get_file_as_string("res://shaders/surface_uniforms.gdshaderinc")+"\n"+header)
	return code.replace(body,FileAccess.get_file_as_string("res://shaders/surface_body.gdshaderinc"))
