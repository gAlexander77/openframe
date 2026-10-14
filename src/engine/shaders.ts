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
out vec2 v_uv;             // source texture uv
out vec2 v_local;          // 0..1 across the visible layer, top-left origin
void main() {
  v_local = a_pos;
  vec2 d = mix(u_crop.xy, u_crop.zw, a_pos);   // display-space uv
  if (u_rotation == 1) v_uv = vec2(d.y, 1.0 - d.x);
  else if (u_rotation == 2) v_uv = vec2(1.0 - d.x, 1.0 - d.y);
  else if (u_rotation == 3) v_uv = vec2(1.0 - d.y, d.x);
  else v_uv = d;
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
}`;

export const LAYER_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec2 v_local;
uniform sampler2D u_tex;
uniform bool u_solid;
uniform vec4 u_color;
uniform vec2 u_texel;
uniform float u_sharpen;
uniform float u_opacity;
// chroma key
uniform bool u_key;
uniform vec3 u_keyColor;
uniform float u_keySimilarity, u_keySmoothness, u_keySpill;
// mask
uniform int u_maskShape;   // 0 none, 1 linear, 2 mirror, 3 circle, 4 rectangle
uniform vec2 u_maskCenter, u_maskSize;
uniform float u_maskRotation, u_maskFeather;
uniform bool u_maskInvert;
out vec4 outColor;
${COLOR_FNS}

vec2 cbcr(vec3 c) {
  return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b);
}

float maskAlpha(vec2 p) {
  if (u_maskShape == 0) return 1.0;
  vec2 q = p - (vec2(0.5) + u_maskCenter);
  float s = sin(-u_maskRotation), c = cos(-u_maskRotation);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float f = max(u_maskFeather * 0.5, 0.001);
  float a;
  if (u_maskShape == 1) a = smoothstep(-f, f, -q.y);
  else if (u_maskShape == 2) a = 1.0 - smoothstep(u_maskSize.y * 0.5 - f, u_maskSize.y * 0.5 + f, abs(q.y));
  else if (u_maskShape == 3) {
    float d = length(q / max(u_maskSize * 0.5, vec2(0.001)));
    a = 1.0 - smoothstep(1.0 - f * 2.0, 1.0 + f * 2.0, d);
  } else {
    vec2 e = abs(q) - u_maskSize * 0.5;
    float d = max(e.x, e.y);
    a = 1.0 - smoothstep(-f, f, d);
  }
  return u_maskInvert ? 1.0 - a : a;
}

void main() {
  vec4 src = u_solid ? u_color : texture(u_tex, v_uv);
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
  outColor = mix(A(uv), B(uv), p);
}`;

export const TRANSITION_IDS: Record<string, number> = {
  dissolve: 0, dipBlack: 1, dipWhite: 2, wipeLeft: 3, wipeRight: 4, wipeUp: 5, wipeDown: 6,
  circleOpen: 7, clockWipe: 8, slideLeft: 9, slideRight: 10, pushLeft: 11, pushUp: 12,
  zoomIn: 13, zoomOut: 14, spin: 15, blur: 16, pixelate: 17, glitch: 18, flash: 19,
};

export const BLEND_IDS: Record<string, number> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, colorDodge: 6,
  colorBurn: 7, hardLight: 8, softLight: 9, difference: 10, exclusion: 11, add: 12,
};
