// GLSL for the compositor (WebGL2 / GLSL ES 3.00). Conventions:
// - Every texture written by the compositor holds PREMULTIPLIED color.
// - Source textures (video frames, images, text canvases) are uploaded
//   straight (UNPACK_PREMULTIPLY_ALPHA false) and premultiplied by the
//   layer shader, the one place straight color is touched.
// - Full-screen passes sample with v_uv = gl_FragCoord / resolution, so
//   framebuffer orientation never needs flipping between passes.

export const FULLSCREEN_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos;
  gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Color math shared by clip layers and adjustment layers. Inputs are
 * straight (non-premultiplied) sRGB; values arrive pre-divided by 100. */
const COLOR_FNS = `
uniform float u_exposure, u_brightness, u_contrast, u_saturation, u_vibrance;
uniform float u_temperature, u_tint, u_highlights, u_shadows, u_whites, u_blacks;
uniform float u_hue, u_fade, u_vignette, u_grain;
uniform vec3 u_toneShadows, u_toneHighlights;
uniform float u_toneAmount;
uniform float u_time;
// the grade (ADR-020), mirrored from src/lib/grade.ts and curves.ts
uniform int u_lutKind;                   // 0 none, 1 1D, 2 3D
uniform float u_lutAmount, u_lutSize;    // size = texels per axis
uniform vec3 u_lutMin, u_lutMax;         // the .cube's input domain
uniform sampler2D u_lut1d;               // Nx1, RGB
uniform highp sampler3D u_lut3d;         // NxNxN, red along x
uniform bool u_curvesOn, u_wheelsOn, u_hslOn;
uniform sampler2D u_curves;              // 256x1: R, G, B curves, luma in A
uniform vec3 u_lift, u_gamma, u_gain, u_offset;
uniform vec3 u_hsl[8];                   // hue, saturation, lightness per band, -1..1

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 hueRotate(vec3 c, float a) {
  // Rotation about the gray axis (YIQ), a in radians.
  const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 yiq = toYIQ * c;
  float h = atan(yiq.z, yiq.y) + a;
  float chroma = length(yiq.yz);
  return toRGB * vec3(yiq.x, chroma * cos(h), chroma * sin(h));
}

vec3 applyLut(vec3 c) {
  vec3 v = clamp((c - u_lutMin) / (u_lutMax - u_lutMin), 0.0, 1.0);
  // Texel centers, so 0 and 1 hit the first and last entries exactly and
  // the hardware's trilinear filter interpolates between grid points.
  vec3 p = v * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
  vec3 o = u_lutKind == 2 ? texture(u_lut3d, p).rgb
    : vec3(texture(u_lut1d, vec2(p.r, 0.5)).r, texture(u_lut1d, vec2(p.g, 0.5)).g, texture(u_lut1d, vec2(p.b, 0.5)).b);
  return mix(c, o, u_lutAmount);
}

vec3 applyCurves(vec3 c) {
  const float k = 255.0 / 256.0, o = 0.5 / 256.0;
  c = vec3(texture(u_curves, vec2(c.r * k + o, 0.5)).a, texture(u_curves, vec2(c.g * k + o, 0.5)).a, texture(u_curves, vec2(c.b * k + o, 0.5)).a);
  return vec3(texture(u_curves, vec2(c.r * k + o, 0.5)).r, texture(u_curves, vec2(c.g * k + o, 0.5)).g, texture(u_curves, vec2(c.b * k + o, 0.5)).b);
}

vec3 applyWheels(vec3 c) {
  c = c + u_lift * 0.5 * (1.0 - c);
  c = c * (1.0 + u_gain);
  c = sign(c) * pow(abs(c), exp2(-u_gamma));
  return c + u_offset * 0.5;
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b), mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5, d = mx - mn;
  if (d < 1e-6) return vec3(0.0, 0.0, l);
  float s = d / max(1.0 - abs(2.0 * l - 1.0), 1e-6);
  float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0;
  return vec3(h / 6.0, s, l);
}

vec3 hsl2rgb(vec3 h) {
  vec3 k = clamp(abs(mod(h.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return h.z + h.y * (1.0 - abs(2.0 * h.z - 1.0)) * (k - 0.5);
}

const float HSL_CENTERS[9] = float[9](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 280.0, 320.0, 360.0);

vec3 applyHsl(vec3 c) {
  float m = smoothstep(0.0, 0.15, max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b));
  if (m <= 0.0) return c;
  vec3 hsl = rgb2hsl(c);
  float h = hsl.x * 360.0;
  int a = 0;
  for (int k = 1; k < 8; k++) if (h >= HSL_CENTERS[k]) a = k;
  float t = smoothstep(0.0, 1.0, (h - HSL_CENTERS[a]) / (HSL_CENTERS[a + 1] - HSL_CENTERS[a]));
  vec3 adj = mix(u_hsl[a], u_hsl[a == 7 ? 0 : a + 1], t) * m;
  hsl.x = fract(hsl.x + adj.x * (30.0 / 360.0));
  hsl.y = clamp(hsl.y * (1.0 + adj.y), 0.0, 1.0);
  hsl.z = adj.z >= 0.0 ? hsl.z + (1.0 - hsl.z) * adj.z * 0.5 : hsl.z * (1.0 + adj.z * 0.5);
  return hsl2rgb(hsl);
}

/** LUT, curves, wheels, HSL: Lumetri's order after the Basic sliders. */
vec3 grade(vec3 c) {
  if (u_lutKind > 0) c = applyLut(clamp(c, 0.0, 1.0));
  if (u_curvesOn) c = applyCurves(clamp(c, 0.0, 1.0));
  if (u_wheelsOn) c = applyWheels(clamp(c, 0.0, 1.0));
  if (u_hslOn) c = applyHsl(clamp(c, 0.0, 1.0));
  return c;
}

vec3 adjustColor(vec3 c, vec2 local) {
  c *= exp2(u_exposure * 2.0);
  c += u_brightness * 0.25;
  // white balance: warm adds red/removes blue, tint adds magenta/removes green
  c *= vec3(1.0 + u_temperature * 0.20, 1.0 - u_tint * 0.15, 1.0 - u_temperature * 0.20);
  c = mix(c, c * vec3(1.0 + u_tint * 0.08, 1.0, 1.0 + u_tint * 0.08), step(0.0, u_tint));
  // levels: blacks and whites move the endpoints
  c = (c - u_blacks * 0.15) / max(1.0 + u_whites * 0.25 - u_blacks * 0.15, 0.05);
  float l = luma(c);
  // highlights/shadows: tone curves weighted by luminance
  c += u_highlights * 0.35 * smoothstep(0.45, 1.0, l) * (u_highlights > 0.0 ? (1.0 - c) : c);
  c += u_shadows * 0.35 * (1.0 - smoothstep(0.0, 0.55, l)) * (u_shadows > 0.0 ? (1.0 - c) : c);
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  l = luma(c);
  float sat = 1.0 + u_saturation;
  float chroma = length(c - vec3(l));
  sat += u_vibrance * (1.0 - smoothstep(0.0, 0.5, chroma));
  c = mix(vec3(l), c, sat);
  if (u_hue != 0.0) c = hueRotate(c, u_hue * 3.14159265);
  if (u_toneAmount > 0.0) {
    float t = luma(clamp(c, 0.0, 1.0));
    vec3 toned = c + (u_toneShadows - 0.5) * (1.0 - t) * 0.6 + (u_toneHighlights - 0.5) * t * 0.6;
    c = mix(c, toned, u_toneAmount);
  }
  c = grade(c);
  c = mix(c, vec3(0.12) + c * 0.82, u_fade);
  if (u_vignette > 0.0) {
    float d = distance(local, vec2(0.5)) * 1.41421;
    c *= 1.0 - u_vignette * smoothstep(0.35, 1.0, d);
  }
  if (u_grain > 0.0) {
    float n = hash(local * 1000.0 + fract(u_time * 7.3)) - 0.5;
    c += n * u_grain * 0.25;
  }
  return clamp(c, 0.0, 1.0);
}
`;

