// WebGL2 compositor: draws a frame plan (src/lib/render/plan.ts) into a
// canvas. One GL context, a small pool of canvas-sized framebuffers, and a
// fixed pass order:
//
//   accum <- background (transparent)
//   for each plan item, bottom to top:
//     layer:      source -> layer FB (transform, crop, color, key, mask)
//                 -> effects (ping-pong) -> blend into accum
//     transition: both sides -> two layer FBs -> transition pass -> blend
//     adjust:     accum -> color pass -> effects -> mix by opacity -> accum
//   present: accum over the project background -> canvas
//
// A compound clip's layer (ADR-037) first composites its nested plan the
// same way, one level of framebuffers deeper, into a texture of its own;
// that texture is then the layer's source, so the clip's transform,
// opacity, blend, color and effects act on the nested timeline's picture.
//
// A layer with motion blur (ADR-058) is drawn once per shutter placement
// into a half-float target and averaged; one with a track matte (ADR-056)
// is multiplied by its matte layer, drawn into a level's matte targets.
// Blurs past the old maximum, and drop shadows' softness, run on a pyramid
// of halved targets (ADR-069, ADR-070); a drop shadow is cast last, by the
// finished layer, so masks, mattes and compound pictures cast their shape.
//
// Preview and export share this class; only the canvas and size differ.

import { blurPlan, blurSigma, usesPyramid } from "../lib/blur";
import { bakeCurves } from "../lib/curves";
import type { GradeParams } from "../lib/grade";
import { fit1d, type Lut } from "../lib/lut";
import { lutFor } from "./luts";
import type { Placement } from "../lib/motionBlur";
import type { BlendMode, Border, DropShadow, MatteMode } from "../lib/project/types";
import { floodSteps } from "../lib/border";
import type { Layer, PlanItem, ResolvedEffect, Tone } from "../lib/render/plan";
import { featherReach, parseColor, shapeExtent, strokePx } from "../lib/shapes";
import { tiltMatrix } from "../lib/tilt";
import {
  ADJUST_FS,
  BLEND_FS,
  BLEND_IDS,
  BORDER_FS,
  COPY_FS,
  DOWN_FS,
  EFFECT_SHADERS,
  FLOOD_SEED_FS,
  FLOOD_STEP_FS,
  FULLSCREEN_VS,
  GAUSS_FS,
  LAYER_FS,
  LAYER_SHAPE_FS,
  LAYER_VS,
  MATTE_FS,
  MATTE_IDS,
  MIX_FS,
  PRESENT_FS,
  SHADOW_FS,
  TRANSITION_BLUR_FS,
  TRANSITION_FS,
  TRANSITION_IDS,
  UP_FS,
} from "./shaders";

/** What the compositor needs to draw a layer's pixels. Width and height are
 * display size (after container rotation). */
export interface SourceImage {
  image: TexImageSource;
  width: number;
  height: number;
  /** Quarter turns clockwise from container metadata. */
  rotation: 0 | 1 | 2 | 3;
  /** Text rasters are already canvas-scale pixels: no fit-to-canvas. */
  native?: boolean;
  /** Stable key for sources that do not change between frames (images,
   * text). Unkeyed sources (video frames) re-upload every draw. */
  key?: string;
  /** Remove background: this frame's matte (luma = alpha), covering the
   * whole source in display orientation (ADR-033). */
  matte?: TexImageSource;
  /** Frame blending: the following frame (same size and turn) and its
   * share, drawn over this one as (1 - w) * this + w * next. */
  next?: { image: TexImageSource; w: number };
}

type Program = { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> };

/** Upload slots for frame blending's next frames sit past the frame's own. */
const NEXT_SLOTS = 1 << 12;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

/** A compound clip's composited picture: canvas-sized, premultiplied, rows
 * bottom-up, already on the GPU. */
interface RenderedSource {
  rendered: Target;
}
type DrawSource = SourceImage | RenderedSource;
const isRendered = (s: DrawSource | null): s is RenderedSource => !!s && "rendered" in s;

const MASK_SHAPES = { linear: 1, mirror: 2, circle: 3, rectangle: 4, heart: 5, star: 6 } as const;
const SHAPE_IDS = { rectangle: 1, ellipse: 2, line: 3 } as const;

/** A CSS color as straight RGBA for a uniform, parsed once. */
const rgbaCache = new Map<string, [number, number, number, number]>();
function rgba(css: string): [number, number, number, number] {
  let c = rgbaCache.get(css);
  if (!c) {
    c = parseColor(css) ?? [0, 0, 0, 1];
    if (rgbaCache.size > 512) rgbaCache.clear();
    rgbaCache.set(css, c);
  }
  return c;
}

/** Display uv to texture uv (column-major mat3): a source stored turned
 * by `turns` quarter turns clockwise (phone footage), and a compound's
 * picture, whose rows run bottom-up. */
function uvMatrix(turns: number, rowsUp: boolean): Float32Array {
  // u' = a.x * u + b.x * v + c.x, v' = a.y * u + b.y * v + c.y
  const [a, b, c] = [
    [[1, 0], [0, 1], [0, 0]],
    [[0, -1], [1, 0], [0, 1]],
    [[-1, 0], [0, -1], [1, 1]],
    [[0, 1], [-1, 0], [1, 0]],
  ][turns & 3];
  const f = rowsUp ? -1 : 1;
  return new Float32Array([a[0], f * a[1], 0, b[0], f * b[1], 0, c[0], rowsUp ? 1 - c[1] : c[1], 1]);
}

/** The span of layer units (u, v) an affine map P = O + u * (m00, m10) +
 * v * (m01, m11) must cover to reach every corner of a W x H canvas: the
 * quad an edge mode draws (ADR-059). */
function edgeExtent(m00: number, m01: number, m10: number, m11: number, ox: number, oy: number, W: number, H: number): number[] | null {
  const det = m00 * m11 - m01 * m10;
  if (Math.abs(det) < 1e-9) return null;
  const us: number[] = [], vs: number[] = [];
  for (const [px, py] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    const dx = px - ox, dy = py - oy;
    us.push((m11 * dx - m01 * dy) / det);
    vs.push((-m10 * dx + m00 * dy) / det);
  }
  const c = (v: number) => Math.max(-256, Math.min(257, v));
  return [c(Math.min(...us)), c(Math.min(...vs)), c(Math.max(...us)), c(Math.max(...vs))];
}

