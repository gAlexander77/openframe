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
// Preview and export share this class; only the canvas and size differ.

import { bakeCurves } from "../lib/curves";
import type { GradeParams } from "../lib/grade";
import type { BlendMode } from "../lib/project/types";
import type { Layer, PlanItem, ResolvedEffect, Tone } from "../lib/render/plan";
import {
  ADJUST_FS,
  BLEND_FS,
  BLEND_IDS,
  EFFECT_SHADERS,
  FULLSCREEN_VS,
  LAYER_FS,
  LAYER_VS,
  MIX_FS,
  PRESENT_FS,
  TRANSITION_FS,
  TRANSITION_IDS,
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
}

type Program = { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> };

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

const MASK_SHAPES = { linear: 1, mirror: 2, circle: 3, rectangle: 4 } as const;

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0");
  const v = parseInt(n.slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export class Compositor {
  readonly gl: WebGL2RenderingContext;
  private quad: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private programs = new Map<string, Program>();
  private targets: Target[] = [];
  private width = 0;
  private height = 0;
  /** Textures for sources, by key (stable sources) or by slot. */
  private sourceTextures = new Map<string, WebGLTexture>();
  private slotTextures: WebGLTexture[] = [];
  /** Baked curve tables by their points (JSON), and a neutral 1x1 bound
   * when a grade part is off so no sampler is ever left without one. */
  private curveTextures = new Map<string, WebGLTexture>();
  private blank2d: WebGLTexture | null = null;

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
    const cached = this.programs.get(key);
    if (cached) return cached;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`shader ${key}: ${gl.getShaderInfoLog(sh)}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, "a_pos");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program ${key}: ${gl.getProgramInfoLog(prog)}`);
    }
    const p = { prog, loc: new Map<string, WebGLUniformLocation | null>() };
    this.programs.set(key, p);
    return p;
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
    const gl = this.gl;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    // accum A/B, layer L1/L2, temp T1/T2
    this.targets = Array.from({ length: 6 }, () => {
      const tex = this.makeTexture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fb, tex };
    });
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
    gl.activeTexture(gl.TEXTURE0);
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

  /** Upload a source and return its texture. Keyed sources upload once. */
  private sourceTexture(src: SourceImage, slot: number): WebGLTexture {
    const gl = this.gl;
    if (src.key) {
      const hit = this.sourceTextures.get(src.key);
      if (hit) return hit;
    }
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

  /** Draw one layer's source into `out` (cleared first). */
  private drawLayer(layer: Layer, src: SourceImage | null, out: Target, slot: number) {
    const gl = this.gl;
    this.clear(out);
    const p = this.program("layer", LAYER_VS, LAYER_FS);
    const u = this.use(p);
    const W = this.width;
    const H = this.height;

    let sw: number, sh: number, fit: number;
    const solid = layer.source.kind === "color";
    if (solid || !src) {
      sw = W;
      sh = H;
      fit = 1;
    } else {
      sw = src.width;
      sh = src.height;
      fit = src.native ? 1 : Math.min(W / sw, H / sh);
    }
    const { left, top, right, bottom } = layer.crop;
    const visW = sw * fit * layer.scale * (1 - left - right);
    const visH = sh * fit * layer.scale * (1 - top - bottom);
    // Cropping keeps the uncropped image where it was, so the visible part's
    // center shifts by half the difference of the trimmed edges.
    const shiftX = ((left - right) / 2) * sw * fit * layer.scale;
    const shiftY = ((top - bottom) / 2) * sh * fit * layer.scale;
    const rad = (layer.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const sx = visW * (layer.flipX ? -1 : 1);
    const sy = visH * (layer.flipY ? -1 : 1);
    // pixel position (y down) of quad point (a, b) in 0..1:
    //   P = C + R * ((a - 0.5) * sx + shift.x, (b - 0.5) * sy + shift.y)
    const cx = W / 2 + layer.x * W;
    const cy = H / 2 + layer.y * H;
    // Build the affine matrix mapping (a, b, 1) -> pixels, then to clip space.
    const m00 = cos * sx, m01 = -sin * sy;
    const m10 = sin * sx, m11 = cos * sy;
    const ox = cx + cos * (-0.5 * sx + shiftX) - sin * (-0.5 * sy + shiftY);
    const oy = cy + sin * (-0.5 * sx + shiftX) + cos * (-0.5 * sy + shiftY);
    // pixels -> clip: x' = x / W * 2 - 1, y' = 1 - y / H * 2
    const ax = 2 / W, ay = -2 / H;
    // column-major mat3
    const mat = new Float32Array([
      m00 * ax, m10 * ay, 0,
      m01 * ax, m11 * ay, 0,
      ox * ax - 1, oy * ay + 1, 1,
    ]);
    gl.uniformMatrix3fv(u("u_matrix"), false, mat);
    gl.uniform4f(u("u_crop"), left, top, 1 - right, 1 - bottom);
    gl.uniform1i(u("u_rotation"), src?.rotation ?? 0);
    gl.uniform1i(u("u_solid"), solid || !src ? 1 : 0);
    if (layer.source.kind === "color") {
      const [r, g, b] = hexToRgb(layer.source.color);
      gl.uniform4f(u("u_color"), r, g, b, 1);
    } else gl.uniform4f(u("u_color"), 0, 0, 0, 0);
    if (src && !solid) {
      this.bindTex(0, this.sourceTexture(src, slot), u("u_tex"));
      const tw = src.rotation % 2 ? src.height : src.width;
      const th = src.rotation % 2 ? src.width : src.height;
      gl.uniform2f(u("u_texel"), 1 / tw, 1 / th);
    }
    gl.uniform1f(u("u_sharpen"), layer.adjust.sharpen / 100);
    gl.uniform1f(u("u_opacity"), layer.opacity);
    const key = layer.chromaKey;
    gl.uniform1i(u("u_key"), key ? 1 : 0);
    if (key) {
      gl.uniform3fv(u("u_keyColor"), hexToRgb(key.color));
      gl.uniform1f(u("u_keySimilarity"), key.similarity);
      gl.uniform1f(u("u_keySmoothness"), key.smoothness);
      gl.uniform1f(u("u_keySpill"), key.spill);
    }
    const mask = layer.mask;
    gl.uniform1i(u("u_maskShape"), mask ? MASK_SHAPES[mask.shape] : 0);
    if (mask) {
      gl.uniform2f(u("u_maskCenter"), mask.x, mask.y);
      gl.uniform2f(u("u_maskSize"), mask.width, mask.height);
      gl.uniform1f(u("u_maskRotation"), (mask.rotation * Math.PI) / 180);
      gl.uniform1f(u("u_maskFeather"), mask.feather);
      gl.uniform1i(u("u_maskInvert"), mask.invert ? 1 : 0);
    }
    this.setColorUniforms(u, layer.adjust, layer.tone, layer.time, layer.grade);
    gl.disable(gl.BLEND);
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
      if (e.type === "blur") {
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
    const [A, B, L1, L2, T1, T2] = this.targets;
    let accum = A;
    let spare = B;
    this.clear(accum);
    let slot = 0;

    const layerToTarget = (layer: Layer, src: SourceImage | null, target: Target, temps: [Target, Target]): Target => {
      this.drawLayer(layer, src, target, slot++);
      // An animation's blur (px at 1080p) rides on the blur effect: radius = amount * 0.6.
      const fx = layer.blur > 0.5 ? [...layer.effects, { type: "blur", params: { amount: layer.blur / 0.6 } }] : layer.effects;
      return fx.length ? this.applyEffects(fx, target, layer.time, temps) : target;
    };
    const sourceOf = (l: Layer) => (l.source.kind === "color" ? null : sources(l));

    for (const item of plan) {
      if (item.kind === "layer") {
        const src = sourceOf(item.layer);
        if (item.layer.source.kind !== "color" && !src) continue;
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
        const u = this.use(this.program("transition", FULLSCREEN_VS, TRANSITION_FS));
        this.bindTex(0, aIn.tex, u("u_a"));
        this.bindTex(1, b.tex, u("u_b"));
        gl.uniform1f(u("u_p"), item.progress);
        gl.uniform1i(u("u_type"), TRANSITION_IDS[item.type] ?? 0);
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

    this.bindTarget(null);
    const u = this.use(this.program("present", FULLSCREEN_VS, PRESENT_FS));
    this.bindTex(0, accum.tex, u("u_tex"));
    gl.uniform3fv(u("u_background"), hexToRgb(background));
    this.draw();
  }

  /** Read the presented frame back as RGBA rows, top row first. For scopes,
   * thumbnails and tests; slow, never in the playback path. */
  readPixels(): Uint8Array {
    const gl = this.gl;
    const out = new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    // GL rows are bottom-up; flip to top-down.
    const row = this.width * 4;
    const tmp = new Uint8Array(row);
    for (let y = 0; y < this.height / 2; y++) {
      const a = y * row;
      const b = (this.height - 1 - y) * row;
      tmp.set(out.subarray(a, a + row));
      out.copyWithin(a, b, b + row);
      out.set(tmp, b);
    }
    return out;
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
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    for (const tex of [...this.sourceTextures.values(), ...this.slotTextures, ...this.curveTextures.values()]) gl.deleteTexture(tex);
    if (this.blank2d) gl.deleteTexture(this.blank2d);
    this.blank2d = null;
    this.curveTextures.clear();
    for (const p of this.programs.values()) gl.deleteProgram(p.prog);
    this.targets = [];
    this.sourceTextures.clear();
    this.slotTextures = [];
    this.programs.clear();
    this.width = this.height = 0;
  }
}