/** Draws one source (video frame, image, text, solid color) through its
 * transform, crop, color, chroma key and mask into a layer framebuffer. */
export const LAYER_VS = `#version 300 es
in vec2 a_pos;
uniform mat3 u_matrix;     // layer units (0..1 across the visible layer) -> clip space
uniform vec4 u_extent;     // the quad in layer units: 0,0,1,1, or out to the canvas for an edge mode
out vec2 v_local;          // layer units, top-left origin; past 0..1 only with an edge mode
void main() {
  vec2 q = mix(u_extent.xy, u_extent.zw, a_pos);
  v_local = q;
  vec3 p = u_matrix * vec3(q, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

/** The layer pass. Shape layers (ADR-057) use the SHAPE build, which adds
 * the signed-distance drawing: kept out of the plain build, it would add
 * half again to the compile every layer waits on. */
const layerShader = (shape: boolean) => `#version 300 es
${shape ? "#define SHAPE 1" : ""}
precision highp float;
in vec2 v_local;
uniform vec4 u_crop;       // display-space uv rect: x0, y0, x1, y1
uniform mat3 u_uv;         // display uv -> texture uv: the container's quarter turns, a compound's flipped rows
uniform int u_edge;        // past the picture's edges: 0 nothing, 1 mirrored, 2 repeated (ADR-059)
// shape layers (ADR-057), in pixels of the render; see src/lib/shapes.ts
uniform int u_shape;       // 0 none, 1 rectangle, 2 ellipse, 3 line
uniform vec2 u_shapeQuad;  // the quad's size: box, stroke and an anti-aliasing margin
uniform vec2 u_shapeBox;   // half the box (a line: half its length, half its thickness)
uniform float u_shapeRadius, u_shapeStroke, u_shapeDraw;
uniform bool u_shapeFill, u_gradient;
uniform vec4 u_fill, u_fill2, u_strokeColor;   // straight RGBA
uniform vec2 u_gradDir;    // unit vector, y down
uniform sampler2D u_tex;
// remove background: a grayscale matte video, luma = alpha (ADR-033)
uniform bool u_matteOn;
uniform sampler2D u_matte;
uniform bool u_solid;
uniform bool u_fbo;        // premultiplied (a compound clip's composite)
uniform vec4 u_color;
uniform vec2 u_texel;
uniform float u_sharpen;
uniform float u_opacity;
// chroma key
uniform bool u_key;
uniform vec3 u_keyColor;
uniform float u_keySimilarity, u_keySmoothness, u_keySpill;
// mask
uniform int u_maskShape;   // 0 none, 1 linear, 2 mirror, 3 circle, 4 rectangle, 5 heart, 6 star
uniform vec2 u_maskCenter, u_maskSize;
uniform float u_maskRotation, u_maskFeather;
uniform float u_maskAspect;   // the visible layer's width over its height
uniform float u_maskRadius;   // rectangle corners, 0..1
uniform bool u_maskInvert;
out vec4 outColor;
${COLOR_FNS}

vec2 cbcr(vec3 c) {
  return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b);
}

// Heart and star, signed distance in the mask's box mapped to -1..1 (y
// down), so each shape fills its box. src/lib/mask.ts draws the same
// outlines for the viewer's handles; change both together.
float sdHeart(vec2 u) {
  // Inigo Quilez's exact heart: tip at the origin, lobes up to y 1.1036.
  vec2 p = vec2(abs(u.x) * 0.603553, (1.0 - u.y) * 0.551777);
  if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.353553;
  vec2 a = p - vec2(0.0, 1.0), b = p - 0.5 * max(p.x + p.y, 0.0);
  return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y);
}

