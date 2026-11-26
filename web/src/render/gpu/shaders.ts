/**
 * GLSL sources of the WebGL2 vector rasterizer, one program per kind of draw (program.ts links them, replay.ts uses them).
 * One cohesive unit of shader text: the shared vertex helpers, fan (stencil winding), cover (paint), stroke (segment,
 * disc and join instances), sprite (instanced images), clear and baked (a baked band texture of the live overlay).
 */
const COMMON_VS = `
precision highp float;
uniform vec2 uViewport;
uniform mat3 uMatrix, uInverse;
vec2 device(vec2 p) { return (uMatrix * vec3(p, 1.0)).xy; }
vec4 position(vec2 p) { return vec4(p / uViewport * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0); }
vec2 corner(int i) { return vec2(float(i & 1), float(i >> 1)); }
`;
const FAN_VS = `#version 300 es
${COMMON_VS}
layout(location=0) in vec2 aPoint;
void main() { gl_Position = position(device(aPoint)); }
`;
const EMPTY_FS = `#version 300 es
precision highp float;
out vec4 outColor;
void main() { outColor = vec4(0.0); }
`;
const COVER_VS = `#version 300 es
${COMMON_VS}
uniform vec4 uBox;
uniform vec4 uRect;
uniform int uRectMode;
out vec2 vUser;
void main() {
  vec2 p = uRectMode == 0 ? mix(uBox.xy, uBox.zw, corner(gl_VertexID)) : device(uRect.xy + corner(gl_VertexID) * uRect.zw);
  vUser = (uInverse * vec3(p, 1.0)).xy;
  gl_Position = position(p);
}
`;
const PAINT_FS = `
uniform int uPattern;
uniform sampler2D uImage;
uniform mat3 uPatternInverse;
uniform vec2 uImageSize;
uniform ivec2 uRepeat;
uniform vec4 uColor;
uniform float uAlpha;
// Stripes (uPattern 2, replay.ts stripe): across = dot(uStripe.xy, device pixel) + uStripe.w in user units, lines where
// across is a multiple of the period uStripe.z; uStripeLine = half line width, pixel footprint (user units).
uniform vec4 uStripe;
uniform vec2 uStripeLine;
uniform vec2 uViewport;
in vec2 vUser;
// Share of the pixel footprint covered by a line at distance d (box filter): sub-pixel lines fade by their width,
// as Canvas hairlines do.
float lineCover(float d) {
  float h = uStripeLine.x, f = uStripeLine.y * .5;
  return max(0.0, min(d + f, h) - max(d - f, -h)) / uStripeLine.y;
}
vec4 paint() {
  if (uPattern == 0) return vec4(uColor.rgb * uColor.a, uColor.a) * uAlpha;
  if (uPattern == 2) {
    float q = mod(dot(uStripe.xy, vec2(gl_FragCoord.x, uViewport.y - gl_FragCoord.y)) + uStripe.w, uStripe.z), d = min(q, uStripe.z - q);
    return vec4(uColor.rgb * uColor.a, uColor.a) * (uAlpha * min(1.0, lineCover(d) + lineCover(uStripe.z - d)));
  }
  vec2 uv = (uPatternInverse * vec3(vUser, 1.0)).xy / uImageSize;
  // Gradients of the unwrapped coordinates: the mip level stays continuous across the fract() seam.
  vec2 gx = dFdx(uv), gy = dFdy(uv);
  if ((uRepeat.x == 0 && (uv.x < 0.0 || uv.x >= 1.0)) || (uRepeat.y == 0 && (uv.y < 0.0 || uv.y >= 1.0))) return vec4(0.0);
  if (uRepeat.x != 0) uv.x = fract(uv.x);
  if (uRepeat.y != 0) uv.y = fract(uv.y);
  return textureGrad(uImage, uv, gx, gy) * uAlpha;
}
`;
const COVER_FS = `#version 300 es
precision highp float;
${PAINT_FS}
out vec4 outColor;
void main() { outColor = paint(); }
`;

// Segment, disc and wedge instances share a program and one arena buffer layout.
const STROKE_VS = `#version 300 es
${COMMON_VS}
layout(location=0) in vec4 aData;
layout(location=1) in vec4 aMore;
uniform int uKind, uCap, uDashCount;
uniform float uWidth, uMiterLimit;
out vec2 vUser, vLocal;
flat out float vLength, vUnits, vAlong;
flat out int vFlags, vKind;
void main() {
  float r = uWidth * .5;
  vec2 p;
  vKind = uKind; vFlags = 0; vLength = 0.0; vUnits = 1.0; vAlong = 0.0; vLocal = vec2(0.0);
  if (uKind == 0) {
    vec2 a = device(aData.xy), b = device(aData.zw), d = b - a;
    float len = length(d);
    vec2 t = len > 1e-12 ? d / len : vec2(1.0, 0.0), n = vec2(-t.y, t.x);
    vFlags = int(aMore.y); vAlong = aMore.x; vLength = len;
    vUnits = len > 1e-12 ? length(aData.zw - aData.xy) / len : 1.0;
    float left = uCap != 0 && ((vFlags & 1) != 0 || uDashCount > 0) ? r : 0.0;
    float right = uCap != 0 && ((vFlags & 2) != 0 || uDashCount > 0) ? r : 0.0;
    vLocal = vec2(mix(-left, len + right, corner(gl_VertexID).x), mix(-r, r, corner(gl_VertexID).y));
    p = a + t * vLocal.x + n * vLocal.y;
  } else if (uKind == 1) {
    vAlong = aData.z; vFlags = int(aData.w);
    vLocal = (corner(gl_VertexID) * 2.0 - 1.0) * r;
    p = device(aData.xy) + vLocal;
  } else {
    vec2 a = device(aData.xy), b = device(aData.zw), c = device(aMore.xy);
    vec2 u = normalize(b - a), v = normalize(c - b);
    float turn = u.x * v.y - u.y * v.x, side = turn > 0.0 ? -1.0 : 1.0;
    vec2 n1 = vec2(-u.y, u.x) * side, n2 = vec2(-v.y, v.x) * side;
    float den = 1.0 + dot(n1, n2);
    vec2 m = (n1 + n2) / max(den, 1e-12);
    bool miter = aMore.w > 1.5 && den > 1e-8 && length(m) <= uMiterLimit;
    int k = gl_VertexID;
    vec2 offset = vec2(0.0);
    if (miter) {
      if (k == 1) offset = n1;
      if (k == 2 || k == 4) offset = m;
      if (k == 5) offset = n2;
    } else {
      if (k == 1) offset = n1;
      if (k == 2) offset = n2;
    }
    p = b + offset * r; vAlong = aMore.z;
  }
  vUser = (uInverse * vec3(p, 1.0)).xy;
  gl_Position = position(p);
}
`;
const STROKE_FS = `#version 300 es
precision highp float;
precision highp int;
${PAINT_FS}
in vec2 vLocal;
flat in float vLength, vUnits, vAlong;
flat in int vFlags, vKind;
uniform float uWidth, uDash[16], uDashTotal, uDashOffset;
uniform int uDashCount, uCap;
out vec4 outColor;
bool dashOn(float along, bool interior) {
  if (uDashCount == 0 || uDashTotal <= 0.0) return true;
  float q = mod(along + uDashOffset, uDashTotal), edge = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uDashCount) break;
    float end = edge + uDash[i];
    if (q < end) return (i & 1) == 0 && (!interior || q > edge);
    edge = end;
  }
  return false;
}
bool interval(float lo, float hi, bool capStart, bool capEnd, float along, float across, float units) {
  float d = max(lo - along, along - hi) / max(units, 1e-12);
  if (d <= 0.0) return true;
  if (uCap == 0 || (along < lo ? !capStart : !capEnd)) return false;
  float r = uWidth * .5;
  return uCap == 1 ? d * d + across * across <= r * r : d <= r;
}
bool segment(float s, float across) {
  float a = vAlong, b = a + vLength * vUnits, along = a + s * vUnits;
  if ((vFlags & 8) != 0) return dashOn(a, false);
  if (uDashCount == 0 || uDashTotal <= 0.0) return interval(a, b, (vFlags & 1) != 0, (vFlags & 2) != 0, along, across, vUnits);
  // Intersect painted intervals with this segment before capping them. This prevents
  // a dash beyond an open subpath endpoint from bleeding back into the stroke.
  float cycle = floor((clamp(along, a, b) + uDashOffset) / uDashTotal) * uDashTotal - uDashOffset;
  for (int k = -1; k <= 1; k++) {
    float edge = cycle + float(k) * uDashTotal;
    for (int i = 0; i < 16; i++) {
      if (i >= uDashCount) break;
      float end = edge + uDash[i];
      if ((i & 1) == 0) {
        float lo = max(a, edge), hi = min(b, end);
        bool left = edge >= a || (vFlags & 1) != 0, right = end <= b || (vFlags & 2) != 0;
        if (hi >= lo && (hi > lo || end == edge) && interval(lo, hi, left, right, along, across, vUnits)) return true;
      }
      edge = end;
    }
  }
  return false;
}
void main() {
  float r = uWidth * .5;
  vec4 color = paint(); // derivatives need uniform control flow: sample before discarding
  if (vKind == 0) {
    if (!segment(vLocal.x, abs(vLocal.y))) discard;
  } else {
    if (vKind == 1 && dot(vLocal, vLocal) > r * r) discard;
    if (!dashOn(vAlong, (vFlags & 8) == 0)) discard;
  }
  outColor = color;
}
`;
const SPRITE_VS = `#version 300 es
${COMMON_VS}
layout(location=0) in vec4 aSource;
layout(location=1) in vec4 aDest;
layout(location=2) in vec4 aLinear;
layout(location=3) in vec3 aTail;
uniform mat3 uPost;
uniform int uFull;
uniform vec2 uImageSize;
out vec2 vUV, vDestination;
flat out float vAlpha;
void main() {
  mat3 m = uPost * mat3(aLinear.xy, 0.0, aLinear.zw, 0.0, aTail.xy, 1.0);
  vec2 q = corner(gl_VertexID), p;
  if (uFull != 0) {
    p = q * uViewport;
    float d = determinant(m);
    q = abs(d) > 1e-20 ? ((inverse(m) * vec3(p, 1.0)).xy - aDest.xy) / aDest.zw : vec2(-1.0);
  } else p = (m * vec3(aDest.xy + q * aDest.zw, 1.0)).xy;
  vDestination = q; vUV = (aSource.xy + q * aSource.zw) / uImageSize;
  vAlpha = aTail.z; gl_Position = position(p);
}
`;
const SPRITE_FS = `#version 300 es
precision highp float;
uniform sampler2D uImage;
in vec2 vUV, vDestination;
flat in float vAlpha;
out vec4 outColor;
void main() {
  bool inside = all(greaterThanEqual(vDestination, vec2(0.0))) && all(lessThanEqual(vDestination, vec2(1.0))) && all(greaterThanEqual(vUV, vec2(0.0))) && all(lessThanEqual(vUV, vec2(1.0)));
  outColor = inside ? texture(uImage, vUV) * vAlpha : vec4(0.0);
}
`;
// A baked prefix: uBox is the texture's rectangle in recorded pixels, uMatrix the replay matrix of its band.
// Framebuffer rows are bottom-up, recorded pixels top-down: v is flipped.
const BAKED_VS = `#version 300 es
${COMMON_VS}
uniform vec4 uBox;
out vec2 vUV;
void main() {
  vec2 q = corner(gl_VertexID);
  vUV = vec2(q.x, 1.0 - q.y);
  gl_Position = position(device(mix(uBox.xy, uBox.zw, q)));
}
`;
const BAKED_FS = `#version 300 es
precision highp float;
uniform sampler2D uImage;
in vec2 vUV;
out vec4 outColor;
void main() { outColor = texture(uImage, vUV); }
`;
export type ProgramKind = 'fan' | 'cover' | 'stroke' | 'sprite' | 'clear' | 'baked';
export const SHADERS: Record<ProgramKind, readonly [string, string]> = { fan: [FAN_VS, EMPTY_FS], cover: [COVER_VS, COVER_FS], stroke: [STROKE_VS, STROKE_FS], sprite: [SPRITE_VS, SPRITE_FS], clear: [COVER_VS, EMPTY_FS], baked: [BAKED_VS, BAKED_FS] };
