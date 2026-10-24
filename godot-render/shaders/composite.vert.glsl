#version 450
// Generated syntax/binding translation; original shader maths and orientation retained.


void main() { vec2 p = vec2(gl_VertexIndex & 1, gl_VertexIndex >> 1) * 2.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }