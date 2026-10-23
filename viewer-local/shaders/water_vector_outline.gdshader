shader_type canvas_item;
render_mode unshaded;
// Explicit display-space RGBA. Line2D supplies AA vertex alpha; no class or
// physical level is inferred from this single declared cartographic tint.
uniform vec4 stroke_rgba=vec4(0.183,0.349,0.373,1.0);
void fragment(){COLOR=vec4(stroke_rgba.rgb,COLOR.a*stroke_rgba.a);}
