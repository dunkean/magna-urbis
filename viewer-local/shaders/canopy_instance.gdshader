shader_type spatial;
#include "res://shaders/canopy.gdshaderinc"
#include "res://shaders/color_space.gdshaderinc"
// LINEAR tint. Deliberately no source_color conversion.
uniform int presentation_mode = 0;
uniform vec3 linear_tint = vec3(0.055,0.105,0.036);
varying vec3 canopy_world_position;
varying flat int canopy_class;
void vertex() {
    canopy_world_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xyz;
    canopy_class=int(INSTANCE_CUSTOM.g+0.5);
}
void fragment() {
    float footprint=canopy_pixel_footprint(canopy_world_position.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE);
    ALBEDO=display_color(linear_tint);
    ROUGHNESS=presentation_mode==1?1.0:0.91;
    if(presentation_mode==1) SPECULAR=0.0;
    ALPHA=canopy_instance_weight(canopy_class,footprint);
    ALPHA_HASH_SCALE=1.0;
}