vec2 starVertex(int i) {
  float a = -1.5707963 + 0.6283185 * float(i);   // 36 degrees apart, a point at the top
  return vec2(cos(a), sin(a)) * (i % 2 == 0 ? 1.0 : 0.381966);
}

float sdStar(vec2 u) {
  // A regular five-point star (inner radius 0.382 of the outer), polygon
  // distance after Inigo Quilez.
  vec2 p = vec2(u.x * 0.951057, u.y * 0.904508 - 0.095492);
  float d = 1e9, sg = 1.0;
  for (int i = 0; i < 10; i++) {
    vec2 vi = starVertex(i), vj = starVertex(i == 0 ? 9 : i - 1);
    vec2 e = vj - vi, w = p - vi;
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= vi.y, p.y < vj.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) sg = -sg;
  }
  return sg * sqrt(d);
}

float maskAlpha(vec2 p) {
  if (u_maskShape == 0) return 1.0;
  // Measured in layer heights, so the shape turns rigidly on a wide layer
  // (ADR-049); unrotated, every older shape draws exactly as before.
  vec2 d = (p - (vec2(0.5) + u_maskCenter)) * vec2(u_maskAspect, 1.0);
  float s = sin(-u_maskRotation), c = cos(-u_maskRotation);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  // Back to layer fractions along the mask's own axes: the units of its
  // size, and of the older shapes' feather.
  vec2 q = vec2(d.x / u_maskAspect, d.y);
  vec2 half_ = u_maskSize * 0.5;
  float f = max(u_maskFeather * 0.5, 0.001);
  float a;
  if (u_maskShape == 1) a = smoothstep(-f, f, -q.y);
  else if (u_maskShape == 2) a = 1.0 - smoothstep(half_.y - f, half_.y + f, abs(q.y));
  else if (u_maskShape == 3) {
    float r = length(q / max(half_, vec2(0.001)));
    a = 1.0 - smoothstep(1.0 - f * 2.0, 1.0 + f * 2.0, r);
  } else if (u_maskShape == 4 && u_maskRadius <= 0.0) {
    vec2 e = abs(q) - half_;
    a = 1.0 - smoothstep(-f, f, max(e.x, e.y));
  } else if (u_maskShape == 4) {
    // Round corners: a rounded box in layer heights, corners round on screen.
    vec2 b = half_ * vec2(u_maskAspect, 1.0);
    float r = u_maskRadius * min(b.x, b.y);
    vec2 e = abs(d) - b + r;
    a = 1.0 - smoothstep(-f, f, length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r);
  } else {
    // Feathered in half-sizes, like the circle.
    vec2 u = d / max(half_ * vec2(u_maskAspect, 1.0), vec2(0.0001));
    float sd = u_maskShape == 5 ? sdHeart(u) / 0.58 : sdStar(u) / 0.93;
    a = 1.0 - smoothstep(-f * 2.0, f * 2.0, sd);
  }
  return u_maskInvert ? 1.0 - a : a;
}

#ifdef SHAPE
// Where along a rectangle's (rounded) outline the point nearest q lies, 0..1
// from the top center, clockwise. src/lib/shapes.ts rectOutlineAt is this.
float rectOutlineAt(vec2 q, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 i = b - r;
  float arc = 1.5707963 * r;
  float total = 4.0 * (i.x + i.y + arc);
  if (total <= 0.0) return 0.0;
  vec2 a = abs(q);
  bool nearTop = (a.x <= i.x && a.y <= i.y) ? b.x - a.x > b.y - a.y : a.x <= i.x;
  float s = (a.x > i.x && a.y > i.y) ? i.x + r * atan(a.x - i.x, a.y - i.y) : nearTop ? a.x : i.x + arc + (i.y - a.y);
  float quarter = i.x + arc + i.y;
  float d = q.x >= 0.0 ? (q.y <= 0.0 ? s : 2.0 * quarter - s) : (q.y > 0.0 ? 2.0 * quarter + s : 4.0 * quarter - s);
  return fract(d / total);
}

float sdRoundBox(vec2 q, vec2 b, float r) {
  r = min(r, min(b.x, b.y));
  vec2 e = abs(q) - b + r;
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0) - r;
}

