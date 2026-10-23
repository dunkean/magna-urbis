// Shader vectors are linear values. Compatibility writes display sRGB while
// Forward+/Mobile keep linear HDR until the viewport's presentation transform.
vec3 display_color(vec3 linear_color) {
    if(OUTPUT_IS_SRGB) return mix(linear_color*12.92,1.055*pow(max(linear_color,vec3(0.0)),vec3(1.0/2.4))-0.055,step(vec3(0.0031308),linear_color));
    return linear_color;
}
