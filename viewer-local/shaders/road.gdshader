shader_type spatial;
render_mode cull_back;
void fragment(){
    ALBEDO=vec3(0.21,0.20,0.18);
    ROUGHNESS=0.91;
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
    DEPTH=clamp(FRAGCOORD.z-0.0000003,0.0,1.0);
#else
    DEPTH=clamp(FRAGCOORD.z+0.0000003,0.0,1.0);
#endif
}
