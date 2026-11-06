/*
 * The drawing half of the matte (matte.ts): WebGL2 programs that blur the room and lay the person over a background.
 * Every source (the camera frame, the mask, a picture) is uploaded top row first, so `uv` runs from the top-left;
 * what's drawn into a framebuffer comes out bottom row first, and `fb()` reads it back the right way up.
 */

const VERTEX = `#version 300 es
in vec2 p;
out vec2 uv;
void main() {
  uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const HEAD = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
vec2 fb(vec2 u) { return vec2(u.x, 1.0 - u.y); }
`;

/**
 * How sure we are that a pixel is the person, from the low-resolution mask: a joint bilateral upsample. Each of 5×5
 * mask samples around here counts for less the farther it is and the less its camera colour looks like the colour
 * here, so the edge follows the real edge in the full-resolution frame (hair against a wall) instead of a blob.
 */
const PERSON = `
uniform sampler2D frame;
uniform sampler2D mask;
uniform vec2 maskTexel;
uniform float colorSigma;
uniform vec2 edge;
float person(vec2 at) {
  vec3 here = texture(frame, at).rgb;
  float sum = 0.0;
  float weights = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      vec2 s = at + vec2(float(x), float(y)) * maskTexel;
      vec3 d = texture(frame, s).rgb - here;
      float w = exp(-float(x * x + y * y) / 4.5) * exp(-dot(d, d) / (2.0 * colorSigma * colorSigma));
      sum += texture(mask, s).r * w;
      weights += w;
    }
  }
  return smoothstep(edge.x, edge.y, sum / max(weights, 1e-5));
}
`;

/**
 * One pass of a Gaussian blur of the room along `step`. The person counts for nothing, so they don't leave a halo in
 * the blur: the first pass writes the weighted colour and how much room went into it, the second divides it back.
 */
const BLUR = `${HEAD}
uniform sampler2D source;
uniform sampler2D mask;
uniform vec2 step;
uniform float sigma;
uniform bool first;
void main() {
  vec4 sum = vec4(0.0);
  float total = 0.0;
  for (int i = -8; i <= 8; i++) {
    float g = exp(-float(i * i) / (2.0 * sigma * sigma));
    vec2 s = uv + step * float(i);
    vec4 c;
    if (first) {
      float room = 1.0 - smoothstep(0.3, 0.7, texture(mask, s).r);
      c = vec4(texture(source, s).rgb * room, room);
    } else {
      c = texture(source, fb(s));
    }
    sum += c * g;
    total += g;
  }
  sum /= total;
  color = first ? sum : vec4(sum.a > 0.004 ? sum.rgb / sum.a : texture(source, fb(uv)).rgb, 1.0);
}`;

/** The person over the background: the blurred room (a framebuffer) or a picture, cut to fill the frame. */
const COMPOSITE = `${HEAD}${PERSON}
uniform sampler2D background;
uniform bool picture;
uniform vec4 cover;
void main() {
  vec3 behind = picture ? texture(background, uv * cover.xy + cover.zw).rgb : texture(background, fb(uv)).rgb;
  color = vec4(mix(behind, texture(frame, uv).rgb, person(uv)), 1.0);
}`;

/** The tunables the drawing takes each frame. */
export interface Edges { colorSigma: number; lo: number; hi: number }

interface Target { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('WebGL made no shader.');
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`A matte shader didn't compile: ${gl.getShaderInfoLog(s) ?? ''}`);
  return s;
}

function program(gl: WebGL2RenderingContext, fragment: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('WebGL made no program.');
  const v = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const f = compile(gl, gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`A matte program didn't link: ${gl.getProgramInfoLog(p) ?? ''}`);
  return p;
}

