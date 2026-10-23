// SurfaceWorld data. Values are linear; categorical texture uses nearest filtering.
uniform sampler2D surface_ids : filter_nearest, repeat_disable;
uniform sampler2D surface_state : filter_linear_mipmap, repeat_disable;
uniform sampler2D surface_bedrock : filter_nearest, repeat_disable;
uniform vec2 source_origin;
uniform vec2 source_extent;
uniform vec2 world_phase;
uniform vec2 material_phase[32];
uniform vec4 palette[32];
uniform float material_scales[32];
uniform int material_layers[32];
uniform sampler2DArray pbr_albedo_height : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray pbr_normal_rough : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform int diagnostic = 0;
uniform float micro_strength = 0.55;
uniform float instance_blend_distance = 180.0;
uniform vec4 candidate_bounds = vec4(-1e8,-1e8,1e8,1e8);

float surface_hash(vec2 p) {
    p = mod(p, vec2(4096.0));
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
mat2 surface_rotation(float a) { return mat2(vec2(cos(a),sin(a)),vec2(-sin(a),cos(a))); }
float surface_noise(vec2 p) {
    vec2 c=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(surface_hash(c),surface_hash(c+vec2(1,0)),f.x),mix(surface_hash(c+vec2(0,1)),surface_hash(c+vec2(1,1)),f.x),f.y);
}
// Triangle lattice stochastic tiling: same coordinates, transform and weights for ALL maps.
void sample_pbr(vec2 p, vec2 dx, vec2 dy, int layer, out vec4 ah, out vec4 nr) {
    vec2 skew = mat2(vec2(1.0,0.0),vec2(-0.577350269,1.154700538))*p;
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
        float h=surface_hash(cells[i]);
        mat2 r=surface_rotation(floor(h*4.0)*1.570796327);
        vec2 uv=r*p+vec2(h,surface_hash(cells[i]+vec2(72.4,31.6)))*19.0;
        a[i]=textureGrad(pbr_albedo_height,vec3(uv,float(layer)),r*dx,r*dy);
        n[i]=textureGrad(pbr_normal_rough,vec3(uv,float(layer)),r*dx,r*dy);
        vec2 tangent_normal=transpose(r)*(n[i].xy*2.0-1.0);
        n[i].xy=tangent_normal*0.5+0.5;
    }
    // Height informed transitions; bounded weights retain the original mean at coarse mips.
    vec3 hw=w*exp(vec3(a[0].a,a[1].a,a[2].a)*0.8);
    hw/=max(dot(hw,vec3(1.0)),0.0001);
    ah=a[0]*hw.x+a[1]*hw.y+a[2]*hw.z;
    nr=n[0]*hw.x+n[1]*hw.y+n[2]*hw.z;
}
