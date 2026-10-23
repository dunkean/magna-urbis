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
    // Derivatives must be evaluated outside data-dependent material/projection branches.
    vec3 surface_dx=dFdx(v_vertex);
    vec3 surface_dy=dFdy(v_vertex);
    float footprint=max(length(surface_dx.xz),length(surface_dy.xz));
    vec4 ah=vec4(0.0); vec4 nr=vec4(0.0); vec4 mean_palette=vec4(0.0);
    float fine=0.0;
    vec3 source_mean=vec3(0.0);
    vec3 map_mean=vec3(0.0);
    for(int i=0;i<8;i++) {
        bool first=true;
        for(int j=0;j<i;j++) if(ids[i]==ids[j]) first=false;
        if(first) {
            int id=ids[i]; float weight=0.0;
            for(int j=0;j<8;j++) if(ids[i]==ids[j]) weight+=slot_weights[j];
            if(weight<=0.00001) continue;
            float scale=max(material_scales[id],0.25);
            vec4 a; vec4 n;
            if(presentation_mode==0) sample_surface_material(v_vertex,surface_dx,surface_dy,w_normal,w_tangent,w_binormal,id,a,n);
            else { a=vec4(0.0); n=vec4(0.5,0.5,1.0,1.0); }
            ah+=a*weight; nr+=n*weight; mean_palette+=palette[id]*weight;
            source_mean+=layer_mean[material_layers[id]].rgb*weight;
            map_mean+=map_palette[id].rgb*weight;
            fine+=(1.0-smoothstep(scale*0.2,scale*1.5,footprint))*weight;
        }
    }
    float macro=surface_noise(v_vertex.xz/16.0+noise_phase_16.xy,noise_phase_16.zw);
    // The canonical mean already includes substrate and the full recipe mixture;
    // use it at every scale, including contacts where the compact pair loses a third recipe.
    vec3 base=texture(surface_average,source_uv).rgb;
    // One shared contrast gain preserves a neutral pebble's chroma. Per-channel
    // division can turn bright fragments cyan under an authored green mean.
    vec3 lower_headroom=base/max(source_mean,vec3(0.0001));
    vec3 upper_headroom=(vec3(1.0)-base)/max(vec3(1.0)-source_mean,vec3(0.0001));
    float contrast=0.82*clamp(min(min(min(lower_headroom.x,lower_headroom.y),lower_headroom.z),min(min(upper_headroom.x,upper_headroom.y),upper_headroom.z)),0.0,1.0);
    vec3 ground=base+ah.rgb*contrast;
    ground=mix(ground,base,smoothstep(source_spacing_m*0.5,source_spacing_m*2.0,footprint));
    float macro_band=1.0-smoothstep(2.0,12.0,footprint);
    ground+=(macro-0.5)*0.18*macro_band*min(base,vec3(1.0)-base);
    float wet=clamp(state.g,0.0,1.0);
    ground*=1.0-wet*0.28;
    ground=mix(ground,canopy_linear_albedo,surface_canopy_residual(v_vertex.xz,canopy_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),state.r));
    ground=mix(ground,vec3(0.79,0.83,0.87),state.b);
    ALBEDO=display_color(clamp(ground,vec3(0.0),vec3(0.95)));
    float base_roughness=clamp(mix(mean_palette.a,nr.a,0.7)-wet*0.28+state.b*0.05,0.12,1.0);
    float normal_length=clamp(length(nr.xyz*2.0-1.0),0.05,1.0);
    float normal_variance=(1.0-normal_length)/normal_length;
    ROUGHNESS=sqrt(clamp(base_roughness*base_roughness+normal_variance*micro_strength*micro_strength,0.0144,1.0));
    NORMAL_MAP=mix(vec3(0.5,0.5,1.0),nr.xyz,fine*micro_strength*(1.0-state.b));
    NORMAL_MAP_DEPTH=0.75;
    AO=1.0;
    if(presentation_mode==1) {
        vec3 light_direction=normalize(vec3(-0.5,1.0,-0.5));
        float relief=mix(1.0,clamp(dot(w_normal,light_direction)/light_direction.y,0.55,1.15),clamp(map_relief_shade,0.0,1.0));
        vec3 mapped=mix(map_mean,canopy_linear_albedo,surface_canopy_residual(v_vertex.xz,canopy_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),state.r));
        ALBEDO=vec3(0.0);
        EMISSION=display_color(mapped*relief);
        NORMAL_MAP=vec3(0.5,0.5,1.0);
        ROUGHNESS=1.0;
        SPECULAR=0.0;
    }
    if(diagnostic==1) ALBEDO=display_color(base);
    if(diagnostic==2) ALBEDO=vec3(state.r,state.a,state.g);
    if(diagnostic==3) { float b=texture(surface_bedrock,source_uv).r; ALBEDO=vec3(fract(b*0.618),fract(b*0.371+0.2),fract(b*0.217+0.4)); }
    if(diagnostic==4) ALBEDO=vec3(state.b,wet,1.0-wet);
    if(diagnostic==5) { ALBEDO=vec3(0.0); EMISSION=normalize(w_normal)*0.5+0.5; NORMAL_MAP=vec3(0.5,0.5,1.0); }

