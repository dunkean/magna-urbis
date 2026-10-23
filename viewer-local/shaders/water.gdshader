shader_type spatial;
render_mode blend_mix,depth_draw_opaque,cull_disabled;
uniform vec3 tint : source_color = vec3(0.035,0.17,0.20);
uniform vec2 wave_phase;
varying vec2 local_position;
void vertex(){ local_position=(MODEL_MATRIX*vec4(VERTEX,1.0)).xz; }
void fragment(){
    vec2 p=local_position;
    float footprint=max(length(dFdx(p)),length(dFdy(p)));
    float a=(1.0-smoothstep(0.1,1.0,footprint))*0.045;
    vec2 wave=vec2(cos(p.x*2.1+p.y*0.47+wave_phase.x+TIME*0.8),sin(p.y*1.7-p.x*0.65+wave_phase.y+TIME*0.6))*a;
    NORMAL_MAP=normalize(vec3(wave,1.0))*0.5+0.5;
    ALBEDO=tint; ROUGHNESS=0.16; METALLIC=0.05; SPECULAR=0.65;
#if CURRENT_RENDERER == RENDERER_COMPATIBILITY
    DEPTH=clamp(FRAGCOORD.z-0.0000003,0.0,1.0);
#else
    DEPTH=clamp(FRAGCOORD.z+0.0000003,0.0,1.0);
#endif
}