// The shape's straight color at display uv d. aa: pixels of the shape per
// pixel of the screen, from the unwrapped coordinates.
vec4 shapeColor(vec2 d, float aa) {
  vec2 q = (d - 0.5) * u_shapeQuad;
  vec2 b = u_shapeBox;
  float sw = u_shapeStroke;
  // the fill's paint: a gradient across the box, or one color (premultiplied)
  float span = abs(u_gradDir.x) * b.x + abs(u_gradDir.y) * b.y;
  float t = u_gradient ? clamp(dot(q, u_gradDir) / max(2.0 * span, 1e-3) + 0.5, 0.0, 1.0) : 0.0;
  vec4 p1 = vec4(u_fill.rgb * u_fill.a, u_fill.a), p2 = vec4(u_fill2.rgb * u_fill2.a, u_fill2.a);
  vec4 paint = mix(p1, p2, t);
  if (u_shape == 3) {
    // A line: a butt-capped bar from the left end, draw of the way along.
    float len = 2.0 * b.x * u_shapeDraw;
    float dist = sdRoundBox(q - vec2(-b.x + len * 0.5, 0.0), vec2(len * 0.5, b.y), 0.0);
    float cov = u_shapeDraw > 0.0 ? clamp(0.5 - dist / aa, 0.0, 1.0) : 0.0;
    vec4 o = paint * cov;
    return o.a > 0.0 ? vec4(o.rgb / o.a, o.a) : vec4(0.0);
  }
  float dist, s, per;
  if (u_shape == 1) {
    dist = sdRoundBox(q, b, u_shapeRadius);
    float r = min(u_shapeRadius, min(b.x, b.y));
    per = 4.0 * (b.x + b.y - 2.0 * r) + 6.2831853 * r;
    s = u_shapeDraw < 1.0 ? rectOutlineAt(q, b, u_shapeRadius) : 0.0;
  } else {
    // An ellipse: distance to first order (exact on circles), and the
    // outline by angle from the top (src/lib/shapes.ts ellipseOutlineAt).
    vec2 bb = max(b, vec2(1e-3));
    float k0 = length(q / bb), k1 = length(q / (bb * bb));
    dist = k1 > 0.0 ? k0 * (k0 - 1.0) / k1 : -min(bb.x, bb.y);
    per = 3.1415927 * (3.0 * (bb.x + bb.y) - sqrt((3.0 * bb.x + bb.y) * (bb.x + 3.0 * bb.y)));
    s = u_shapeDraw < 1.0 ? fract(atan(q.x / bb.x, -q.y / bb.y) / 6.2831853 + 1.0) : 0.0;
  }
  vec4 o = u_shapeFill ? paint * clamp(0.5 - dist / aa, 0.0, 1.0) : vec4(0.0);
  if (sw > 0.0) {
    float cov = clamp(0.5 - (abs(dist) - sw * 0.5) / aa, 0.0, 1.0);
    // Trim paths: the outline drawn up to draw of the way round.
    if (u_shapeDraw < 1.0) cov *= u_shapeDraw > 0.0 ? clamp((u_shapeDraw - s) * per / aa + 0.5, 0.0, 1.0) : 0.0;
    vec4 st = vec4(u_strokeColor.rgb * u_strokeColor.a, u_strokeColor.a) * cov;
    o = st + o * (1.0 - st.a);
  }
  return o.a > 0.0 ? vec4(o.rgb / o.a, o.a) : vec4(0.0);
}

#endif

vec2 edgeWrap(vec2 l) {
  if (u_edge == 1) return 1.0 - abs(mod(l, 2.0) - 1.0);
  if (u_edge == 2) return fract(l);
  return l;
}

