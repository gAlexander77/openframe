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
uniform mat3 u_matrix;     // unit quad -> clip space
uniform vec4 u_crop;       // display-space uv rect: x0, y0, x1, y1
uniform int u_rotation;    // container rotation: 0, 1, 2, 3 quarter turns clockwise
uniform bool u_fbo;        // the source is a rendered texture (a compound clip): rows bottom-up
out vec2 v_uv;             // source texture uv
out vec2 v_local;          // 0..1 across the visible layer, top-left origin
out vec2 v_disp;           // display-space uv of the whole source (the matte's space)
void main() {
  v_local = a_pos;
  vec2 d = mix(u_crop.xy, u_crop.zw, a_pos);   // display-space uv
  v_disp = d;
  if (u_rotation == 1) v_uv = vec2(d.y, 1.0 - d.x);
  else if (u_rotation == 2) v_uv = vec2(1.0 - d.x, 1.0 - d.y);
  else if (u_rotation == 3) v_uv = vec2(1.0 - d.y, d.x);
  else v_uv = d;
  if (u_fbo) v_uv.y = 1.0 - v_uv.y;
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const LAYER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_local;
in vec2 v_disp;
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

void main() {
  vec4 src = u_solid ? u_color : texture(u_tex, v_uv);
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
  c = adjustColor(c, v_local);
  a *= u_opacity * maskAlpha(v_local);
  outColor = vec4(c * a, a);
}`;

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
  zoom: effect(["amount"], `
    outColor = texture(u_tex, (v_uv - 0.5) / (1.0 + u_amount * 0.01) + 0.5);`),
  // Bars across the short way to the ratio: top and bottom when the
  // canvas is narrower than it, left and right when wider. One pixel of
  // smoothing keeps the edge from crawling as the bars slide.
  letterbox: effect(["ratio", "amount"], `
    vec4 c = texture(u_tex, v_uv);
    float canvas = u_res.x / u_res.y;
    float k = clamp(u_amount * 0.01, 0.0, 1.0);
    bool rows = canvas < u_ratio;
    float bar = (rows ? 1.0 - canvas / u_ratio : 1.0 - u_ratio / canvas) * 0.5 * k;
    float d = rows ? min(v_uv.y, 1.0 - v_uv.y) : min(v_uv.x, 1.0 - v_uv.x);
    float px = 0.5 / (rows ? u_res.y : u_res.x);
    outColor = mix(vec4(0.0, 0.0, 0.0, 1.0), c, smoothstep(bar - px, bar + px, d));`),
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

export const TRANSITION_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_a;
uniform sampler2D u_b;
uniform float u_p;
uniform int u_type;
uniform vec2 u_res;
out vec4 outColor;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec4 A(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_a, uv); }
vec4 B(vec2 uv) { return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? vec4(0.0) : texture(u_b, uv); }
float ease(float t) { return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) / 2.0; }
// Mirrored edges, for moves that would uncover the frame's outside.
vec2 mirror(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
void main() {
  float p = clamp(u_p, 0.0, 1.0);
  float e = ease(p);
  vec2 uv = v_uv;
  float soft = 0.02;
  if (u_type == 0) { outColor = mix(A(uv), B(uv), p); return; }                         // dissolve
  if (u_type == 1 || u_type == 2) {                                                      // dip to black / white
    vec4 dip = u_type == 1 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(1.0);
    outColor = p < 0.5 ? mix(A(uv), dip, p * 2.0) : mix(dip, B(uv), p * 2.0 - 1.0); return;
  }
  // Wipes: B covers the part of the frame the edge has passed (distance from
  // the entry side below e). uv.y is 0 at the bottom of the picture.
  if (u_type == 3) { outColor = mix(B(uv), A(uv), smoothstep(e - soft, e + soft, 1.0 - uv.x)); return; }  // wipe left
  if (u_type == 4) { outColor = mix(B(uv), A(uv), smoothstep(e - soft, e + soft, uv.x)); return; }        // wipe right
  if (u_type == 5) { outColor = mix(B(uv), A(uv), smoothstep(e - soft, e + soft, uv.y)); return; }        // wipe up
  if (u_type == 6) { outColor = mix(B(uv), A(uv), smoothstep(e - soft, e + soft, 1.0 - uv.y)); return; }  // wipe down
  if (u_type == 7) {                                                                     // circle open
    float r = length((uv - 0.5) * vec2(u_res.x / u_res.y, 1.0));
    outColor = mix(B(uv), A(uv), smoothstep(e * 1.0 - soft, e * 1.0 + soft, r)); return;
  }
  if (u_type == 8) {                                                                     // clock wipe
    float a = atan(uv.x - 0.5, uv.y - 0.5) / 6.28318 + 0.5;
    outColor = mix(A(uv), B(uv), smoothstep(-soft, soft, e - a)); return;
  }
  if (u_type == 9) { outColor = B(uv + vec2(1.0 - e, 0.0)) + A(uv) * (1.0 - B(uv + vec2(1.0 - e, 0.0)).a); return; } // slide left
  if (u_type == 10) { outColor = B(uv - vec2(1.0 - e, 0.0)) + A(uv) * (1.0 - B(uv - vec2(1.0 - e, 0.0)).a); return; } // slide right
  if (u_type == 11) { vec4 a = A(uv + vec2(e, 0.0)); vec4 b = B(uv + vec2(e - 1.0, 0.0)); outColor = b + a * (1.0 - b.a); return; } // push left
  if (u_type == 12) { vec4 a = A(uv - vec2(0.0, e)); vec4 b = B(uv - vec2(0.0, e - 1.0)); outColor = b + a * (1.0 - b.a); return; } // push up
  if (u_type == 13) {                                                                    // zoom in
    vec4 a = A((uv - 0.5) / (1.0 + e * 2.0) + 0.5);
    vec4 b = B((uv - 0.5) * (2.0 - e) + 0.5 - (uv - 0.5) * (1.0 - e));
    outColor = mix(a, B(uv), smoothstep(0.3, 0.8, p)); return;
  }
  if (u_type == 14) {                                                                    // zoom out
    vec4 a = A((uv - 0.5) * (1.0 + e) + 0.5);
    vec4 b = B((uv - 0.5) / (0.5 + e * 0.5) + 0.5);
    outColor = mix(a, b, smoothstep(0.2, 0.7, p)); return;
  }
  if (u_type == 15) {                                                                    // spin
    float ang = e * 6.28318;
    vec2 q = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
    q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q / vec2(u_res.x / u_res.y, 1.0);
    float z = 1.0 + sin(p * 3.14159) * 1.5;
    vec2 suv = q * z + 0.5;
    outColor = p < 0.5 ? A(suv) : B(suv); return;
  }
  if (u_type == 16) {                                                                    // blur
    vec4 acc = vec4(0.0); float k = sin(p * 3.14159) * 0.02;
    for (int i = -6; i <= 6; i++) for (int j = -2; j <= 2; j++) {
      vec2 o = vec2(float(i), float(j) * 2.0) * k / 6.0;
      acc += mix(A(uv + o), B(uv + o), smoothstep(0.35, 0.65, p));
    }
    outColor = acc / 65.0; return;
  }
  if (u_type == 17) {                                                                    // pixelate
    float s = max(1.0, sin(p * 3.14159) * 60.0);
    vec2 b = vec2(s) / u_res;
    vec2 q = (floor(uv / b) + 0.5) * b;
    outColor = mix(A(q), B(q), step(0.5, p)); return;
  }
  if (u_type == 18) {                                                                    // glitch
    float k = sin(p * 3.14159);
    float band = floor(uv.y * 30.0);
    float n = hash(vec2(band, floor(p * 20.0)));
    vec2 q = uv + vec2((n - 0.5) * 0.2 * k * step(0.6, n), 0.0);
    vec4 c = mix(A(q), B(q), step(0.5, p));
    c.r = mix(A(q + vec2(0.02 * k, 0.0)), B(q + vec2(0.02 * k, 0.0)), step(0.5, p)).r;
    outColor = c; return;
  }
  if (u_type == 19) {                                                                    // flash
    float f = 1.0 - abs(p * 2.0 - 1.0);
    outColor = mix(A(uv), B(uv), step(0.5, p)) + vec4(vec3(pow(f, 3.0)), 0.0); return;
  }
  // Epic-edit moves: each smears along its motion, strongest mid-move,
  // the way a fast camera blurs, so the cut hides inside the blur.
  if (u_type == 20 || u_type == 21) {                                                    // whip left / right
    float dir = u_type == 20 ? 1.0 : -1.0;
    float span = 0.35 * pow(sin(p * 3.14159), 2.0);
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 24; i++) {
      float s = e + (float(i) / 23.0 - 0.5) * span;
      vec4 b = B(uv + vec2(dir * (s - 1.0), 0.0));
      acc += b + A(uv + vec2(dir * s, 0.0)) * (1.0 - b.a);
    }
    outColor = acc / 24.0; return;
  }
  if (u_type == 22) {                                                                    // zoom punch
    // Rush into the outgoing shot, cut at the middle, land on the next
    // from slightly too close; a radial blur rides the move.
    float z = p < 0.5 ? 1.0 + 2.0 * pow(p * 2.0, 2.0) : 1.0 + 0.7 * pow(2.0 - p * 2.0, 2.0);
    float bl = 0.25 * sin(p * 3.14159);
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 20; i++) {
      vec2 q = (uv - 0.5) * (1.0 - bl * float(i) / 19.0) / z + 0.5;
      acc += p < 0.5 ? A(q) : B(q);
    }
    outColor = acc / 20.0; return;
  }
  if (u_type == 23) {                                                                    // spin blur
    // A half turn out of the outgoing shot and a half turn into the next,
    // blurred around the center; mirrored edges fill the corners.
    float ang = (p < 0.5 ? e : e - 1.0) * 3.14159;
    float span = 0.9 * sin(p * 3.14159);
    vec2 asp = vec2(u_res.x / u_res.y, 1.0);
    float z = 1.0 + 0.3 * sin(p * 3.14159);
    vec4 acc = vec4(0.0);
    for (int i = 0; i < 24; i++) {
      float a = ang + (float(i) / 23.0 - 0.5) * span;
      vec2 q = mat2(cos(a), -sin(a), sin(a), cos(a)) * ((uv - 0.5) * asp) / z / asp + 0.5;
      acc += p < 0.5 ? texture(u_a, mirror(q)) : texture(u_b, mirror(q));
    }
    outColor = acc / 24.0; return;
  }
  outColor = mix(A(uv), B(uv), p);
}`;

export const TRANSITION_IDS: Record<string, number> = {
  dissolve: 0, dipBlack: 1, dipWhite: 2, wipeLeft: 3, wipeRight: 4, wipeUp: 5, wipeDown: 6,
  circleOpen: 7, clockWipe: 8, slideLeft: 9, slideRight: 10, pushLeft: 11, pushUp: 12,
  zoomIn: 13, zoomOut: 14, spin: 15, blur: 16, pixelate: 17, glitch: 18, flash: 19,
  whipLeft: 20, whipRight: 21, zoomPunch: 22, spinBlur: 23,
};

export const BLEND_IDS: Record<string, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, colorDodge: 6,
  colorBurn: 7, hardLight: 8, softLight: 9, difference: 10, exclusion: 11, add: 12,
};