/** GL reads rows bottom-up; flip them to top-down in place. */
function flipRows(out: Uint8Array, width: number, height: number): Uint8Array {
  const row = width * 4;
  const tmp = new Uint8Array(row);
  for (let y = 0; y < height / 2; y++) {
    const a = y * row;
    const b = (height - 1 - y) * row;
    tmp.set(out.subarray(a, a + row));
    out.copyWithin(a, b, b + row);
    out.set(tmp, b);
  }
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const v = parseInt(n.slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export class Compositor {
  private disposed = false;
  readonly gl: WebGL2RenderingContext;
  private quad: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  /** Framebuffers per nesting level: [0] for the project's own timeline,
   * [n] for compound clips n deep. Each level is accum A/B, layer L1/L2,
   * temp T1/T2. Levels past 0 are made on first use. */
  private levels: Target[][] = [];
  /** Finished compound pictures, per level, reused every frame. */
  private baked: Target[][] = [];
  /** Track mattes' own draw and effect targets, per level, on first use. */
  private matteTargets: Target[][] = [];
  /** Motion blur's half-float sum (ADR-058); null where the platform
   * cannot render to one, which draws moving layers unblurred. */
  private accum: Target | null | undefined;
  /** The blur pyramid (ADR-069): per level, two targets of that level's
   * size; level 0 is full size, each next one half the last. One set for
   * every nesting level: a blur finishes before anything else draws. */
  private pyramid: { w: number; h: number; a: Target; b: Target }[] = [];
  /** The border's jump flood ping-pongs between these (ADR-099), made on first use. */
  private flood: [Target, Target] | null = null;
  private width = 0;
  private height = 0;
  /** Textures for sources, by key (stable sources) or by slot. */
  private sourceTextures = new Map<string, WebGLTexture>();
  private slotTextures: WebGLTexture[] = [];
  private matteTextures: WebGLTexture[] = [];
  /** Baked curve tables by their points (JSON), and a neutral 1x1 bound
   * when a grade part is off so no sampler is ever left without one. */
  private curveTextures = new Map<string, WebGLTexture>();
  private blank2d: WebGLTexture | null = null;
  private blank3d: WebGLTexture | null = null;
  /** LUT tables on the GPU by source, with the parsed table they came from. */
  private lutTextures = new Map<string, { lut: Lut; tex: WebGLTexture; width: number }>();
  private compareTexture: WebGLTexture | null = null;
  private compareBitmap: ImageBitmap | null = null;
  /** Small target for scaled readbacks (scopes). */
  private small: { fb: WebGLFramebuffer; rb: WebGLRenderbuffer; w: number; h: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 is not available, so video cannot be drawn");
    this.gl = gl;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  // ---- GL plumbing ---------------------------------------------------------------

  private program(key: string, vs: string, fs: string): Program {
    return this.programs.get(key) ?? this.finishProgram(key, this.startProgram(vs, fs));
  }

  /** Compile and link without asking how it went, so a driver with
   * KHR_parallel_shader_compile can work while this thread goes on. */
  private startProgram(vs: string, fs: string) {
    const gl = this.gl;
    const shader = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return sh;
    };
    const shaders = [shader(gl.VERTEX_SHADER, vs), shader(gl.FRAGMENT_SHADER, fs)];
    const prog = gl.createProgram()!;
    for (const sh of shaders) gl.attachShader(prog, sh);
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    return { prog, shaders };
  }

  /** Check a started program (blocking until it is done) and cache it. */
  private finishProgram(key: string, { prog, shaders }: { prog: WebGLProgram; shaders: WebGLShader[] }): Program {
    const gl = this.gl;
    for (const sh of shaders) {
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`shader ${key}: ${gl.getShaderInfoLog(sh)}`);
    }
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program ${key}: ${gl.getProgramInfoLog(prog)}`);
    }
    for (const sh of shaders) { gl.detachShader(prog, sh); gl.deleteShader(sh); }
    const p = { prog, loc: new Map<string, WebGLUniformLocation | null>() };
    this.programs.set(key, p);
    return p;
  }

  /**
   * Compile every pass's program before the first render needs it. A fresh
   * context otherwise compiles layer, blend, transition and present inside
   * its first render: ~300 ms of main thread on ANGLE/D3D11 (measured with
   * the library previews). With KHR_parallel_shader_compile the driver
   * compiles them off this thread and this only polls between frames;
   * without it, each still gets its own macrotask.
   */
  async warm(): Promise<void> {
    if (this.disposed) return;
    const gl = this.gl;
    const ext = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
    const all: [string, string, string][] = [
      ["layer", LAYER_VS, LAYER_FS],
      ["layer:shape", LAYER_VS, LAYER_SHAPE_FS],
      ["blend", FULLSCREEN_VS, BLEND_FS],
      ["present", FULLSCREEN_VS, PRESENT_FS],
      ["transition", FULLSCREEN_VS, TRANSITION_FS],
      ["adjust", FULLSCREEN_VS, ADJUST_FS],
      ["mix", FULLSCREEN_VS, MIX_FS],
      ["matte", FULLSCREEN_VS, MATTE_FS],
      ["copy", FULLSCREEN_VS, COPY_FS],
      ["blur:down", FULLSCREEN_VS, DOWN_FS],
      ["blur:gauss", FULLSCREEN_VS, GAUSS_FS],
      ["blur:up", FULLSCREEN_VS, UP_FS],
      ["shadow", FULLSCREEN_VS, SHADOW_FS],
      ["border:seed", FULLSCREEN_VS, FLOOD_SEED_FS],
      ["border:step", FULLSCREEN_VS, FLOOD_STEP_FS],
      ["border", FULLSCREEN_VS, BORDER_FS],
      ...Object.entries(EFFECT_SHADERS).map(([k, fs]): [string, string, string] => [`fx:${k}`, FULLSCREEN_VS, fs]),
    ];
    const pending = all.filter(([k]) => !this.programs.has(k)).map(([key, vs, fs]) => ({ key, ...this.startProgram(vs, fs) }));
    const frame = () => new Promise((r) => setTimeout(r, 16));
    const unused = new Set(pending);
    try {
      if (ext) while (!this.disposed && pending.some((p) => !gl.getProgramParameter(p.prog, ext.COMPLETION_STATUS_KHR))) await frame();
      for (const p of pending) {
        if (this.disposed) break;
        if (!this.programs.has(p.key)) {
          this.finishProgram(p.key, p);
          unused.delete(p);
        }
        if (!ext) await frame();
      }
    } finally {
      // Drawing can compile a pass before background warmup finishes;
      // unmount can dispose the viewer meanwhile. Neither may leak a program.
      for (const p of unused) {
        for (const sh of p.shaders) gl.deleteShader(sh);
        gl.deleteProgram(p.prog);
      }
    }
  }

  private use(p: Program) {
    this.gl.useProgram(p.prog);
    return (name: string) => {
      if (!p.loc.has(name)) p.loc.set(name, this.gl.getUniformLocation(p.prog, name));
      return p.loc.get(name)!;
    };
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  /** Size every framebuffer to the render resolution. Cheap when unchanged. */
  resize(width: number, height: number) {
    width = Math.max(2, Math.round(width));
    height = Math.max(2, Math.round(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this.freeTargets();
    this.level(0);
  }

  private makeTarget(w = this.width, h = this.height, half = false): Target {
    const gl = this.gl;
    const tex = this.makeTexture();
    if (half) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex };
  }

  private freeTargets() {
    const gl = this.gl;
    const pyramid = this.pyramid.flatMap((l) => [l.a, l.b]);
    for (const t of [...this.levels.flat(), ...this.baked.flat(), ...this.matteTargets.flat(), ...pyramid, ...(this.accum ? [this.accum] : []), ...(this.flood ?? [])]) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.levels = [];
    this.baked = [];
    this.matteTargets = [];
    this.pyramid = [];
    this.flood = null;
    this.accum = undefined;
  }

  /** The blur pyramid's level `l` (ADR-069), made on first use. Halved
   * levels are half floats where the platform renders to them, so a wide,
   * dim glow keeps more than 8 bits until its last pass. */
  private pyramidLevel(l: number) {
    const hit = this.pyramid[l];
    if (hit) return hit;
    const w = Math.max(1, Math.ceil(this.width / 2 ** l)), h = Math.max(1, Math.ceil(this.height / 2 ** l));
    // EXT_color_buffer_float makes RGBA16F renderable; checked anyway, as
    // the motion blur target is.
    const target = () => {
      if (l > 0 && this.gl.getExtension("EXT_color_buffer_float")) {
        const t = this.makeTarget(w, h, true);
        if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) === this.gl.FRAMEBUFFER_COMPLETE) return t;
        this.gl.deleteFramebuffer(t.fb);
        this.gl.deleteTexture(t.tex);
      }
      return this.makeTarget(w, h);
    };
    return (this.pyramid[l] = { w, h, a: target(), b: target() });
  }

  /** Draw into `t` at its own size (the pyramid's levels are smaller than
   * the canvas). */
  private bindSized(t: Target, w: number, h: number) {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, t.fb);
    this.gl.viewport(0, 0, w, h);
  }

  /** Blur `src`, a canvas-sized premultiplied texture, by a Gaussian of
   * `sigma` render pixels on the pyramid (lib/blur.ts plans it). The result
   * stays in the level it was blurred at: read it with the B-spline when
   * `spline` (UP_FS, SHADOW_FS). */
  private gaussian(src: WebGLTexture, sigma: number): { tex: WebGLTexture; w: number; h: number; spline: boolean } {
    const gl = this.gl;
    const plan = blurPlan(sigma);
    let tex = src, w = this.width, h = this.height;
    for (let l = 1; l <= plan.levels; l++) {
      const lv = this.pyramidLevel(l);
      this.bindSized(lv.a, lv.w, lv.h);
      const u = this.use(this.program("blur:down", FULLSCREEN_VS, DOWN_FS));
      this.bindTex(0, tex, u("u_tex"));
      gl.uniform2f(u("u_texel"), 1 / w, 1 / h);
      this.draw();
      [tex, w, h] = [lv.a.tex, lv.w, lv.h];
    }
    const lv = this.pyramidLevel(plan.levels);
    const u = this.use(this.program("blur:gauss", FULLSCREEN_VS, GAUSS_FS));
    this.bindSized(lv.b, lv.w, lv.h);
    this.bindTex(0, tex, u("u_tex"));
    gl.uniform2f(u("u_step"), plan.step / lv.w, 0);
    this.draw();
    this.bindSized(lv.a, lv.w, lv.h);
    this.bindTex(0, lv.b.tex, u("u_tex"));
    gl.uniform2f(u("u_step"), 0, plan.step / lv.h);
    this.draw();
    return { tex: lv.a.tex, w: lv.w, h: lv.h, spline: plan.levels > 0 };
  }

  /** The blur effect past its old maximum (ADR-069): `src` blurred by
   * `sigma` render pixels into `out`. */
  private bigBlur(src: Target, sigma: number, out: Target) {
    const gl = this.gl;
    const r = this.gaussian(src.tex, sigma);
    this.bindTarget(out);
    const u = this.use(this.program("blur:up", FULLSCREEN_VS, UP_FS));
    this.bindTex(0, r.tex, u("u_tex"));
    gl.uniform2f(u("u_size"), r.w, r.h);
    gl.uniform1i(u("u_spline"), r.spline ? 1 : 0);
    this.draw();
  }

  /** A drop shadow (ADR-070) under the finished layer `src`, into `out`. */
  private castShadow(src: Target, sh: DropShadow, out: Target) {
    const gl = this.gl;
    const k = this.height / 1080;
    const sigma = (sh.blur / 2) * k;
    const r = sigma >= 0.25 ? this.gaussian(src.tex, sigma) : { tex: src.tex, w: this.width, h: this.height, spline: false };
    this.bindTarget(out);
    const u = this.use(this.program("shadow", FULLSCREEN_VS, SHADOW_FS));
    this.bindTex(0, src.tex, u("u_layer"));
    this.bindTex(1, r.tex, u("u_blur"));
    gl.uniform2f(u("u_size"), r.w, r.h);
    gl.uniform1i(u("u_spline"), r.spline ? 1 : 0);
    // Pixels (y down) to uv (v up).
    gl.uniform2f(u("u_offset"), (sh.x * k) / this.width, (-sh.y * k) / this.height);
    const [cr, cg, cb, ca] = rgba(sh.color);
    const a = ca * sh.opacity;
    gl.uniform4f(u("u_color"), cr * a, cg * a, cb * a, a);
    this.draw();
  }

  /** A border (ADR-099) around the finished layer `src`, into `out`: the
   * picture's edge flooded out on two scratch targets, then the border drawn
   * outside the picture. `level` is the layer's opacity. */
  private castBorder(src: Target, b: Border, level: number, out: Target) {
    const gl = this.gl;
    const width = (b.width * this.height) / 1080;
    const lv = Math.max(level, 0.01);
    const [A, B] = (this.flood ??= [this.makeTarget(), this.makeTarget()]);
    this.bindTarget(A);
    let u = this.use(this.program("border:seed", FULLSCREEN_VS, FLOOD_SEED_FS));
    this.bindTex(0, src.tex, u("u_layer"));
    gl.uniform1f(u("u_level"), lv);
    this.draw();
    let [from, to] = [A, B];
    u = this.use(this.program("border:step", FULLSCREEN_VS, FLOOD_STEP_FS));
    for (const k of floodSteps(width)) {
      this.bindTarget(to);
      this.bindTex(0, from.tex, u("u_seeds"));
      gl.uniform1i(u("u_step"), k);
      this.draw();
      [from, to] = [to, from];
    }
    this.bindTarget(out);
    u = this.use(this.program("border", FULLSCREEN_VS, BORDER_FS));
    this.bindTex(0, src.tex, u("u_layer"));
    this.bindTex(1, from.tex, u("u_seeds"));
    gl.uniform1f(u("u_level"), lv);
    gl.uniform1f(u("u_width"), width);
    const [cr, cg, cb, ca] = rgba(b.color);
    const a = ca * b.opacity * Math.min(1, level);
    gl.uniform4f(u("u_color"), cr * a, cg * a, cb * a, a);
    this.draw();
  }

  /** Level `depth`'s three track-matte targets (draw, two effect temps). */
  private matteLevel(depth: number): Target[] {
    return (this.matteTargets[depth] ??= Array.from({ length: 3 }, () => this.makeTarget()));
  }

  /** The half-float target motion blur sums into, made on first use; null
   * without EXT_color_buffer_float (WebGL2 cannot render to floats then). */
  private accumTarget(): Target | null {
    if (this.accum !== undefined) return this.accum;
    const gl = this.gl;
    if (!gl.getExtension("EXT_color_buffer_float")) return (this.accum = null);
    const tex = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.width, this.height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      return (this.accum = null);
    }
    return (this.accum = { fb, tex });
  }

  /** Nesting level `depth`'s framebuffers (accum A/B, layer L1/L2, temp
   * T1/T2), made on first use. */
  private level(depth: number): Target[] {
    return (this.levels[depth] ??= Array.from({ length: 6 }, () => this.makeTarget()));
  }

  /** The `i`th finished-compound texture of level `depth`. */
  private bakedTarget(depth: number, i: number): Target {
    const list = (this.baked[depth] ??= []);
    return (list[i] ??= this.makeTarget());
  }

  private bindTarget(t: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null);
    gl.viewport(0, 0, this.width, this.height);
  }

  private clear(t: Target) {
    const gl = this.gl;
    this.bindTarget(t);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private bindTex(unit: number, tex: WebGLTexture, loc: WebGLUniformLocation | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  private draw() {
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  // ---- color uniforms ------------------------------------------------------------

  private setColorUniforms(u: (n: string) => WebGLUniformLocation | null, adjust: Layer["adjust"], tone: Tone | undefined, time: number, grade: GradeParams | undefined) {
    const gl = this.gl;
    const k = (v: number) => v / 100;
    gl.uniform1f(u("u_exposure"), k(adjust.exposure));
    gl.uniform1f(u("u_brightness"), k(adjust.brightness));
    gl.uniform1f(u("u_contrast"), k(adjust.contrast));
    gl.uniform1f(u("u_saturation"), k(adjust.saturation));
    gl.uniform1f(u("u_vibrance"), k(adjust.vibrance));
    gl.uniform1f(u("u_temperature"), k(adjust.temperature));
    gl.uniform1f(u("u_tint"), k(adjust.tint));
    gl.uniform1f(u("u_highlights"), k(adjust.highlights));
    gl.uniform1f(u("u_shadows"), k(adjust.shadows));
    gl.uniform1f(u("u_whites"), k(adjust.whites));
    gl.uniform1f(u("u_blacks"), k(adjust.blacks));
    gl.uniform1f(u("u_hue"), adjust.hue / 180);
    gl.uniform1f(u("u_fade"), k(adjust.fade));
    gl.uniform1f(u("u_vignette"), k(adjust.vignette));
    gl.uniform1f(u("u_grain"), k(adjust.grain));
    gl.uniform3fv(u("u_toneShadows"), tone?.shadows ?? [0.5, 0.5, 0.5]);
    gl.uniform3fv(u("u_toneHighlights"), tone?.highlights ?? [0.5, 0.5, 0.5]);
    gl.uniform1f(u("u_toneAmount"), tone?.amount ?? 0);
    gl.uniform1f(u("u_time"), time);
    this.setGradeUniforms(u, grade);
  }

  /** The grade's uniforms and tables (texture units 1..3; unit 0 is the
   * pass's own input). */
  private setGradeUniforms(u: (n: string) => WebGLUniformLocation | null, g: GradeParams | undefined) {
    const gl = this.gl;
    gl.uniform1i(u("u_curvesOn"), g?.curves ? 1 : 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, g?.curves ? this.curveTexture(g.curves) : this.blank());
    gl.uniform1i(u("u_curves"), 1);
    const w = g?.wheels;
    gl.uniform1i(u("u_wheelsOn"), w ? 1 : 0);
    if (w) {
      gl.uniform3fv(u("u_lift"), w.lift);
      gl.uniform3fv(u("u_gamma"), w.gamma);
      gl.uniform3fv(u("u_gain"), w.gain);
      gl.uniform3fv(u("u_offset"), w.offset);
    }
    gl.uniform1i(u("u_hslOn"), g?.hsl ? 1 : 0);
    if (g?.hsl) gl.uniform3fv(u("u_hsl"), g.hsl);
    gl.uniform1f(u("u_colorizeAmount"), g?.colorize?.amount ?? 0);
    if (g?.colorize) gl.uniform3fv(u("u_colorize"), g.colorize.rgb);
    // LUT: 1D on unit 2, 3D on unit 3. A sampler3D must never share a unit
    // with a sampler2D, so both always point at their own units.
    const lut = g?.lut ? this.lutTexture(g.lut.src) : null;
    gl.uniform1i(u("u_lutKind"), lut ? (lut.lut.kind === "3d" ? 2 : 1) : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, lut?.lut.kind === "1d" ? lut.tex : this.blank());
    gl.uniform1i(u("u_lut1d"), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, lut?.lut.kind === "3d" ? lut.tex : this.blankVolume());
    gl.uniform1i(u("u_lut3d"), 3);
    if (lut) {
      gl.uniform1f(u("u_lutAmount"), g!.lut!.intensity);
      gl.uniform1f(u("u_lutSize"), lut.width);
      gl.uniform3fv(u("u_lutMin"), lut.lut.domainMin);
      gl.uniform3fv(u("u_lutMax"), lut.lut.domainMax);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  private blankVolume(): WebGLTexture {
    if (this.blank3d) return this.blank3d;
    const gl = this.gl;
    this.blank3d = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, this.blank3d);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, 1, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return this.blank3d;
  }

  /** Upload a LUT once: 3D tables as an RGB16F volume (hardware trilinear),
   * 1D tables as a strip. Half floats keep 11 bits, well past 8-bit output. */
  private lutTexture(src: string) {
    const lut = lutFor(src);
    if (!lut) return null;
    const hit = this.lutTextures.get(src);
    if (hit?.lut === lut) return hit;
    const gl = this.gl;
    if (hit) gl.deleteTexture(hit.tex);
    const tex = gl.createTexture()!;
    let width = lut.size;
    if (lut.kind === "3d") {
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_3D, tex);
      for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    } else {
      const data = fit1d(lut);
      width = data.length / 3;
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, width, 1, 0, gl.RGB, gl.FLOAT, data);
    }
    const entry = { lut, tex, width };
    this.lutTextures.set(src, entry);
    return entry;
  }

  private blank(): WebGLTexture {
    if (this.blank2d) return this.blank2d;
    const gl = this.gl;
    this.blank2d = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    return this.blank2d;
  }

  private curveTexture(c: NonNullable<GradeParams["curves"]>): WebGLTexture {
    const key = JSON.stringify(c);
    const hit = this.curveTextures.get(key);
    if (hit) return hit;
    const gl = this.gl;
    const tex = this.makeTexture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bakeCurves(c));
    this.curveTextures.set(key, tex);
    // A curve drag bakes a table per pointer move; keep only recent ones.
    if (this.curveTextures.size > 64) {
      const [oldKey, oldTex] = this.curveTextures.entries().next().value!;
      gl.deleteTexture(oldTex);
      this.curveTextures.delete(oldKey);
    }
    return tex;
  }

  // ---- passes -------------------------------------------------------------------

  /** Upload a source and return its texture. Keyed sources upload once;
   * `fresh` false reuses what the slot already holds (the same frame drawn
   * again at another shutter placement). */
  private sourceTexture(src: SourceImage, slot: number, fresh = true): WebGLTexture {
    const gl = this.gl;
    if (src.key) {
      const hit = this.sourceTextures.get(src.key);
      if (hit) return hit;
    } else if (!fresh && this.slotTextures[slot]) return this.slotTextures[slot];
    const tex = src.key ? this.makeTexture() : (this.slotTextures[slot] ??= this.makeTexture());
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // Full texImage2D re-spec (not texSubImage2D) keeps Chrome's zero-copy
    // VideoFrame upload path (docs/research/Web media engine.md §3.1).
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src.image);
    if (src.key) {
      this.sourceTextures.set(src.key, tex);
      if (this.sourceTextures.size > 256) {
        const [oldKey, oldTex] = this.sourceTextures.entries().next().value!;
        gl.deleteTexture(oldTex);
        this.sourceTextures.delete(oldKey);
      }
    }
    return tex;
  }

  /** Draw one layer's source into `out` (cleared first). With motion
   * blur, it is drawn at each shutter placement into the half-float target
   * at its share of the opacity, and the sum copied into `out` (ADR-058). */
  private drawLayer(layer: Layer, src: DrawSource | null, out: Target, slot: number, fresh = true) {
    const gl = this.gl;
    const W = this.width;
    const H = this.height;
    // Motion blur's target is made (and binds its texture) before any of
    // the layer's own textures are bound.
    const samples = layer.motion && layer.motion.length > 1 ? layer.motion : null;
    const acc = samples ? this.accumTarget() : null;
    // Frame blending's next frame uploads first, while unit 0 is free.
    const next = src && !isRendered(src) ? src.next : undefined;
    gl.activeTexture(gl.TEXTURE0);
    const nextTex = next && src && !isRendered(src) ? this.sourceTexture({ ...src, image: next.image, key: undefined, next: undefined } as SourceImage, slot + NEXT_SLOTS, fresh) : null;
    const shape = layer.source.kind === "shape" ? layer.source.shape : undefined;
    const p = shape ? this.program("layer:shape", LAYER_VS, LAYER_SHAPE_FS) : this.program("layer", LAYER_VS, LAYER_FS);
    const u = this.use(p);

    let sw: number, sh: number, fit: number;
    const solid = layer.source.kind === "color";
    if (shape) {
      // A shape's pixels at scale 1 are the canvas's (ADR-057): the quad
      // holds its box, its stroke and two screen pixels of soft edge.
      // A feather's soft edge reaches past the outline too (ADR-069).
      const e = shapeExtent(shape, W, H);
      const m = 2 / Math.max(0.05, Math.min(Math.abs(layer.scale), Math.abs(layer.scaleY ?? layer.scale))) + featherReach(shape.feather, H);
      sw = e.w + 2 * m;
      sh = e.h + 2 * m;
      fit = 1;
    } else if (solid || !src || isRendered(src)) {
      // A compound's picture is the canvas itself.
      sw = W;
      sh = H;
      fit = 1;
    } else {
      sw = src.width;
      sh = src.height;
      fit = src.native ? 1 : Math.min(W / sw, H / sh);
    }
    const { left, top, right, bottom } = layer.crop;
    const fx = layer.flipX ? -1 : 1;
    const fy = layer.flipY ? -1 : 1;
    /** Where the layer sits at placement `t`: the affine map from layer
     * units to clip space, the visible size, and the quad's extent. */
    const geometry = (t: Placement) => {
      const visW = sw * fit * t.scale * (1 - left - right);
      const scaleY = t.scaleY ?? t.scale;
      const visH = sh * fit * scaleY * (1 - top - bottom);
      // Cropping keeps the uncropped image where it was, so the visible part's
      // center shifts by half the difference of the trimmed edges. The crop is
      // cut from the source before the flip, so the shift mirrors with the
      // picture (ADR-048).
      const shiftX = ((left - right) / 2) * sw * fit * t.scale * fx;
      const shiftY = ((top - bottom) / 2) * sh * fit * scaleY * fy;
      const rad = (t.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const sx = visW * fx;
      const sy = visH * fy;
      // pixel position (y down) of quad point (a, b) in 0..1:
      //   P = C + R * ((a - 0.5) * sx + shift.x, (b - 0.5) * sy + shift.y)
      const cx = W / 2 + t.x * W;
      const cy = H / 2 + t.y * H;
      // Build the affine matrix mapping (a, b, 1) -> pixels, then to clip space.
      const m00 = cos * sx, m01 = -sin * sy;
      const m10 = sin * sx, m11 = cos * sy;
      const ox = cx + cos * (-0.5 * sx + shiftX) - sin * (-0.5 * sy + shiftY);
      const oy = cy + sin * (-0.5 * sx + shiftX) + cos * (-0.5 * sy + shiftY);
      // pixels -> clip: x' = x / W * 2 - 1, y' = 1 - y / H * 2
      const ax = 2 / W, ay = -2 / H;
      // A tilted picture (ADR-070) maps by a homography; its edge mode's
      // copies are not drawn (ponytail: the extent is solved for flat maps).
      if (layer.tilt) {
        const mat = new Float32Array(tiltMatrix({ cx, cy, sx, sy, shiftX, shiftY, rotation: t.rotation }, { ...layer.tilt, distance: (layer.tilt.distance * H) / 1080 }, W, H));
        return { mat, visW, visH, extent: [0, 0, 1, 1] };
      }
      // column-major mat3
      const mat = new Float32Array([
        m00 * ax, m10 * ay, 0,
        m01 * ax, m11 * ay, 0,
        ox * ax - 1, oy * ay + 1, 1,
      ]);
      const extent = (layer.edge && edgeExtent(m00, m01, m10, m11, ox, oy, W, H)) || [0, 0, 1, 1];
      return { mat, visW, visH, extent };
    };
    const place = (t: Placement) => {
      const g = geometry(t);
      gl.uniformMatrix3fv(u("u_matrix"), false, g.mat);
      gl.uniform4fv(u("u_extent"), g.extent);
      gl.uniform1f(u("u_maskAspect"), Math.abs(g.visH) > 1e-6 ? Math.abs(g.visW / g.visH) : 1);
    };
    gl.uniform4f(u("u_crop"), left, top, 1 - right, 1 - bottom);
    gl.uniformMatrix3fv(u("u_uv"), false, uvMatrix(src && !isRendered(src) ? src.rotation : 0, isRendered(src)));
    gl.uniform1i(u("u_fbo"), isRendered(src) ? 1 : 0);
    gl.uniform1i(u("u_solid"), solid || shape || !src ? 1 : 0);
    gl.uniform1i(u("u_edge"), layer.edge === "mirror" ? 1 : layer.edge === "repeat" ? 2 : 0);
    if (layer.source.kind === "color") {
      // Any CSS color, its alpha too (ADR-110): read as hex only, a solid
      // at #ff000080 drew opaque red, and "red" or rgba() drew black.
      gl.uniform4fv(u("u_color"), rgba(layer.source.color));
    } else gl.uniform4f(u("u_color"), 0, 0, 0, 0);
    this.setShapeUniforms(u, layer, sw, sh);
    let mainTex: WebGLTexture | null = null;
    // Solids and shapes sample nothing, but unit 0 must not hold the
    // target being drawn (a feedback loop WebGL refuses to draw).
    if (solid || shape || !src) this.bindTex(0, this.blank(), u("u_tex"));
    if (isRendered(src)) {
      mainTex = src.rendered.tex;
      this.bindTex(0, mainTex, u("u_tex"));
      gl.uniform2f(u("u_texel"), 1 / W, 1 / H);
    } else if (src && !solid && !shape) {
      mainTex = this.sourceTexture(src, slot, fresh);
      this.bindTex(0, mainTex, u("u_tex"));
      const tw = src.rotation % 2 ? src.height : src.width;
      const th = src.rotation % 2 ? src.width : src.height;
      gl.uniform2f(u("u_texel"), 1 / tw, 1 / th);
    }
    // Unit 4: the matte (units 1..3 are the grade's tables). A compound's
    // picture has none.
    const matte = src && !isRendered(src) ? src.matte : undefined;
    gl.uniform1i(u("u_matteOn"), matte ? 1 : 0);
    gl.activeTexture(gl.TEXTURE4);
    if (matte) {
      gl.bindTexture(gl.TEXTURE_2D, (this.matteTextures[slot] ??= this.makeTexture()));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, matte);
    } else gl.bindTexture(gl.TEXTURE_2D, this.blank());
    gl.uniform1i(u("u_matte"), 4);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(u("u_sharpen"), layer.adjust.sharpen / 100);
    const key = layer.chromaKey;
    gl.uniform1i(u("u_key"), key ? 1 : 0);
    if (key) {
      gl.uniform3fv(u("u_keyColor"), hexToRgb(key.color));
      gl.uniform1f(u("u_keySimilarity"), key.similarity);
      gl.uniform1f(u("u_keySmoothness"), key.smoothness);
      gl.uniform1f(u("u_keySpill"), key.spill);
    }
    const mask = layer.mask;
    gl.uniform1i(u("u_maskShape"), mask ? (MASK_SHAPES[mask.shape] ?? 0) : 0);
    if (mask) {
      gl.uniform2f(u("u_maskCenter"), mask.x, mask.y);
      gl.uniform2f(u("u_maskSize"), mask.width, mask.height);
      gl.uniform1f(u("u_maskRotation"), (mask.rotation * Math.PI) / 180);
      gl.uniform1f(u("u_maskFeather"), mask.feather);
      gl.uniform1f(u("u_maskRadius"), mask.shape === "rectangle" ? Math.max(0, Math.min(1, mask.radius ?? 0)) : 0);
      gl.uniform1i(u("u_maskInvert"), mask.invert ? 1 : 0);
    }
    this.setColorUniforms(u, layer.adjust, layer.tone, layer.time, layer.grade);

    if (!samples || !acc) {
      this.clear(out);
      gl.disable(gl.BLEND);
      place(layer);
      gl.uniform1f(u("u_opacity"), layer.opacity);
      this.draw();
      // Frame blending: the same quad and pass with the next frame, mixed in
      // by a constant share (alpha included, so edges and keys mix too).
      if (next && nextTex) {
        this.bindTex(0, nextTex, u("u_tex"));
        gl.enable(gl.BLEND);
        gl.blendColor(0, 0, 0, next.w);
        gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
        this.draw();
        gl.disable(gl.BLEND);
      }
      return;
    }
    // Motion blur: each placement adds its share; premultiplied, so the
    // sum is the average of the pictures, edges and all.
    this.clear(acc);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const k = layer.opacity / samples.length;
    for (const t of samples) {
      place(t);
      if (next && nextTex && mainTex) {
        this.bindTex(0, mainTex, u("u_tex"));
        gl.uniform1f(u("u_opacity"), k * (1 - next.w));
        this.draw();
        this.bindTex(0, nextTex, u("u_tex"));
        gl.uniform1f(u("u_opacity"), k * next.w);
      } else gl.uniform1f(u("u_opacity"), k);
      this.draw();
    }
    gl.disable(gl.BLEND);
    this.bindTarget(out);
    const c = this.use(this.program("copy", FULLSCREEN_VS, COPY_FS));
    this.bindTex(0, acc.tex, c("u_tex"));
    this.draw();
  }

  /** A shape layer's uniforms (ADR-057), in render pixels; u_shape 0 for
   * every other layer. */
  private setShapeUniforms(u: (n: string) => WebGLUniformLocation | null, layer: Layer, quadW: number, quadH: number) {
    const gl = this.gl;
    const s = layer.source.kind === "shape" ? layer.source : null;
    gl.uniform1i(u("u_shape"), s ? SHAPE_IDS[s.shape.kind] : 0);
    gl.uniform2f(u("u_shapeQuad"), quadW, quadH);
    if (!s) return;
    const sh = s.shape;
    const W = this.width, H = this.height;
    const stroke = strokePx(sh, H);
    const line = sh.kind === "line";
    const bx = (sh.width * W) / 2, by = line ? stroke / 2 : (sh.height * H) / 2;
    gl.uniform2f(u("u_shapeBox"), bx, by);
    gl.uniform1f(u("u_shapeRadius"), sh.kind === "rectangle" ? sh.radius * Math.min(bx, by) : 0);
    gl.uniform1f(u("u_shapeStroke"), line ? 0 : stroke);
    gl.uniform1f(u("u_shapeDraw"), sh.draw);
    gl.uniform1i(u("u_shapeFill"), !line && sh.fill !== false ? 1 : 0);
    // A line is painted with its gradient, else its stroke's color, else
    // the clip's; a rectangle or ellipse fills with the gradient or color.
    const solid = line && sh.stroke ? sh.stroke.color : s.color;
    const g = sh.gradient;
    gl.uniform4fv(u("u_fill"), rgba(g ? g.from : solid));
    gl.uniform4fv(u("u_fill2"), rgba(g ? g.to : solid));
    gl.uniform1i(u("u_gradient"), g ? 1 : 0);
    const a = ((g?.angle ?? 0) * Math.PI) / 180;
    gl.uniform2f(u("u_gradDir"), Math.cos(a), Math.sin(a));
    // Radial (ADR-069): the center moved by fractions of the box, radii a
    // fraction of its half size.
    const radial = g?.kind === "radial";
    gl.uniform1i(u("u_gradKind"), radial ? 1 : 0);
    gl.uniform2f(u("u_gradCenter"), radial ? (g.x ?? 0) * 2 * bx : 0, radial ? (g.y ?? 0) * 2 * by : 0);
    gl.uniform2f(u("u_gradRadius"), bx * (g?.radius ?? 1), by * (g?.radius ?? 1));
    gl.uniform1f(u("u_shapeFeather"), (sh.feather * H) / 1080);
    gl.uniform4fv(u("u_strokeColor"), rgba(sh.stroke?.color ?? s.color));
  }

  /** Keep `src` where the matte (premultiplied; null: no picture) is
   * opaque or bright, or the reverse, into `out` (ADR-056). */
  private applyMatte(src: Target, matte: Target | null, mode: MatteMode, out: Target) {
    const gl = this.gl;
    this.bindTarget(out);
    const u = this.use(this.program("matte", FULLSCREEN_VS, MATTE_FS));
    this.bindTex(0, src.tex, u("u_src"));
    this.bindTex(1, matte ? matte.tex : this.blank(), u("u_matte"));
    gl.uniform1i(u("u_hasMatte"), matte ? 1 : 0);
    gl.uniform1i(u("u_mode"), MATTE_IDS[mode] ?? 0);
    this.draw();
  }

  /** Run effects over `t`, ping-ponging between two temps (both distinct
   * from `t`); returns whichever target holds the result. */
  private applyEffects(effects: ResolvedEffect[], t: Target, time: number, temps: [Target, Target]): Target {
    const gl = this.gl;
    let cur = t;
    let i = 0;
    const pass = (type: string, params: Record<string, number>) => {
      const fs = EFFECT_SHADERS[type];
      if (!fs) return;
      const dest = temps[i++ % 2];
      this.bindTarget(dest);
      const u = this.use(this.program(`fx:${type}`, FULLSCREEN_VS, fs));
      this.bindTex(0, cur.tex, u("u_tex"));
      gl.uniform2f(u("u_res"), this.width, this.height);
      gl.uniform1f(u("u_time"), time);
      // Pixel-sized params are authored at 1080p; scale to the render size.
      gl.uniform1f(u("u_scale"), this.height / 1080);
      for (const [k, v] of Object.entries(params)) gl.uniform1f(u(`u_${k}`), v);
      this.draw();
      cur = dest;
    };
    for (const e of effects) {
      if (e.type === "blur" && usesPyramid(e.params.amount)) {
        // Past the old maximum: the pyramid (ADR-069). Up to it, the two
        // passes below draw exactly what they always have.
        const dest = temps[i++ % 2];
        this.bigBlur(cur, blurSigma(e.params.amount) * (this.height / 1080), dest);
        cur = dest;
      } else if (e.type === "blur") {
        pass("blur", { ...e.params, dirX: 1, dirY: 0 });
        pass("blur", { ...e.params, dirX: 0, dirY: 1 });
      } else pass(e.type, e.params);
    }
    return cur;
  }

  private blendInto(accum: Target, layer: Target, mode: BlendMode, out: Target) {
    const gl = this.gl;
    this.bindTarget(out);
    const u = this.use(this.program("blend", FULLSCREEN_VS, BLEND_FS));
    this.bindTex(0, accum.tex, u("u_dst"));
    this.bindTex(1, layer.tex, u("u_src"));
    gl.uniform1i(u("u_mode"), BLEND_IDS[mode] ?? 0);
    this.draw();
  }

  /**
   * Draw a plan. `sources` resolves a layer to its pixels (decoded video
   * frame, image, text raster); returning null draws nothing for that
   * layer. Video frames may be closed as soon as this returns.
   */
  render(plan: PlanItem[], sources: (l: Layer) => SourceImage | null, background: string) {
    const gl = this.gl;
    const accum = this.composite(plan, sources, 0, { n: 0 });
    this.bindTarget(null);
    const u = this.use(this.program("present", FULLSCREEN_VS, PRESENT_FS));
    this.bindTex(0, accum.tex, u("u_tex"));
    gl.uniform3fv(u("u_background"), hexToRgb(background));
    this.draw();
  }

  /** Present only the left/top of a second picture. Intermediate passes
   * remain full-frame; scissoring is restricted to the final presentation. */
  compare(plan: PlanItem[] | null, bitmap: ImageBitmap | null, sources: (l: Layer) => SourceImage | null, background: string, split: number, horizontal: boolean) {
    const gl = this.gl;
    let tex: WebGLTexture;
    if (plan) tex = this.composite(plan, sources, 0, { n: 0 }).tex;
    else if (bitmap) {
      if (this.compareBitmap !== bitmap) {
        this.clearCompare();
        this.compareTexture = this.makeTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.compareTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        this.compareBitmap = bitmap;
      }
      tex = this.compareTexture!;
    } else return;
    this.bindTarget(null);
    const fs = plan ? PRESENT_FS : PRESENT_FS.replace("texture(u_tex, v_uv)", "texture(u_tex, vec2(v_uv.x, 1.0 - v_uv.y))");
    const u = this.use(this.program(plan ? "present" : "compare-reference", FULLSCREEN_VS, fs));
    this.bindTex(0, tex, u("u_tex"));
    gl.uniform3fv(u("u_background"), hexToRgb(background));
    gl.enable(gl.SCISSOR_TEST);
    const t = Math.max(0, Math.min(1, split));
    if (horizontal) {
      const h = Math.round(this.height * t);
      gl.scissor(0, this.height - h, this.width, h);
    } else gl.scissor(0, 0, Math.round(this.width * t), this.height);
    try { this.draw(); } finally { gl.disable(gl.SCISSOR_TEST); }
  }

  clearCompare() {
    if (this.compareTexture) this.gl.deleteTexture(this.compareTexture);
    this.compareTexture = null;
    this.compareBitmap = null;
  }

  /** Composite a plan with nesting level `depth`'s framebuffers. Returns
   * the target holding the premultiplied result, transparent where nothing
   * was drawn. `slot` numbers the unkeyed source uploads of the frame. */
  private composite(plan: PlanItem[], sources: (l: Layer) => SourceImage | null, depth: number, slot: { n: number }): Target {
    const gl = this.gl;
    // Compound clips' pictures first, each copied into a texture of its
    // own: the next one reuses the deeper level's framebuffers.
    const rendered = new Map<Layer, RenderedSource>();
    let baked = 0;
    for (const item of plan) {
      const own = item.kind === "layer" ? [item.layer] : item.kind === "transition" ? [item.from, item.to] : [];
      // A track matte's layer may be a compound clip too.
      const layers = [...own, ...own.flatMap((l) => (l.trackMatte?.layer ? [l.trackMatte.layer] : []))];
      for (const l of layers) {
        if (l.source.kind !== "compound") continue;
        const result = this.composite(l.source.items, sources, depth + 1, slot);
        const own = this.bakedTarget(depth, baked++);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, result.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, own.fb);
        gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        rendered.set(l, { rendered: own });
      }
    }
    const [A, B, L1, L2, T1, T2] = this.level(depth);
    let accum = A;
    let spare = B;
    this.clear(accum);

    const sourceOf = (l: Layer): DrawSource | null =>
      l.source.kind === "color" || l.source.kind === "shape" ? null : l.source.kind === "compound" ? (rendered.get(l) ?? null) : sources(l);
    const drawable = (l: Layer, src: DrawSource | null) => l.source.kind === "color" || l.source.kind === "shape" || !!src;
    /** A layer drawn into one of `target` and `temps` (whichever ends up
     * holding it is returned): source, effects, then its track matte, which
     * draws into the level's own matte targets. */
    const layerToTarget = (layer: Layer, src: DrawSource | null, target: Target, temps: [Target, Target]): Target => {
      const all = [target, ...temps];
      // The track matte first, into the level's own matte targets. The
      // matte layer is planned without a matte of its own, so this never
      // recurses further.
      const tm = layer.trackMatte;
      let matte: Target | null = null;
      if (tm?.layer) {
        const [M1, M2, M3] = this.matteLevel(depth);
        const msrc = sourceOf(tm.layer);
        if (drawable(tm.layer, msrc)) matte = layerToTarget(tm.layer, msrc, M1, [M2, M3]);
      }
      /** The picture at one placement (or blurred over its shutter):
       * source, effects, matte, then its border (ADR-099), outside the
       * picture as it is now, before the shadow, which it casts too. */
      const picture = (one: Layer, at: number, fresh: boolean): Target => {
        this.drawLayer(one, src, target, at, fresh);
        // An animation's blur (px at 1080p) rides on the blur effect: radius = amount * 0.6.
        const fx = one.blur > 0.5 ? [...one.effects, { type: "blur", params: { amount: one.blur / 0.6 } }] : one.effects;
        const done = fx.length ? this.applyEffects(fx, target, one.time, temps) : target;
        let cut = done;
        if (tm) {
          cut = all.find((t) => t !== done)!;
          this.applyMatte(done, matte, tm.mode, cut);
        }
        if (one.border) {
          const framed = all.find((t) => t !== cut)!;
          this.castBorder(cut, one.border, one.opacity, framed);
          cut = framed;
        }
        return cut;
      };
      // A framed picture with motion blur is framed at each placement and
      // the framed pictures averaged, so its border blurs with it, as After
      // Effects blurs a layer's stroke (ADR-110). Framed once, the blurred
      // picture got a crisp border around its half-covered contour.
      // ponytail: its effects and border run once per sample (up to 32 on
      // export, 6 playing); only a framed picture that moves pays that.
      const samples = layer.border && layer.motion && layer.motion.length > 1 ? layer.motion : null;
      const acc = samples ? this.accumTarget() : null;
      let cut: Target;
      if (samples && acc) {
        const at = slot.n++;
        this.clear(acc);
        samples.forEach((t, i) => {
          const one = picture({ ...layer, ...t, motion: undefined }, at, i === 0);
          this.bindTarget(acc);
          const c = this.use(this.program("copy", FULLSCREEN_VS, COPY_FS));
          this.bindTex(0, one.tex, c("u_tex"));
          gl.enable(gl.BLEND);
          gl.blendColor(0, 0, 0, 1 / samples.length);
          gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE);
          this.draw();
          gl.disable(gl.BLEND);
        });
        cut = target;
        this.bindTarget(cut);
        const c = this.use(this.program("copy", FULLSCREEN_VS, COPY_FS));
        this.bindTex(0, acc.tex, c("u_tex"));
        this.draw();
      } else cut = picture(layer, slot.n++, true);
      // The drop shadow last (ADR-070): cast by the picture as it is now.
      if (!layer.shadow) return cut;
      const out = all.find((t) => t !== cut)!;
      this.castShadow(cut, layer.shadow, out);
      return out;
    };

    for (const item of plan) {
      if (item.kind === "layer") {
        const src = sourceOf(item.layer);
        if (!drawable(item.layer, src)) continue;
        const result = layerToTarget(item.layer, src, L1, [T1, T2]);
        this.blendInto(accum, result, item.layer.blend, spare);
        [accum, spare] = [spare, accum];
      } else if (item.kind === "transition") {
        const a = layerToTarget(item.from, sourceOf(item.from), L1, [T1, T2]);
        // The outgoing side may have landed in a temp; keep it out of the way
        // of the incoming side's effect passes.
        const aIn = a;
        const bTemps: [Target, Target] = aIn === T1 ? [T2, L1] : aIn === T2 ? [T1, L1] : [T1, T2];
        const b = layerToTarget(item.to, sourceOf(item.to), L2, bTemps);
        const out = [L1, L2, T1, T2].find((t) => t !== aIn && t !== b)!;
        this.bindTarget(out);
        // A moving transition with motion blur has its own program, built on
        // first use: the plain one stays as quick to compile as it was.
        const u = this.use(item.motion ? this.program("transition:blur", FULLSCREEN_VS, TRANSITION_BLUR_FS) : this.program("transition", FULLSCREEN_VS, TRANSITION_FS));
        this.bindTex(0, aIn.tex, u("u_a"));
        this.bindTex(1, b.tex, u("u_b"));
        gl.uniform1f(u("u_p"), item.progress);
        gl.uniform1i(u("u_type"), TRANSITION_IDS[item.type] ?? 0);
        if (item.motion) {
          gl.uniform1i(u("u_samples"), item.motion.samples);
          gl.uniform1f(u("u_spread"), item.motion.spread);
        }
        gl.uniform2f(u("u_res"), this.width, this.height);
        this.draw();
        this.blendInto(accum, out, "normal", spare);
        [accum, spare] = [spare, accum];
      } else {
        // Adjustment layer: grade everything below, then mix by opacity.
        this.bindTarget(L1);
        const u = this.use(this.program("adjust", FULLSCREEN_VS, ADJUST_FS));
        this.bindTex(0, accum.tex, u("u_tex"));
        this.setColorUniforms(u, item.adjust, item.tone, item.time, item.grade);
        this.draw();
        const graded = item.effects.length ? this.applyEffects(item.effects, L1, item.time, [T1, T2]) : L1;
        this.bindTarget(spare);
        const m = this.use(this.program("mix", FULLSCREEN_VS, MIX_FS));
        this.bindTex(0, accum.tex, m("u_a"));
        this.bindTex(1, graded.tex, m("u_b"));
        gl.uniform1f(m("u_t"), item.opacity);
        this.draw();
        [accum, spare] = [spare, accum];
      }
    }
    return accum;
  }

  /** Read the presented frame back as RGBA rows, top row first. For scopes,
   * thumbnails and tests; slow, never in the playback path. */
  readPixels(): Uint8Array {
    const gl = this.gl;
    const out = new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return flipRows(out, this.width, this.height);
  }

  /** The presented frame scaled down on the GPU to at most `maxWidth`
   * pixels wide, then read back (rows top first). For scopes: reading a
   * 320-pixel frame stalls the GPU for a fraction of a full-size read. */
  readPixelsScaled(maxWidth: number): { width: number; height: number; data: Uint8Array } {
    if (maxWidth >= this.width) return { width: this.width, height: this.height, data: this.readPixels() };
    const gl = this.gl;
    const w = Math.max(1, Math.round(maxWidth));
    const h = Math.max(1, Math.round((this.height * w) / this.width));
    if (!this.small || this.small.w !== w || this.small.h !== h) {
      if (this.small) {
        gl.deleteFramebuffer(this.small.fb);
        gl.deleteRenderbuffer(this.small.rb);
      }
      const rb = gl.createRenderbuffer()!;
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      this.small = { fb, rb, w, h };
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.small.fb);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.small.fb);
    const out = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: w, height: h, data: flipRows(out, w, h) };
  }

  /** Forget a cached source texture (text changed, image removed). */
  forget(key: string) {
    const tex = this.sourceTextures.get(key);
    if (tex) this.gl.deleteTexture(tex);
    this.sourceTextures.delete(key);
  }

  /** Free GPU objects. The context itself stays alive: a canvas hands the
   * same context back on the next getContext, so losing it here would leave
   * a re-mounted viewer (React StrictMode mounts twice) with a dead one. */
  dispose() {
    this.disposed = true;
    const gl = this.gl;
    this.freeTargets();
    this.clearCompare();
    for (const tex of [...this.sourceTextures.values(), ...this.slotTextures, ...this.matteTextures, ...this.curveTextures.values()]) gl.deleteTexture(tex);
    for (const { tex } of this.lutTextures.values()) gl.deleteTexture(tex);
    if (this.blank2d) gl.deleteTexture(this.blank2d);
    if (this.blank3d) gl.deleteTexture(this.blank3d);
    this.blank2d = this.blank3d = null;
    this.curveTextures.clear();
    this.lutTextures.clear();
    if (this.small) {
      gl.deleteFramebuffer(this.small.fb);
      gl.deleteRenderbuffer(this.small.rb);
      this.small = null;
    }
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.sourceTextures.clear();
    this.slotTextures = [];
    this.matteTextures = [];
    this.programs.clear();
    this.width = this.height = 0;
  }
}