void main() {
#ifdef SHAPE
  // Derivatives first, in uniform control flow, from the unwrapped units.
  vec2 qpx = v_local * u_shapeQuad;
  float aa = max(max(length(dFdx(qpx)), length(dFdy(qpx))), 1e-4);
#endif
  vec2 local = edgeWrap(v_local);
  vec2 v_disp = mix(u_crop.xy, u_crop.zw, local);   // display-space uv of the whole source (the matte's space)
  vec2 v_uv = (u_uv * vec3(v_disp, 1.0)).xy;         // source texture uv
#ifdef SHAPE
  vec4 src = shapeColor(v_disp, aa);
#else
  vec4 src = u_solid ? u_color : texture(u_tex, v_uv);
#endif
  if (u_fbo) src.rgb = src.a > 0.0 ? src.rgb / src.a : vec3(0.0);
  vec3 c = src.rgb;
  float a = src.a;
  if (u_sharpen > 0.0 && !u_solid) {
    vec3 blur = (texture(u_tex, v_uv + vec2(u_texel.x, 0.0)).rgb + texture(u_tex, v_uv - vec2(u_texel.x, 0.0)).rgb
      + texture(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb + texture(u_tex, v_uv - vec2(0.0, u_texel.y)).rgb) * 0.25;
    c += (c - blur) * u_sharpen * 2.0;
  }
  if (u_key) {
    float d = distance(cbcr(c), cbcr(u_keyColor));
    float k = smoothstep(u_keySimilarity * 0.4, u_keySimilarity * 0.4 + u_keySmoothness * 0.3 + 0.001, d);
    a *= k;
    float spill = (1.0 - smoothstep(0.0, u_keySimilarity * 0.4 + 0.25, d)) * u_keySpill;
    c = mix(c, vec3(luma(c)), spill);
  }
  // The matte went through a lossy codec and back (16..235 luma): the
  // outer 2% are codec noise, so flat areas land on exactly 0 and 1.
  if (u_matteOn) a *= clamp((texture(u_matte, v_disp).r - 0.02) / 0.96, 0.0, 1.0);
  c = adjustColor(c, local);
  a *= u_opacity * maskAlpha(local);
  outColor = vec4(c * a, a);
}`;

export const LAYER_FS = layerShader(false);
export const LAYER_SHAPE_FS = layerShader(true);

/** Track matte (ADR-056): the layer kept where the matte is opaque or
 * bright, or the reverse. Both premultiplied; luma of a premultiplied
 * matte reads its transparent parts as black, as After Effects does. */
export const MATTE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_matte;
uniform bool u_hasMatte;   // false: the matte clip has no picture at this frame
uniform int u_mode;        // 0 alpha, 1 alpha inverted, 2 luma, 3 luma inverted
out vec4 outColor;
void main() {
  vec4 m = u_hasMatte ? texture(u_matte, v_uv) : vec4(0.0);
  float k = u_mode < 2 ? m.a : clamp(dot(m.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  if (u_mode == 1 || u_mode == 3) k = 1.0 - k;
  outColor = texture(u_src, v_uv) * k;
}`;

export const MATTE_IDS: Record<string, number> = { alpha: 0, alphaInverted: 1, luma: 2, lumaInverted: 3 };

/** A plain copy: motion blur's float accumulation into a layer target. */
export const COPY_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() { outColor = texture(u_tex, v_uv); }`;

/** Blend a premultiplied layer over the premultiplied accumulator using the
 * W3C compositing formulas for separable blend modes. */
export const BLEND_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_dst;
uniform sampler2D u_src;
uniform int u_mode;
out vec4 outColor;

vec3 blendFn(vec3 b, vec3 s) {
  if (u_mode == 1) return b * s;                                   // multiply
  if (u_mode == 2) return b + s - b * s;                           // screen
  if (u_mode == 3) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b)); // overlay
  if (u_mode == 4) return min(b, s);                               // darken
  if (u_mode == 5) return max(b, s);                               // lighten
  if (u_mode == 6) return mix(min(vec3(1.0), b / max(1.0 - s, 1e-4)), vec3(1.0), step(1.0, s)) * step(1e-4, b); // color dodge
  if (u_mode == 7) return mix(1.0 - min(vec3(1.0), (1.0 - b) / max(s, 1e-4)), vec3(0.0), step(s, vec3(0.0))) * (1.0 - step(1.0, b)) + step(1.0, b); // color burn
  if (u_mode == 8) return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, s)); // hard light
  if (u_mode == 9) {                                               // soft light
    vec3 d = mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25)));
    return mix(b + (2.0 * s - 1.0) * (d - b), b - (1.0 - 2.0 * s) * b * (1.0 - b), step(s, vec3(0.5)));
  }
  if (u_mode == 10) return abs(b - s);                             // difference
  if (u_mode == 11) return b + s - 2.0 * b * s;                    // exclusion
  if (u_mode == 12) return min(b + s, 1.0);                        // add
  return s;                                                        // normal
}

void main() {
  vec4 d = texture(u_dst, v_uv);
  vec4 s = texture(u_src, v_uv);
  if (u_mode == 0) { outColor = s + d * (1.0 - s.a); return; }
  vec3 cs = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  vec3 cb = d.a > 0.0 ? d.rgb / d.a : vec3(0.0);
  vec3 mixed = (1.0 - d.a) * cs + d.a * blendFn(cb, cs);
  outColor = vec4(s.a * mixed + (1.0 - s.a) * d.rgb, s.a + d.a * (1.0 - s.a));
}`;

/** Adjustment layer: the accumulator through the color pipeline. */
export const ADJUST_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
${COLOR_FNS}
void main() {
  vec4 s = texture(u_tex, v_uv);
  vec3 c = s.a > 0.0 ? s.rgb / s.a : vec3(0.0);
  c = adjustColor(c, vec2(v_uv.x, 1.0 - v_uv.y));
  outColor = vec4(c * s.a, s.a);
}`;

/** out = mix(a, b, t), for adjustment-layer opacity. */
export const MIX_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_t;
out vec4 outColor;
void main() { outColor = mix(texture(u_a, v_uv), texture(u_b, v_uv), u_t); }`;

/** Final pass to the canvas: composite over the project background. */
export const PRESENT_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec3 u_background;
out vec4 outColor;
void main() {
  vec4 s = texture(u_tex, v_uv);
  outColor = vec4(s.rgb + u_background * (1.0 - s.a), 1.0);
}`;

// ---- effects ---------------------------------------------------------------------
// Each effect is a full-screen pass over a premultiplied layer texture.
// Shared uniforms: u_tex, u_res (pixels), u_time (s since clip start),
// u_scale (render height / 1080, so pixel params look the same at any
// preview resolution), plus the effect's own params as u_<param>.

const EFFECT_HEAD = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_res;
uniform float u_time;
uniform float u_scale;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

const effect = (params: string[], body: string) =>
  `${EFFECT_HEAD}${params.map((p) => `uniform float u_${p};`).join("\n")}\nvoid main() {\n${body}\n}`;

export const EFFECT_SHADERS: Record<string, string> = {
  // blur runs as two passes (u_dir = 1,0 then 0,1); see compositor.
  blur: effect(["amount", "dirX", "dirY"], `
    float radius = u_amount * 0.6 * u_scale;
    vec2 step = vec2(u_dirX, u_dirY) / u_res * max(radius / 12.0, 0.0);
    vec4 acc = vec4(0.0); float wsum = 0.0;
    for (int i = -12; i <= 12; i++) {
      float w = exp(-float(i * i) / 72.0);
      acc += texture(u_tex, v_uv + step * float(i)) * w; wsum += w;
    }
    outColor = acc / wsum;`),
  zoomBlur: effect(["amount"], `
    vec2 dir = v_uv - 0.5; vec4 acc = vec4(0.0);
    for (int i = 0; i < 24; i++) acc += texture(u_tex, v_uv - dir * float(i) / 24.0 * u_amount * 0.004);
    outColor = acc / 24.0;`),
  pixelate: effect(["size"], `
    vec2 b = vec2(max(u_size * u_scale, 1.0)) / u_res;
    outColor = texture(u_tex, (floor(v_uv / b) + 0.5) * b);`),
  rgbSplit: effect(["amount", "angle"], `
    float a = radians(u_angle); vec2 o = vec2(cos(a), sin(a)) * u_amount * 0.0004 * 30.0 / max(u_res.x / 1920.0, 0.25) / 30.0;
    vec4 c = texture(u_tex, v_uv);
    float r = texture(u_tex, v_uv + o).r; float b = texture(u_tex, v_uv - o).b;
    outColor = vec4(r, c.g, b, c.a);`),
  glitch: effect(["amount", "speed"], `
    float t = floor(u_time * (2.0 + u_speed * 0.2));
    float band = floor(v_uv.y * 24.0);
    float n = hash(vec2(band, t));
    float on = step(1.0 - u_amount * 0.006, n);
    vec2 uv = v_uv + vec2((hash(vec2(t, band)) - 0.5) * 0.12 * on * u_amount * 0.01, 0.0);
    vec4 c = texture(u_tex, uv);
    float shift = 0.008 * u_amount * 0.01 * (1.0 + on * 3.0);
    c.r = texture(u_tex, uv + vec2(shift, 0.0)).r;
    c.b = texture(u_tex, uv - vec2(shift, 0.0)).b;
    outColor = c;`),
  vhs: effect(["amount"], `
    float k = u_amount * 0.01;
    vec2 uv = v_uv;
    uv.x += (hash(vec2(floor(uv.y * 240.0), floor(u_time * 30.0))) - 0.5) * 0.004 * k;
    vec4 c = texture(u_tex, uv);
    c.r = texture(u_tex, uv + vec2(0.004 * k, 0.0)).r;
    c.b = texture(u_tex, uv - vec2(0.004 * k, 0.0)).b;
    float scan = 0.92 + 0.08 * sin(uv.y * u_res.y * 1.5);
    c.rgb *= mix(1.0, scan, k);
    c.rgb = mix(c.rgb, c.rgb * vec3(1.05, 0.95, 1.1) + 0.03 * c.a, k);
    outColor = c;`),
  grain: effect(["amount", "size"], `
    vec4 c = texture(u_tex, v_uv);
    vec2 cell = floor(v_uv * u_res / max(u_size * u_scale, 1.0));
    float n = hash(cell + fract(u_time * 24.0) * 97.0) - 0.5;
    outColor = vec4(c.rgb + n * u_amount * 0.005 * c.a, c.a);`),
  scanlines: effect(["amount", "density"], `
    vec4 c = texture(u_tex, v_uv);
    float s = 0.5 + 0.5 * sin(v_uv.y * u_density * 3.14159);
    outColor = vec4(c.rgb * (1.0 - u_amount * 0.006 * s), c.a);`),
  invert: effect(["amount"], `
    vec4 c = texture(u_tex, v_uv);
    outColor = vec4(mix(c.rgb, c.a - c.rgb, u_amount * 0.01), c.a);`),
  posterize: effect(["levels"], `
    vec4 c = texture(u_tex, v_uv);
    vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    s = floor(s * u_levels) / max(u_levels - 1.0, 1.0);
    outColor = vec4(clamp(s, 0.0, 1.0) * c.a, c.a);`),
  duotone: effect(["amount", "hue"], `
    vec4 c = texture(u_tex, v_uv);
    vec3 s = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    float l = luma(s);
    float h = radians(u_hue);
    vec3 tint = 0.5 + 0.5 * cos(h + vec3(0.0, 2.094, 4.188));
    vec3 d = mix(vec3(0.05, 0.03, 0.12), tint, l);
    outColor = vec4(mix(s, d, u_amount * 0.01) * c.a, c.a);`),
  mirror: effect(["mode"], `
    vec2 uv = v_uv;
    if (u_mode < 0.5 || u_mode > 1.5) uv.x = uv.x > 0.5 ? 1.0 - uv.x : uv.x;
    if (u_mode > 0.5) uv.y = uv.y > 0.5 ? 1.0 - uv.y : uv.y;
    outColor = texture(u_tex, uv);`),
  kaleidoscope: effect(["segments"], `
    vec2 p = (v_uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    float r = length(p); float a = atan(p.y, p.x);
    float seg = 6.28318 / max(u_segments, 2.0);
    a = mod(a, seg); a = abs(a - seg * 0.5);
    p = vec2(cos(a), sin(a)) * r / vec2(u_res.x / u_res.y, 1.0);
    outColor = texture(u_tex, p + 0.5);`),
  // The lens: inside a circle (size = its diameter as a share of the
  // frame's height), the picture around the center scaled up by zoom.
  // v_uv runs bottom-up in the effect pass, so Center Y (from the top)
  // flips.
  magnify: effect(["x", "y", "size", "zoom", "feather"], `
    vec2 c = vec2(u_x / 100.0, 1.0 - u_y / 100.0);
    vec2 asp = vec2(u_res.x / u_res.y, 1.0);
    float r = u_size / 200.0;
    float edge = max(r * u_feather / 100.0, 1.0 / u_res.y);
    float m = 1.0 - smoothstep(r - edge, r, length((v_uv - c) * asp));
    vec2 z = c + (v_uv - c) / max(u_zoom / 100.0, 0.01);
    outColor = mix(texture(u_tex, v_uv), texture(u_tex, z), m);`),
  fisheye: effect(["amount"], `
    vec2 p = v_uv - 0.5;
    float r = length(p);
    float k = u_amount * 0.012;
    vec2 uv = 0.5 + p * (1.0 - k * 0.5 + k * r * r * 2.0);
    outColor = (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_tex, uv);`),
  shake: effect(["amount", "speed"], `
    float t = u_time * (2.0 + u_speed * 0.25);
    vec2 o = vec2(sin(t * 7.1) + sin(t * 13.7) * 0.5, cos(t * 8.3) + cos(t * 11.9) * 0.5) * u_amount * 0.0003;
    vec2 uv = (v_uv - 0.5) / (1.0 + u_amount * 0.002) + 0.5 + o;
    outColor = texture(u_tex, uv);`),
  zoomPulse: effect(["amount", "rate"], `
    float p = pow(max(0.0, sin(u_time * u_rate * 3.14159)), 6.0);
    vec2 uv = (v_uv - 0.5) / (1.0 + p * u_amount * 0.004) + 0.5;
    outColor = texture(u_tex, uv);`),
  flash: effect(["amount", "rate"], `
    vec4 c = texture(u_tex, v_uv);
    float f = pow(max(0.0, sin(u_time * u_rate * 3.14159)), 16.0) * u_amount * 0.01;
    outColor = vec4(c.rgb + f * c.a, c.a);`),
  glow: effect(["amount", "threshold"], `
    vec4 c = texture(u_tex, v_uv);
    vec4 acc = vec4(0.0);
    vec2 px = 6.0 * u_scale / u_res;
    for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
      vec4 s = texture(u_tex, v_uv + vec2(float(x), float(y)) * px);
      float l = s.a > 0.0 ? luma(s.rgb / s.a) : 0.0;
      acc += s * smoothstep(u_threshold * 0.01, u_threshold * 0.01 + 0.2, l);
    }
    acc /= 49.0;
    outColor = vec4(c.rgb + acc.rgb * u_amount * 0.04, max(c.a, acc.a));`),
  // An edge-preserving blur: neighbors count by distance and by how alike
  // their colors are, so noise averages out and edges do not.
  denoise: effect(["amount"], `
    vec4 c = texture(u_tex, v_uv);
    float sr = 0.015 + u_amount * 0.0015;
    vec2 px = 1.5 * u_scale / u_res;
    vec4 acc = vec4(0.0); float ws = 0.0;
    for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) {
      vec4 s = texture(u_tex, v_uv + vec2(float(x), float(y)) * px);
      vec3 d = s.rgb - c.rgb;
      float w = exp(-float(x * x + y * y) / 8.0) * exp(-dot(d, d) / (2.0 * sr * sr));
      acc += s * w; ws += w;
    }
    outColor = acc / ws;`),
  motionBlur: effect(["amount", "angle"], `
    float a = radians(u_angle);
    vec2 dir = vec2(cos(a), sin(a)) * u_amount * 0.4 * u_scale / u_res;
    vec4 acc = vec4(0.0);
    for (int i = -12; i <= 12; i++) acc += texture(u_tex, v_uv + dir * float(i) / 12.0);
    outColor = acc / 25.0;`),
  // Pencil lines on paper from the picture's edges (Sobel on luma).
  sketch: effect(["amount", "mix"], `
    vec2 px = u_scale / u_res;
    float l[9];
    for (int i = 0; i < 9; i++) {
      vec4 s = texture(u_tex, v_uv + vec2(float(i % 3 - 1), float(i / 3 - 1)) * px);
      l[i] = s.a > 0.0 ? luma(s.rgb / s.a) : 0.0;
    }
    float gx = (l[2] + 2.0 * l[5] + l[8]) - (l[0] + 2.0 * l[3] + l[6]);
    float gy = (l[6] + 2.0 * l[7] + l[8]) - (l[0] + 2.0 * l[1] + l[2]);
    float e = clamp(length(vec2(gx, gy)) * (0.5 + u_amount * 0.06), 0.0, 1.0);
    vec4 c = texture(u_tex, v_uv);
    outColor = vec4(mix(c.rgb, vec3(1.0 - e) * c.a, u_mix * 0.01), c.a);`),
  // Print dots: each cell's dot grows with how dark the cell is.
  halftone: effect(["size"], `
    float size = max(u_size * u_scale, 2.0);
    vec2 p = v_uv * u_res;
    vec2 cell = (floor(p / size) + 0.5) * size;
    vec4 s = texture(u_tex, cell / u_res);
    float l = s.a > 0.0 ? luma(s.rgb / s.a) : 1.0;
    float r = sqrt(1.0 - l) * size * 0.7;
    float inDot = 1.0 - smoothstep(r - 0.75, r + 0.75, length(p - cell));
    outColor = vec4(mix(vec3(s.a), s.rgb, inDot), s.a);`),
  lightLeak: effect(["amount", "speed"], `
    vec4 c = texture(u_tex, v_uv);
    float t = u_time * (0.2 + u_speed * 0.02);
    vec2 p = v_uv + vec2(sin(t) * 0.4, cos(t * 0.7) * 0.3);
    float l = smoothstep(0.9, 0.0, length(p - vec2(0.1, 0.9)));
    vec3 leak = vec3(1.0, 0.45, 0.15) * l + vec3(1.0, 0.2, 0.5) * smoothstep(0.7, 0.0, length(p - vec2(1.0, 0.2))) * 0.6;
    outColor = vec4(c.rgb + leak * u_amount * 0.01 * c.a, c.a);`),
};

// ---- transitions -------------------------------------------------------------
// u_a: outgoing layer, u_b: incoming layer (both premultiplied), u_p 0..1.
// With BLUR (motion blur on a transition that moves, ADR-058) only the
// moving types are compiled, averaged over u_samples progress values, and
// sampled with textureLod: texture() inside a loop of uniform length made
// ANGLE's D3D compiler unroll it, and the program took a second to build.

const transitionShader = (blur: boolean) => `#version 300 es
${blur ? "#define BLUR 1" : ""}
precision highp float;
in vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform int u_type;
uniform vec2 u_res;
uniform int u_samples;     // BLUR: progress values averaged
uniform float u_spread;    // ...spread this wide around u_p
out vec4 outColor;
#ifdef BLUR
#define TEX(s, uv) textureLod(s, uv, 0.0)
#else
#define TEX(s, uv) texture(s, uv)
#endif
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec4 A(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : TEX(u_a, uv); }
vec4 B(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : TEX(u_b, uv); }
float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
vec4 transitionAt(float p) {
  float e = ease(p);
  vec2 uv = v_uv;
  float soft = 0.02;
#ifndef BLUR
  if (u_type == 0) { return mix(A(uv), B(uv), p); }                         // dissolve
  if (u_type == 1 || u_type == 2) {                                                      // dip to black / white
    vec4 dip = u_type == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    return p < 0.5 ? mix(A(uv), dip, p * 2.0) : mix(dip, B(uv), p * 2.0 - 1.0);
  }
  // Wipes: B covers the part of the frame the edge has passed (distance from
  // the entry side below e). uv.y is 0 at the bottom of the picture.
  if (u_type == 3) { return mix(B(uv), A(uv), smoothstep(e - soft, e + soft, 1.0 - uv.x)); }  // wipe left
  if (u_type == 4) { return mix(B(uv), A(uv), smoothstep(e - soft, e + soft, uv.x)); }        // wipe right
  if (u_type == 5) { return mix(B(uv), A(uv), smoothstep(e - soft, e + soft, uv.y)); }        // wipe up
  if (u_type == 6) { return mix(B(uv), A(uv), smoothstep(e - soft, e + soft, 1.0 - uv.y)); }  // wipe down
  if (u_type == 7) {                                                                     // circle open
    float r = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0));
    return mix(B(uv), A(uv), smoothstep(e * 1.0 - soft, e * 1.0 + soft, r));
  }
  if (u_type == 8) {                                                                     // clock wipe
    float a = atan(uv.x - 0.5, uv.y - 0.5) / 6.28318 + 0.5;
    return mix(A(uv), B(uv), smoothstep(-soft, soft, e - a));
  }
