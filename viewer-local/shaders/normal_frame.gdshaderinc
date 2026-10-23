// NormalGL +green points against image V in Godot's XZ surface frame.
// If UV'=R*UV, the corresponding tangent-normal transform is R, not R^T.
vec2 surface_rotated_normal(vec2 tangent_normal, mat2 uv_rotation) {
    return uv_rotation*tangent_normal;
}
