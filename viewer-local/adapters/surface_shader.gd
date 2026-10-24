class_name SurfaceShader
extends RefCounted

static func build() -> String:
	var code := FileAccess.get_file_as_string("res://addons/terrain_3d/extras/shaders/minimum.gdshader").replace("\r", "")
	var header := "// Public Uniforms"
	var body := "ALBEDO = vec3(.2);\n\tROUGHNESS = .7;"
	assert(code.count(header)==1 and code.count(body)==1,"Pinned Terrain3D minimum shader anchors changed")
	assert(code.contains("varying vec3 v_vertex;") and code.contains("void vertex()") and code.contains("bool hole ="),"Terrain3D shader contract changed")
	# Keep native hole control/collision data intact; large visual triangles are
	# clipped per fragment instead of deleted by a single off-domain vertex.
	var hole_anchor="bool hole = bool(control >>2u & 0x1u);"
	assert(code.count(hole_anchor)==1,"Pinned Terrain3D hole anchor changed")
	code=code.replace(hole_anchor,"bool hole = false; // visual source-domain clipping follows in fragment")
	code = code.replace(header,FileAccess.get_file_as_string("res://shaders/surface_uniforms.gdshaderinc")+"\n"+header)
	return code.replace(body,FileAccess.get_file_as_string("res://shaders/surface_body.gdshaderinc"))
