shader_type spatial;
uniform vec3 linear_tint = vec3(1.0);
varying vec3 instance_linear_albedo;
varying float projected_size;
vec3 object_srgb(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),c));}
void vertex(){
    instance_linear_albedo=COLOR.rgb;
    vec4 centre_view=VIEW_MATRIX*MODEL_MATRIX*vec4(0.0,0.0,0.0,1.0);
    float denominator=PROJECTION_MATRIX[3][3]>0.5?1.0:max(0.001,-centre_view.z);
    projected_size=INSTANCE_CUSTOM.r*abs(PROJECTION_MATRIX[1][1])*VIEWPORT_SIZE.y/(2.0*denominator);
}
void fragment(){
    vec3 albedo=instance_linear_albedo*linear_tint;
    ALBEDO=OUTPUT_IS_SRGB?object_srgb(albedo):albedo;
    ROUGHNESS=0.91;
    ALPHA=smoothstep(1.25,3.0,projected_size);
    ALPHA_HASH_SCALE=1.0;
}
