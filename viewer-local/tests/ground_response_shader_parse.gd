extends SceneTree
func _initialize():call_deferred("run")
func run():
	var shader=Shader.new()
	shader.code="""shader_type spatial;
uniform vec4 palette[32];
uniform sampler2D surface_ids;
uniform sampler2D surface_average;
uniform int presentation_mode=0;
uniform vec4 map_palette[32];
#include "res://shaders/ground_response.gdshaderinc"
void fragment(){ivec2 pair;float blend;vec3 mean;bool available=ground_response_sample(UV,pair,blend,mean);vec3 mapped=mix(map_palette[pair.x].rgb,map_palette[pair.y].rgb,blend);ALBEDO=available?(presentation_mode==1?mapped:mean):vec3(0.1);}
"""
	var uniforms=shader.get_shader_uniform_list()
	var names=[]
	for entry in uniforms:names.append(entry.name)
	var ok="ground_response_enabled" in names and "ground_response_unit_colors" in names and "presentation_mode" in names and "map_palette" in names
	print(JSON.stringify({"status":"PASS" if ok else "FAIL","uniforms":names,"scope":"Headless shader-language parse/reflection only; no GPU rendering or numerical claim"}));quit(0 if ok else 1)