#endif
  if (u_type == 9) { return B(uv + vec2(1.0 - e, 0.0)) + A(uv) * (1.0 - B(uv + vec2(1.0 - e, 0.0)).a); } // slide left
  if (u_type == 10) { return B(uv - vec2(1.0 - e, 0.0)) + A(uv) * (1.0 - B(uv - vec2(1.0 - e, 0.0)).a); } // slide right
  if (u_type == 11) { vec4 a = A(uv + vec2(e, 0.0)); vec4 b = B(uv + vec2(e - 1.0, 0.0)); return b + a * (1.0 - b.a); } // push left
  if (u_type == 12) { vec4 a = A(uv - vec2(0.0, e)); vec4 b = B(uv - vec2(0.0, e - 1.0)); return b + a * (1.0 - b.a); } // push up
  if (u_type == 13) {                                                                    // zoom in
    vec4 a = A((uv - 0.5) / (1.0 + e * 2.0) + 0.5);
    vec4 b = B((uv - 0.5) * (2.0 - e) + 0.5 - (uv - 0.5) * (1.0 - e));
    return mix(a, B(uv), smoothstep(0.3, 0.8, p));
  }
  if (u_type == 14) {                                                                    // zoom out
    vec4 a = A((uv - 0.5) * (1.0 + e) + 0.5);
    vec4 b = B((uv - 0.5) / (0.5 + e * 0.5) + 0.5);
    return mix(a, b, smoothstep(0.2, 0.7, p));
  }
  if (u_type == 15) {                                                                    // spin
    float ang = e * 6.28318;
    vec2 q = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q / vec2(u_res.x / u_res.y, 1.0);
    float z = 1.0 + sin(p * 3.14159) * 1.5;
    vec2 suv = q * z + 0.5;
    return p < 0.5 ? A(suv) : B(suv);
  }
