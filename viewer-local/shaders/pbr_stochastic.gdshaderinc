float surface_hash(vec2 p) {
    uvec2 q=uvec2(ivec2(p));
    uint h=q.x*1664525u+q.y*1013904223u+374761393u;
    h=(h^(h>>16u))*2246822519u;
    h=(h^(h>>13u))*3266489917u;
    h=h^(h>>16u);
    return float(h&0x00ffffffu)/16777216.0;
}
mat2 surface_rotation(float a) { return mat2(vec2(cos(a),sin(a)),vec2(-sin(a),cos(a))); }
float surface_noise(vec2 p, vec2 cell_origin) {
    vec2 c=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
    c+=cell_origin;
    return mix(mix(surface_hash(c),surface_hash(c+vec2(1,0)),f.x),mix(surface_hash(c+vec2(0,1)),surface_hash(c+vec2(1,1)),f.x),f.y);
}
// Triangle lattice stochastic tiling: same coordinates, transform and weights for ALL maps.
void sample_pbr(vec2 p, vec2 dx, vec2 dy, int layer, vec2 phase, vec4 lattice_origin, out vec4 ah, out vec4 nr) {
    vec2 skew = mat2(vec2(1.0,0.0),vec2(-0.577350269,1.154700538))*p+lattice_origin.xy;
    vec2 cell = floor(skew);
    vec2 f = fract(skew);
    vec3 w;
    vec2 cells[3];
    if(f.x+f.y<1.0) {
        w=vec3(1.0-f.x-f.y,f.x,f.y);
        cells[0]=cell; cells[1]=cell+vec2(1,0); cells[2]=cell+vec2(0,1);
    } else {
        w=vec3(f.x+f.y-1.0,1.0-f.x,1.0-f.y);
        cells[0]=cell+vec2(1,1); cells[1]=cell+vec2(0,1); cells[2]=cell+vec2(1,0);
    }
    vec4 a[3]; vec4 n[3];
    for(int i=0;i<3;i++) {
        vec2 canonical_cell=cells[i]+lattice_origin.zw;
        float h=surface_hash(canonical_cell);
        mat2 r=surface_rotation(floor(h*4.0)*1.570796327);
        vec2 uv=r*(p+phase)+vec2(h,surface_hash(canonical_cell+vec2(72,31)))*19.0;
        a[i]=textureGrad(pbr_albedo_height,vec3(uv,float(layer)),r*dx,r*dy);
        n[i]=textureGrad(pbr_normal_rough,vec3(uv,float(layer)),r*dx,r*dy);
        vec2 tangent_normal=surface_rotated_normal(n[i].xy*2.0-1.0,r);
        n[i].xy=tangent_normal*0.5+0.5;
    }
    // Identical linear weights preserve the registered maps and their means.
    // Height-dependent stochastic weights bias colour when height correlates
    // with albedo; use height for physical support, not a camera-dependent tint.
    ah=a[0]*w.x+a[1]*w.y+a[2]*w.z;
    ah.rgb-=layer_mean[layer].rgb;
    nr=n[0]*w.x+n[1]*w.y+n[2]*w.z;
}

