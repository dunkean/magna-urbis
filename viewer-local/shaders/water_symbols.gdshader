shader_type canvas_item;
render_mode unshaded, blend_disabled;
uniform sampler2D source_map : filter_nearest, repeat_disable;
uniform float radius_texels=0.625;
void fragment(){
    ivec2 dimensions=textureSize(source_map,0);
    ivec2 point=ivec2(floor(UV*vec2(dimensions)));
    vec4 chosen=vec4(0.0);
    float alpha=0.0,best_score=0.0;
    // Finite AA disk; texelFetch prevents an undeclared extra bilinear dilation.
    for(int y=-4;y<=4;y++)for(int x=-4;x<=4;x++){
        float weight=clamp(radius_texels+0.5-length(vec2(float(x),float(y))),0.0,1.0);
        if(weight<=0.0)continue;
        ivec2 at=point+ivec2(x,y);
        if(any(lessThan(at,ivec2(0)))||any(greaterThanEqual(at,dimensions)))continue;
        vec4 source=texelFetch(source_map,at,0);
        if(source.a<=0.001)continue;
        alpha=max(alpha,weight);
        float score=source.a*weight;
        if(score>best_score){chosen=source;best_score=score;}
    }
    COLOR=vec4(chosen.rgb,alpha);
}
