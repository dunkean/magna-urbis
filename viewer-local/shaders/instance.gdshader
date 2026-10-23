shader_type spatial;
uniform vec4 tint : source_color = vec4(0.10,0.20,0.065,1.0);
varying float object_fade;
void vertex(){ object_fade=INSTANCE_CUSTOM.r; }
void fragment(){
    ALBEDO=tint.rgb;
    ROUGHNESS=0.91;
    ALPHA=object_fade;
    ALPHA_HASH_SCALE=1.0;
}