function texture(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('WebGL made no texture.');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** The programs, textures and framebuffers on one canvas's WebGL2 context. */
export class MatteGl {
  private readonly blur: WebGLProgram;
  private readonly composite: WebGLProgram;
  private readonly triangle: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly frame: WebGLTexture;
  private readonly mask: WebGLTexture;
  private readonly picture: WebGLTexture;
  private pictureSize: { w: number; h: number } | null = null;
  private targets: [Target, Target] | null = null;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.blur = program(gl, BLUR);
    this.composite = program(gl, COMPOSITE);
    const b = gl.createBuffer();
    const vao = gl.createVertexArray();
    if (!b || !vao) throw new Error('WebGL made no buffer.');
    this.triangle = b;
    this.vao = vao;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.frame = texture(gl);
    this.mask = texture(gl);
    this.picture = texture(gl);
  }

  /** The picture to show behind, or none (blur). */
  setPicture(bitmap: ImageBitmap | null): void {
    if (!bitmap) { this.pictureSize = null; return; }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.picture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.pictureSize = { w: bitmap.width, h: bitmap.height };
  }

  /** Draws `frame` with the person in `mask` (w×h, 0–1, top row first) over the background, at w×h of the canvas. */
  draw(frame: VideoFrame, mask: Float32Array, maskW: number, maskH: number, width: number, height: number, blurSigma: number, edges: Edges): void {
    const gl = this.gl;
    // MediaPipe or LiveKit may have left state behind on a shared context: set everything this draw relies on.
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frame);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mask);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, maskW, maskH, 0, gl.RED, gl.FLOAT, mask);

    const picture = this.pictureSize;
    gl.activeTexture(gl.TEXTURE2);
    if (picture) {
      gl.bindTexture(gl.TEXTURE_2D, this.picture);
    } else {
      const [a, b] = this.targetsFor(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
      gl.useProgram(this.blur);
      gl.uniform1i(this.uniform(this.blur, 'mask'), 1);
      gl.uniform1f(this.uniform(this.blur, 'sigma'), 3);
      const spread = blurSigma / 3;
      // Across into a, from the camera frame.
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.viewport(0, 0, a.w, a.h);
      gl.uniform1i(this.uniform(this.blur, 'source'), 0);
      gl.uniform1i(this.uniform(this.blur, 'first'), 1);
      gl.uniform2f(this.uniform(this.blur, 'step'), spread / width, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Down into b, from a.
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform1i(this.uniform(this.blur, 'source'), 2);
      gl.uniform1i(this.uniform(this.blur, 'first'), 0);
      gl.uniform2f(this.uniform(this.blur, 'step'), 0, spread / height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindTexture(gl.TEXTURE_2D, b.tex);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    const p = this.composite;
    gl.useProgram(p);
    gl.uniform1i(this.uniform(p, 'frame'), 0);
    gl.uniform1i(this.uniform(p, 'mask'), 1);
    gl.uniform1i(this.uniform(p, 'background'), 2);
    gl.uniform2f(this.uniform(p, 'maskTexel'), 1 / maskW, 1 / maskH);
    gl.uniform1f(this.uniform(p, 'colorSigma'), edges.colorSigma);
    gl.uniform2f(this.uniform(p, 'edge'), edges.lo, edges.hi);
    gl.uniform1i(this.uniform(p, 'picture'), picture ? 1 : 0);
    if (picture) {
      // Cut to fill, never stretched: the picture's middle, at the frame's shape.
      const frameAspect = width / height;
      const pictureAspect = picture.w / picture.h;
      const sx = pictureAspect > frameAspect ? frameAspect / pictureAspect : 1;
      const sy = pictureAspect > frameAspect ? 1 : pictureAspect / frameAspect;
      gl.uniform4f(this.uniform(p, 'cover'), sx, sy, (1 - sx) / 2, (1 - sy) / 2);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    const gl = this.gl;
    gl.deleteProgram(this.blur);
    gl.deleteProgram(this.composite);
    gl.deleteBuffer(this.triangle);
    gl.deleteVertexArray(this.vao);
    for (const t of [this.frame, this.mask, this.picture]) gl.deleteTexture(t);
    this.dropTargets();
  }

  private uniform(p: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(p, name);
  }

  private targetsFor(w: number, h: number): [Target, Target] {
    if (this.targets && this.targets[0].w === w && this.targets[0].h === h) return this.targets;
    this.dropTargets();
    const make = (): Target => {
      const gl = this.gl;
      const tex = texture(gl);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fbo = gl.createFramebuffer();
      if (!fbo) throw new Error('WebGL made no framebuffer.');
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { fbo, tex, w, h };
    };
    this.targets = [make(), make()];
    return this.targets;
  }

  private dropTargets(): void {
    for (const t of this.targets ?? []) { this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.tex); }
    this.targets = null;
  }
}
