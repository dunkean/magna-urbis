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
    ivec2 response_pair;float response_blend;vec3 response_mean;
    bool response_active=ground_response_sample(source_uv,response_pair,response_blend,response_mean);
    if(response_active) {
        for(int i=0;i<8;i++){ids[i]=response_pair.x;slot_weights[i]=0.0;}
        ids[1]=response_pair.y;slot_weights[0]=1.0-response_blend;slot_weights[1]=response_blend;
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
    vec3 base=response_active?response_mean:texture(surface_average,source_uv).rgb;
    vec3 raw_ground_mean=base;
    float detail_exposure; vec3 detail_color; float detail_slope; float detail_confidence;
    surface_geometry_detail(v_vertex.xz,base,detail_exposure,detail_color,detail_slope,detail_confidence);
    // Refinement changes physical support, never the canonical environment or city style.
    // All derivatives above remain unconditional; the optional source patch has no camera threshold.
    if(presentation_mode==0 && detail_exposure>0.00001) {
        int rock_id=clamp(detail_bedrock_recipe,0,31);
        vec4 rock_ah; vec4 rock_nr;
        sample_surface_material(v_vertex,surface_dx,surface_dy,w_normal,w_tangent,w_binormal,rock_id,rock_ah,rock_nr);
        ah=mix(ah,rock_ah,detail_exposure);
        nr=mix(nr,rock_nr,detail_exposure);
        mean_palette=mix(mean_palette,palette[rock_id],detail_exposure);
        source_mean=mix(source_mean,layer_mean[material_layers[rock_id]].rgb,detail_exposure);
        fine=mix(fine,1.0-smoothstep(material_scales[rock_id]*0.2,material_scales[rock_id]*1.5,footprint),detail_exposure);
        base=mix(base,detail_color,detail_exposure);
    }
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

    ground=mix(ground,vec3(0.79,0.83,0.87),state.b);

    float base_roughness=clamp(mix(mean_palette.a,nr.a,0.7)-wet*0.28+state.b*0.05,0.12,1.0);
    float normal_length=clamp(length(nr.xyz*2.0-1.0),0.05,1.0);
    float normal_variance=(1.0-normal_length)/normal_length;
    ROUGHNESS=sqrt(clamp(base_roughness*base_roughness+normal_variance*micro_strength*micro_strength,0.0144,1.0));
    vec3 composed_normal=mix(vec3(0.5,0.5,1.0),nr.xyz,fine*micro_strength*(1.0-state.b));
    float ground_roughness=ROUGHNESS; vec3 ground_normal=composed_normal;
    // Sol and low cover remain independently available underneath the crowns.
    // Alpha is applied to the four texels BEFORE categorical material weights.
    vec4 low_premul=surface_layers_explicit ? texture(low_cover_average,source_uv) : vec4(0.0);
    float low_alpha=clamp(low_premul.a,0.0,1.0);
    vec3 low_base=low_premul.rgb/max(low_alpha,0.000001);
    vec4 low_ah=vec4(0.0); vec4 low_nr=vec4(0.0); vec4 low_palette=vec4(0.0);
    vec3 low_source_mean=vec3(0.0); vec3 low_map_mean=vec3(0.0); float low_fine=0.0;
    float low_weight_sum=0.0;
    if(surface_layers_explicit) {
        vec4 low_slots[4];
        low_slots[0]=texelFetch(low_cover_ids,cell,0);
        low_slots[1]=texelFetch(low_cover_ids,cell+ivec2(1,0),0);
        low_slots[2]=texelFetch(low_cover_ids,cell+ivec2(0,1),0);
        low_slots[3]=texelFetch(low_cover_ids,cell+ivec2(1,1),0);
        int low_ids[8];float low_weights[8];
        for(int i=0;i<4;i++) {
            float coverage_weight=surface_weights[i]*clamp(low_slots[i].a,0.0,1.0);
            low_ids[i*2]=clamp(int(low_slots[i].r+0.5),0,31);low_ids[i*2+1]=clamp(int(low_slots[i].g+0.5),0,31);
            low_weights[i*2]=coverage_weight*(1.0-low_slots[i].b);low_weights[i*2+1]=coverage_weight*low_slots[i].b;
        }
        for(int i=0;i<8;i++) {
            bool first=true;
            for(int j=0;j<i;j++)if(low_ids[j]==low_ids[i])first=false;
            if(!first)continue;
            int id=low_ids[i];float weight=0.0;
            for(int j=0;j<8;j++)if(low_ids[j]==id)weight+=low_weights[j];
            if(weight<=0.000001)continue;
            vec4 a;vec4 n;
            if(presentation_mode==0) sample_surface_material(v_vertex,surface_dx,surface_dy,w_normal,w_tangent,w_binormal,id,a,n);
            else { a=vec4(0.0);n=vec4(0.5,0.5,1.0,1.0); }
            low_ah+=a*weight;low_nr+=n*weight;low_palette+=palette[id]*weight;
            low_source_mean+=layer_mean[material_layers[id]].rgb*weight;
            low_map_mean+=map_palette[id].rgb*weight;
            low_fine+=(1.0-smoothstep(material_scales[id]*0.2,material_scales[id]*1.5,footprint))*weight;
            low_weight_sum+=weight;
        }
    }
    float safe_low_weight=max(low_weight_sum,0.000001);
    low_ah/=safe_low_weight;low_nr/=safe_low_weight;low_palette/=safe_low_weight;
    low_source_mean/=safe_low_weight;low_map_mean/=safe_low_weight;low_fine/=safe_low_weight;
    vec3 low_lower=low_base/max(low_source_mean,vec3(0.0001));
    vec3 low_upper=(vec3(1.0)-low_base)/max(vec3(1.0)-low_source_mean,vec3(0.0001));
    float low_contrast=0.82*clamp(min(min(min(low_lower.x,low_lower.y),low_lower.z),min(min(low_upper.x,low_upper.y),low_upper.z)),0.0,1.0);
    vec3 low_response=(low_base+low_ah.rgb*low_contrast)*(1.0-wet*0.28);
    float low_rough=clamp(mix(low_palette.a,low_nr.a,0.7)-wet*0.28,0.12,1.0);
    vec3 low_normal=mix(vec3(0.5,0.5,1.0),low_nr.xyz,low_fine*micro_strength);
    float visible_low=(show_low_cover && surface_layers_explicit)?low_alpha:0.0;
    if(!show_ground) { ground=vec3(0.0); composed_normal=vec3(0.5,0.5,1.0); ROUGHNESS=1.0; }
    ground=mix(ground,low_response,visible_low);
    ROUGHNESS=sqrt(mix(ROUGHNESS*ROUGHNESS,low_rough*low_rough,visible_low));
    composed_normal=mix(composed_normal,low_normal,visible_low);
    float crown_mask=show_trees?surface_canopy_residual(v_vertex.xz,canopy_main_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),state.r):0.0;
    // Mapper policy: the full optical canopy casts the same approximate shadow
    // inside and outside the inventory page. Tree geometry never casts engine
    // shadows; terrain and buildings retain their physical shadow settings.
    float canopy_shadow=(show_trees && presentation_mode==0)?(canopy_shadow_use_total?surface_canopy_target(v_vertex.xz-canopy_shadow_offset,canopy_main_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),texture(surface_state,source_uv-canopy_shadow_offset/source_spacing_m/source_grid_size).r):surface_canopy_residual(v_vertex.xz-canopy_shadow_offset,canopy_main_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),texture(surface_state,source_uv-canopy_shadow_offset/source_spacing_m/source_grid_size).r)):0.0;
    ground*=mix(vec3(1.0),canopy_shadow_transmittance,canopy_shadow);
    ground=mix(ground,canopy_linear_albedo,crown_mask);
    if(presentation_mode==0 && crown_mask>.00001) {
        vec3 canopy_normal=surface_canopy_normal(v_vertex.xz,canopy_main_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),state.r);
        vec3 tangent_canopy=normalize(vec3(dot(canopy_normal,w_tangent),dot(canopy_normal,w_binormal),dot(canopy_normal,w_normal)));
        composed_normal=mix(composed_normal,tangent_canopy*.5+.5,crown_mask);
        ROUGHNESS=mix(ROUGHNESS,.9,crown_mask);
    }
    ALBEDO=display_color(clamp(ground,vec3(0.0),vec3(0.95)));
    NORMAL_MAP=composed_normal;
    NORMAL_MAP_DEPTH=mix(.75,1.0,crown_mask);
    AO=1.0;
    if(presentation_mode==1) {
        vec3 light_direction=normalize(vec3(-0.5,1.0,-0.5));
        float relief=mix(1.0,clamp(dot(w_normal,light_direction)/light_direction.y,0.55,1.15),clamp(map_relief_shade,0.0,1.0));
        vec3 mapped=show_ground?map_mean:vec3(0.0);
        mapped=mix(mapped,low_map_mean,visible_low);
        mapped=mix(mapped,canopy_linear_albedo,crown_mask);
        ALBEDO=display_color(mapped*relief);
        EMISSION=vec3(0.0);
        NORMAL_MAP=vec3(0.5,0.5,1.0);
        ROUGHNESS=1.0;
        SPECULAR=0.0;
    }
    if(diagnostic==1) ALBEDO=display_color(base);
    if(diagnostic==2) ALBEDO=vec3(state.r,state.a,state.g);
    if(diagnostic==3) { float b=texture(surface_bedrock,source_uv).r; ALBEDO=vec3(fract(b*0.618),fract(b*0.371+0.2),fract(b*0.217+0.4)); }
    if(diagnostic==4) ALBEDO=vec3(state.b,wet,1.0-wet);
    if(diagnostic==5) { ALBEDO=vec3(0.0); EMISSION=normalize(w_normal)*0.5+0.5; NORMAL_MAP=vec3(0.5,0.5,1.0); }

    if(diagnostic==6) { ALBEDO=vec3(0.0); EMISSION=display_color(vec3(clamp(detail_slope/1.570796327,0.0,1.0),detail_exposure,detail_confidence)); NORMAL_MAP=vec3(0.5,0.5,1.0); }

    // Single-variable unlit probes isolate fields from illumination and normals.
    if(diagnostic>=7 && diagnostic<=20) {
        vec3 probe=raw_ground_mean;
        if(diagnostic==8) probe=vec3(low_alpha);
        if(diagnostic==9) probe=vec3(state.r);
        if(diagnostic==10) probe=normalize(w_normal)*0.5+0.5;
        if(diagnostic==11) probe=low_base;
        if(diagnostic==12) probe=vec3(crown_mask);
        if(diagnostic==13) probe=vec3(ground_roughness);
        if(diagnostic==14) probe=ground_normal;
        if(diagnostic==15) probe=vec3(detail_exposure);
        if(diagnostic==16) probe=detail_color;
        if(diagnostic==17) probe=mix(show_ground?raw_ground_mean:vec3(0.0),low_base,visible_low);
        if(diagnostic==18) probe=vec3(ROUGHNESS);
        if(diagnostic==19) probe=composed_normal;
        if(diagnostic==20) probe=vec3(show_trees?surface_canopy_target(v_vertex.xz,canopy_main_pixel_footprint(v_vertex.xz,PROJECTION_MATRIX*VIEW_MATRIX,VIEWPORT_SIZE),state.r):0.0);
        ALBEDO=vec3(0.0); EMISSION=display_color(probe); ROUGHNESS=1.0; SPECULAR=0.0; NORMAL_MAP=vec3(0.5,0.5,1.0);
    }

    // Evaluate all derivatives first. No fragment outside the real source union
    // is displayed, even though tessellation needs edge-clamped support there.
    if(!surface_source_contains(v_vertex.xz)) discard;
