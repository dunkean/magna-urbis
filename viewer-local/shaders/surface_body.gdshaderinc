    vec2 source_uv=((v_vertex.xz-source_origin)/source_spacing_m+vec2(0.5))/source_grid_size;
    ivec2 size=textureSize(surface_ids,0);
    vec2 grid=clamp(source_uv*vec2(size)-vec2(0.5),vec2(0.0),vec2(size)-vec2(1.001));
    ivec2 cell=ivec2(floor(grid));
    vec2 f=fract(grid);
    vec4 surface_weights=vec4((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
    vec4 slots[4];
    slots[0]=texelFetch(surface_ids,cell,0);
    slots[1]=texelFetch(surface_ids,cell+ivec2(1,0),0);
    slots[2]=texelFetch(surface_ids,cell+ivec2(0,1),0);
    slots[3]=texelFetch(surface_ids,cell+ivec2(1,1),0);
    int ids[8]; float slot_weights[8];
    for(int i=0;i<4;i++) {
        ids[i*2]=clamp(int(slots[i].r+0.5),0,31);
        ids[i*2+1]=clamp(int(slots[i].g+0.5),0,31);
        slot_weights[i*2]=surface_weights[i]*(1.0-slots[i].b);
        slot_weights[i*2+1]=surface_weights[i]*slots[i].b;
    }
    vec4 state=texture(surface_state,source_uv);
    vec2 p=v_vertex.xz+world_phase;
    float footprint=max(length(dFdx(v_vertex.xz)),length(dFdy(v_vertex.xz)));
    vec4 ah=vec4(0.0); vec4 nr=vec4(0.0); vec4 mean_palette=vec4(0.0);
    float fine=0.0;
    for(int i=0;i<8;i++) {
        bool first=true;
        for(int j=0;j<i;j++) if(ids[i]==ids[j]) first=false;
        if(first) {
            int id=ids[i]; float weight=0.0;
            for(int j=0;j<8;j++) if(ids[i]==ids[j]) weight+=slot_weights[j];
            if(weight<=0.00001) continue;
            float scale=max(material_scales[id],0.25);
            vec4 a; vec4 n;
            sample_surface_material(v_vertex,w_normal,w_tangent,w_binormal,id,a,n);
            ah+=a*weight; nr+=n*weight; mean_palette+=palette[id]*weight;
            fine+=(1.0-smoothstep(scale*0.2,scale*1.5,footprint))*weight;
        }
    }
    float macro=surface_noise(v_vertex.xz/16.0+noise_phase_16.xy,noise_phase_16.zw);
    // The canonical mean already includes substrate and the full recipe mixture;
    // use it at every scale, including contacts where the compact pair loses a third recipe.
    vec3 base=texture(surface_average,source_uv).rgb;
    // Fallback atlases carry neutral greys. Authored PBR remains modulated by substrate.
    vec3 ground=base*mix(vec3(1.0),ah.rgb,0.82);
    ground=mix(ground,base,smoothstep(source_spacing_m*0.5,source_spacing_m*2.0,footprint));
    ground*=0.91+0.18*macro;
    float wet=clamp(state.g,0.0,1.0);
    ground*=1.0-wet*0.28;
    float canopy=clamp(state.r,0.0,1.0);
    float crown=surface_noise(v_vertex.xz/9.0+noise_phase_9.xy,noise_phase_9.zw);
    float canopy_pattern=mix(canopy,smoothstep(1.0-canopy-0.12,1.0-canopy+0.12,crown),1.0-smoothstep(3.0,18.0,footprint));
    // The same projected-size band thins object geometry; no camera-distance palette switch.
    float distant=smoothstep(1.0,6.0,footprint);
    float edge=min(min(v_vertex.x-candidate_bounds.x,candidate_bounds.z-v_vertex.x),min(v_vertex.z-candidate_bounds.y,candidate_bounds.w-v_vertex.z));
    distant=max(distant,1.0-smoothstep(0.0,24.0,edge));
    ground=mix(ground,vec3(0.055,0.105,0.036)*(0.8+0.4*crown),canopy_pattern*distant);
    ground=mix(ground,vec3(0.79,0.83,0.87),state.b);
    ALBEDO=display_color(clamp(ground,vec3(0.0),vec3(0.95)));
    ROUGHNESS=clamp(mix(mean_palette.a,nr.a,0.7)-wet*0.28+state.b*0.05,0.12,1.0);
    NORMAL_MAP=mix(vec3(0.5,0.5,1.0),nr.xyz,fine*micro_strength*(1.0-state.b));
    NORMAL_MAP_DEPTH=0.75;
    AO=mix(1.0,0.78+0.22*ah.a,fine);
    if(diagnostic==1) ALBEDO=display_color(base);
    if(diagnostic==2) ALBEDO=vec3(state.r,state.a,state.g);
    if(diagnostic==3) { float b=texture(surface_bedrock,source_uv).r; ALBEDO=vec3(fract(b*0.618),fract(b*0.371+0.2),fract(b*0.217+0.4)); }
    if(diagnostic==4) ALBEDO=vec3(state.b,wet,1.0-wet);
    if(diagnostic==5) { ALBEDO=vec3(0.0); EMISSION=normalize(w_normal)*0.5+0.5; NORMAL_MAP=vec3(0.5,0.5,1.0); }