#ifndef BLUR
  if (u_type == 16) {                                                                    // blur
    vec4 acc = vec4(0.0); float k = sin(p * 3.14159) * 0.02;
    for (int i = -6; i <= 6; i++) for (int j = -2; j <= 2; j++) {
      vec2 o = vec2(float(i), float(j) * 2.0) * k / 6.0;
      acc += mix(A(uv + o), B(uv + o), smoothstep(0.35, 0.65, p));
    }
    return acc / 65.0;
  }
  if (u_type == 17) {                                                                    // pixelate
    float s = max(1.0, sin(p * 3.14159) * 60.0);
    vec2 b = vec2(s) / u_res;
    vec2 q = (floor(uv / b) + 0.5) * b;
    return mix(A(q), B(q), step(0.5, p));
  }
  if (u_type == 18) {                                                                    // glitch
    float k = sin(p * 3.14159);
    float band = floor(uv.y * 30.0);
    float n = hash(vec2(band, floor(p * 20.0)));
    vec2 q = uv + vec2((n - 0.5) * 0.2 * k * step(0.6, n), 0.0);
    vec4 c = mix(A(q), B(q), step(0.5, p));
    c.r = mix(A(q + vec2(0.02 * k, 0.0)), B(q + vec2(0.02 * k, 0.0)), step(0.5, p)).r;
    return c;
  }
  if (u_type == 19) {                                                                    // flash
    float f = 1.0 - abs(p * 2.0 - 1.0);
    return mix(A(uv), B(uv), step(0.5, p)) + vec4(vec3(pow(f, 3.0)), 0.0);
  }
