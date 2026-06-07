const VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform vec2 u_sourceSize;
uniform float u_time;
uniform float u_curve;
uniform float u_bleed;
uniform float u_sync;
uniform float u_burst;
uniform float u_vsyncOffset;
uniform float u_vsyncSnap;
uniform float u_vsyncSnapStretch;
uniform float u_vsyncSnapBrightness;
varying vec2 v_uv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

vec2 curveUv(vec2 uv) {
  vec2 centered = uv - 0.5;
  float d = dot(centered, centered);
  float k = 0.34 + u_curve * 0.42;
  centered *= 1.0 + d * k;
  return centered + 0.5;
}

void main() {
  vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
  uv.y = fract(uv.y + u_vsyncOffset);
  uv.y = 0.5 + (uv.y - 0.5) * (1.0 + u_vsyncSnap * u_vsyncSnapStretch);

  float line = floor(uv.y * u_sourceSize.y);
  float jitter = (hash(vec2(line, floor(u_time * 18.0))) - 0.5) * 0.0018 * u_sync;
  float tear = smoothstep(0.985, 1.0, hash(vec2(floor(u_time * 3.0), line * 0.013)));
  float tearBand = smoothstep(0.0, 0.025, abs(uv.y - hash(vec2(floor(u_time * 1.7), 2.0))));
  uv.x += jitter + (1.0 - tearBand) * tear * (0.03 + u_burst * 0.05) * u_sync;

  float roll = smoothstep(0.96, 1.0, hash(vec2(floor(u_time * 1.35), 8.0))) * u_sync;
  uv.y = mix(uv.y, 0.5 + (uv.y - 0.5) * (0.68 + 0.18 * sin(u_time * 9.0)), roll * 0.42);
  uv.y += roll * sin(u_time * 7.0) * 0.018;

  uv = curveUv(uv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.01, 0.0, 1.0);
    return;
  }

  vec2 bleed = vec2((0.35 + u_bleed * 1.8) * u_texel.x, 0.0);
  float r = texture2D(u_texture, uv + bleed).r;
  float g = texture2D(u_texture, uv).g;
  float b = texture2D(u_texture, uv - bleed).b;
  vec3 color = vec3(r, g, b);

  vec3 glow = (
    texture2D(u_texture, uv + u_texel * vec2( 1.0,  0.0)).rgb +
    texture2D(u_texture, uv + u_texel * vec2(-1.0,  0.0)).rgb +
    texture2D(u_texture, uv + u_texel * vec2( 0.0,  1.0)).rgb +
    texture2D(u_texture, uv + u_texel * vec2( 0.0, -1.0)).rgb
  ) * 0.25;
  color = mix(color, glow, 0.16 + u_bleed * 0.2);

  float sub = mod(floor(v_uv.y * u_sourceSize.y), 3.0);
  vec3 mask = sub < 1.0 ? vec3(1.0, 0.58, 0.58) : (sub < 2.0 ? vec3(0.58, 1.0, 0.58) : vec3(0.58, 0.58, 1.0));
  float scan = 0.58 + 0.42 * smoothstep(0.16, 0.86, fract(v_uv.y * u_sourceSize.y));
  float vignette = smoothstep(0.88, 0.22, length(v_uv - 0.5));
  float noise = (hash(v_uv * u_sourceSize.x + u_time) - 0.5) * 0.035;
  float flicker = 0.94 + 0.06 * sin(u_time * 61.0);

  color *= mask * scan * (0.48 + vignette * 0.72) * flicker;
  color += noise;
  color += u_burst * vec3(0.06, 0.11, 0.08);
  color += u_vsyncSnap * u_vsyncSnapBrightness * vec3(0.69, 1.0, 0.75);

  gl_FragColor = vec4(pow(max(color, 0.0), vec3(0.92)), 1.0);
}
`;

// trueにすると、CSSによるcanvas拡大時の補間を有効にする。
export const CRT_CSS_IMAGE_ANTIALIAS = true;

// trueにすると、WebGLの入力テクスチャサンプリングをLINEARにする。
export const CRT_TEXTURE_ANTIALIAS = true;

// trueにすると、WebGLコンテキスト作成時のantialiasを有効にする。
// 作成後は切り替えできないため、変更後はリロードが必要。
export const CRT_WEBGL_ANTIALIAS = false;

// V-Syncズレが通常位置へ戻るまでの時間。
export const CRT_VSYNC_DRIFT_DURATION_MS = 1000;
// 発生直後の縦方向UVズレ量。1.0に近いほど画面下端から始まる。
export const CRT_VSYNC_DRIFT_START_OFFSET = 0.98;
// 通常フレームでV-Syncズレが自然発生する基本確率。
export const CRT_VSYNC_DRIFT_RANDOM_CHANCE = 0.0009;
// 自然発生時のズレ強度。
export const CRT_VSYNC_DRIFT_RANDOM_AMOUNT = 0.72;
// 明示発火時のズレ強度。
export const CRT_VSYNC_DRIFT_TRIGGER_AMOUNT = 1.0;
// 復帰時に通常位置を通り過ぎる量。
export const CRT_VSYNC_DRIFT_OVERSHOOT = 1.75;
// この進行率を超えたら瞬間的に通常位置へ同期する。
export const CRT_VSYNC_DRIFT_SNAP_PROGRESS = 0.86;
// スナップ同期時の伸びと発光が続く時間。
export const CRT_VSYNC_SNAP_FLASH_DURATION_MS = 120;
// スナップ同期時の縦方向の伸び量。
export const CRT_VSYNC_SNAP_STRETCH = 0.08;
// スナップ同期時の明るさ。
export const CRT_VSYNC_SNAP_BRIGHTNESS = 0.1;

function easeOutBack(value) {
  const c1 = CRT_VSYNC_DRIFT_OVERSHOOT;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

export class CrtRenderer {
  constructor(canvas, sourceCanvas) {
    this.canvas = canvas;
    this.sourceCanvas = sourceCanvas;
    this.settings = {
      curve: 0.42,
      bleed: 0.55,
      sync: 0.5,
    };
    this.burst = 0;
    this.vsyncDriftStartMs = 0;
    this.vsyncDriftAmount = 0;
    this.vsyncSnapStartMs = 0;
    this.uploadedSourceVersion = null;
    this.gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: CRT_WEBGL_ANTIALIAS,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!this.gl) {
      throw new Error('WebGL is not supported');
    }
    this.init();
  }

  init() {
    const gl = this.gl;
    const program = createProgram(gl, VERTEX, FRAGMENT);
    this.program = program;
    this.locations = {
      position: gl.getAttribLocation(program, 'a_position'),
      texture: gl.getUniformLocation(program, 'u_texture'),
      texel: gl.getUniformLocation(program, 'u_texel'),
      sourceSize: gl.getUniformLocation(program, 'u_sourceSize'),
      time: gl.getUniformLocation(program, 'u_time'),
      curve: gl.getUniformLocation(program, 'u_curve'),
      bleed: gl.getUniformLocation(program, 'u_bleed'),
      sync: gl.getUniformLocation(program, 'u_sync'),
      burst: gl.getUniformLocation(program, 'u_burst'),
      vsyncOffset: gl.getUniformLocation(program, 'u_vsyncOffset'),
      vsyncSnap: gl.getUniformLocation(program, 'u_vsyncSnap'),
      vsyncSnapStretch: gl.getUniformLocation(program, 'u_vsyncSnapStretch'),
      vsyncSnapBrightness: gl.getUniformLocation(program, 'u_vsyncSnapBrightness'),
    };

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const textureFilter = CRT_TEXTURE_ANTIALIAS ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, textureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, textureFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  kickSync(amount) {
    this.burst = Math.max(this.burst, amount);
  }

  kickVsyncDrift(amount = CRT_VSYNC_DRIFT_TRIGGER_AMOUNT) {
    this.vsyncDriftStartMs = performance.now();
    this.vsyncDriftAmount = Math.max(this.vsyncDriftAmount, amount);
    this.kickSync(0.9);
  }

  kickVsyncSnap() {
    this.vsyncSnapStartMs = performance.now();
  }

  getVsyncOffset(timeMs) {
    if (this.vsyncDriftAmount <= 0) {
      return 0;
    }
    const elapsed = timeMs - this.vsyncDriftStartMs;
    const progress = Math.min(1, Math.max(0, elapsed / CRT_VSYNC_DRIFT_DURATION_MS));
    if (progress >= CRT_VSYNC_DRIFT_SNAP_PROGRESS) {
      this.vsyncDriftAmount = 0;
      this.kickVsyncSnap();
      return 0;
    }
    const offset = CRT_VSYNC_DRIFT_START_OFFSET * this.vsyncDriftAmount * (1 - easeOutBack(progress));
    if (progress >= 1) {
      this.vsyncDriftAmount = 0;
      return 0;
    }
    return offset;
  }

  getVsyncSnap(timeMs) {
    if (this.vsyncSnapStartMs <= 0) {
      return 0;
    }
    const elapsed = timeMs - this.vsyncSnapStartMs;
    const progress = Math.min(1, Math.max(0, elapsed / CRT_VSYNC_SNAP_FLASH_DURATION_MS));
    if (progress >= 1) {
      this.vsyncSnapStartMs = 0;
      return 0;
    }
    return 1 - progress;
  }

  render(timeMs) {
    const gl = this.gl;
    const time = timeMs * 0.001;
    if (Math.random() < 0.006 * this.settings.sync) {
      this.kickSync(0.75);
    }
    if (Math.random() < CRT_VSYNC_DRIFT_RANDOM_CHANCE * this.settings.sync) {
      this.kickVsyncDrift(CRT_VSYNC_DRIFT_RANDOM_AMOUNT);
    }
    this.burst *= 0.94;
    const vsyncOffset = this.getVsyncOffset(timeMs);
    const vsyncSnap = this.getVsyncSnap(timeMs);

    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const sourceVersion = this.sourceCanvas.__framebufferVersion;
    if (sourceVersion === undefined || sourceVersion !== this.uploadedSourceVersion) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sourceCanvas);
      this.uploadedSourceVersion = sourceVersion;
    }

    gl.enableVertexAttribArray(this.locations.position);
    gl.vertexAttribPointer(this.locations.position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.locations.texture, 0);
    gl.uniform2f(this.locations.texel, 1 / this.sourceCanvas.width, 1 / this.sourceCanvas.height);
    gl.uniform2f(this.locations.sourceSize, this.sourceCanvas.width, this.sourceCanvas.height);
    gl.uniform1f(this.locations.time, time);
    gl.uniform1f(this.locations.curve, this.settings.curve);
    gl.uniform1f(this.locations.bleed, this.settings.bleed);
    gl.uniform1f(this.locations.sync, this.settings.sync);
    gl.uniform1f(this.locations.burst, this.burst);
    gl.uniform1f(this.locations.vsyncOffset, vsyncOffset);
    gl.uniform1f(this.locations.vsyncSnap, vsyncSnap);
    gl.uniform1f(this.locations.vsyncSnapStretch, CRT_VSYNC_SNAP_STRETCH);
    gl.uniform1f(this.locations.vsyncSnapBrightness, CRT_VSYNC_SNAP_BRIGHTNESS);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Shader compile failed');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Program link failed');
  }
  return program;
}
