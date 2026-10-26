#version 450
// Generated syntax/binding translation; original shader maths and orientation retained.
layout(set = 0, binding = 1) uniform sampler2D uLayer;

layout(location = 0) out vec4 outColor;
void main() { outColor = texelFetch(uLayer, ivec2(gl_FragCoord.xy), 0); }