// SurfaceWorld data. Values are linear; categorical texture uses nearest filtering.
uniform sampler2D surface_ids : filter_nearest, repeat_disable;
uniform sampler2D surface_state : filter_linear_mipmap, repeat_disable;
uniform sampler2D surface_bedrock : filter_nearest, repeat_disable;
uniform sampler2D surface_average : filter_linear_mipmap, repeat_disable;
uniform vec2 source_origin;
uniform vec2 source_extent;
uniform vec2 world_phase;
uniform vec2 material_phase[32];
uniform float material_phase_y[32];
uniform vec4 material_lattice_xz[32];
uniform vec4 material_lattice_zy[32];
uniform vec4 material_lattice_xy[32];
uniform vec4 noise_phase_16;
uniform vec4 noise_phase_9;
uniform vec4 layer_mean[32];
uniform vec4 palette[32];
uniform float material_scales[32];
uniform int material_layers[32];
uniform sampler2DArray pbr_albedo_height : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray pbr_normal_rough : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform int diagnostic = 0;
uniform float micro_strength = 0.55;
uniform float instance_blend_distance = 180.0;
uniform vec4 candidate_bounds = vec4(-1e8,-1e8,1e8,1e8);
uniform float source_spacing_m = 15.0;
uniform vec2 source_grid_size;

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
        vec2 tangent_normal=transpose(r)*(n[i].xy*2.0-1.0);
        n[i].xy=tangent_normal*0.5+0.5;
    }
    // Height informed transitions; bounded weights retain the original mean at coarse mips.
    vec3 hw=w*exp(vec3(a[0].a,a[1].a,a[2].a)*0.8);
    hw/=max(dot(hw,vec3(1.0)),0.0001);
    ah=a[0]*hw.x+a[1]*hw.y+a[2]*hw.z;
    ah.rgb/=max(layer_mean[layer].rgb,vec3(0.0001));
    nr=n[0]*hw.x+n[1]*hw.y+n[2]*hw.z;
}

void sample_surface_material(vec3 p, vec3 normal, vec3 tangent, vec3 binormal, int id, out vec4 ah, out vec4 nr) {
    float scale=max(material_scales[id],0.25);
    int layer=material_layers[id];
    vec2 phase=material_phase[id];
    float yphase=material_phase_y[id];
    vec2 uv=p.xz/scale;
    sample_pbr(uv,dFdx(uv),dFdy(uv),layer,phase,material_lattice_xz[id],ah,nr);
    if(abs(normal.y)<0.85) {
        vec2 uv_x=p.zy/scale;
        vec2 uv_z=p.xy/scale;
        vec4 ax; vec4 nx; vec4 az; vec4 nz;
        sample_pbr(uv_x,dFdx(uv_x),dFdy(uv_x),layer,vec2(phase.y,yphase),material_lattice_zy[id],ax,nx);
        sample_pbr(uv_z,dFdx(uv_z),dFdy(uv_z),layer,vec2(phase.x,yphase),material_lattice_xy[id],az,nz);
        vec3 weights=pow(abs(normal),vec3(6.0));
        weights/=max(dot(weights,vec3(1.0)),0.0001);
        vec3 n0=nr.xyz*2.0-1.0;
        vec3 n1=nx.xyz*2.0-1.0;
        vec3 n2=nz.xyz*2.0-1.0;
        vec3 perturb=vec3(n0.x,n0.z-1.0,-n0.y)*weights.y
            +vec3((n1.z-1.0)*sign(normal.x),-n1.y,n1.x)*weights.x
            +vec3(n2.x,-n2.y,(n2.z-1.0)*sign(normal.z))*weights.z;
        vec3 tangent_normal=normalize(vec3(dot(perturb,tangent),dot(perturb,binormal),1.0+dot(perturb,normal)));
        float rough=nr.a*weights.y+nx.a*weights.x+nz.a*weights.z;
        nr=vec4(tangent_normal*0.5+0.5,rough);
        ah=ah*weights.y+ax*weights.x+az*weights.z;
    }
}
