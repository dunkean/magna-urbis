shader_type spatial;
render_mode unshaded,cull_back;
void fragment(){
    vec3 world_normal=normalize((INV_VIEW_MATRIX*vec4(NORMAL,0.0)).xyz);
    ALBEDO=world_normal*0.5+0.5;
}
