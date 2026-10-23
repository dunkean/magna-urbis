shader_type canvas_item;
render_mode unshaded, blend_disabled;
uniform sampler2D source_map : filter_nearest, repeat_disable;
void fragment(){COLOR=texelFetch(source_map,ivec2(floor(UV*vec2(textureSize(source_map,0)))),0);}
