#include "res://shaders/color_space.gdshaderinc"
#include "res://shaders/normal_frame.gdshaderinc"
#include "res://shaders/canopy.gdshaderinc"
#include "res://shaders/geometry_detail.gdshaderinc"
// SurfaceWorld data. Values are linear; categorical texture uses nearest filtering.
uniform sampler2D surface_ids : filter_nearest, repeat_disable;
uniform sampler2D surface_state : filter_linear_mipmap, repeat_disable;
uniform sampler2D surface_bedrock : filter_nearest, repeat_disable;
uniform sampler2D surface_average : filter_linear_mipmap, repeat_disable;
uniform vec2 source_origin;
uniform vec2 source_extent;
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
// RGB is linear half-float; alpha is normalized physical height. Mips are linear too.
uniform sampler2DArray pbr_albedo_height : filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray pbr_normal_rough : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform int diagnostic = 0;
uniform float micro_strength = 0.55;
uniform vec4 candidate_bounds = vec4(-1e8,-1e8,1e8,1e8);
uniform float source_spacing_m = 15.0;
uniform vec2 source_grid_size;
uniform int presentation_mode = 0;
uniform vec4 map_palette[32];
uniform float map_relief_shade = 0.0;


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

void sample_surface_material(vec3 p, vec3 dx, vec3 dy, vec3 normal, vec3 tangent, vec3 binormal, int id, out vec4 ah, out vec4 nr) {
    float scale=max(material_scales[id],0.25);
    int layer=material_layers[id];
    vec2 phase=material_phase[id];
    float yphase=material_phase_y[id];
    vec2 uv=p.xz/scale;
    sample_pbr(uv,dx.xz/scale,dy.xz/scale,layer,phase,material_lattice_xz[id],ah,nr);
    if(abs(normal.y)<0.9999) {
        vec2 uv_x=vec2(p.z,-p.y)/scale;
        vec2 uv_z=vec2(p.x,-p.y)/scale;
        vec4 ax; vec4 nx; vec4 az; vec4 nz;
        sample_pbr(uv_x,vec2(dx.z,-dx.y)/scale,vec2(dy.z,-dy.y)/scale,layer,vec2(phase.y,yphase),material_lattice_zy[id],ax,nx);
        sample_pbr(uv_z,vec2(dx.x,-dx.y)/scale,vec2(dy.x,-dy.y)/scale,layer,vec2(phase.x,yphase),material_lattice_xy[id],az,nz);
        vec3 weights=pow(abs(normal),vec3(6.0));
        weights/=max(dot(weights,vec3(1.0)),0.0001);
        vec3 n0=nr.xyz*2.0-1.0;
        vec3 n1=nx.xyz*2.0-1.0;
        vec3 n2=nz.xyz*2.0-1.0;
        vec3 perturb=vec3(n0.x,n0.z-1.0,-n0.y)*weights.y
            +vec3((n1.z-1.0)*sign(normal.x),n1.y,n1.x)*weights.x
            +vec3(n2.x,n2.y,(n2.z-1.0)*sign(normal.z))*weights.z;
        vec3 tangent_normal=normalize(vec3(dot(perturb,tangent),dot(perturb,binormal),1.0+dot(perturb,normal)));
        float rough=nr.a*weights.y+nx.a*weights.x+nz.a*weights.z;
        nr=vec4(tangent_normal*0.5+0.5,rough);
        ah=ah*weights.y+ax*weights.x+az*weights.z;
    }
}