#endif
  return mix(A(uv), B(uv), p);
}
void main() {
#ifdef BLUR
  vec4 acc = vec4(0.0);
  for (int k = 0; k < 64; k++) {
    if (k >= u_samples) break;
    acc += transitionAt(clamp(u_p + ((float(k) + 0.5) / float(u_samples) - 0.5) * u_spread, 0.0, 1.0));
  }
  outColor = acc / float(max(u_samples, 1));
#else
  outColor = transitionAt(clamp(u_p, 0.0, 1.0));
#endif
}`;

export const TRANSITION_FS = transitionShader(false);
export const TRANSITION_BLUR_FS = transitionShader(true);

export const TRANSITION_IDS: Record<string, number> = {
  dissolve: 0, dipBlack: 1, dipWhite: 2, wipeLeft: 3, wipeRight: 4, wipeUp: 5, wipeDown: 6,
  circleOpen: 7, clockWipe: 8, slideLeft: 9, slideRight: 10, pushLeft: 11, pushUp: 12,
  zoomIn: 13, zoomOut: 14, spin: 15, blur: 16, pixelate: 17, glitch: 18, flash: 19,
};

export const BLEND_IDS: Record<string, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, colorDodge: 6,
  colorBurn: 7, hardLight: 8, softLight: 9, difference: 10, exclusion: 11, add: 12,
};
