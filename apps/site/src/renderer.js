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
  vec2 uv = v_uv;
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

const BLOOM_BRIGHT_FRAGMENT = `
precision highp float;

uniform sampler2D u_texture;
uniform float u_threshold;
uniform float u_softness;
varying vec2 v_uv;

float luminance(vec3 color) {
  return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec2 sourceUv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 color = texture2D(u_texture, sourceUv).rgb;
  float brightness = luminance(color);
  float glow = smoothstep(u_threshold - u_softness, u_threshold + u_softness, brightness);
  gl_FragColor = vec4(color * glow, 1.0);
}
`;

const BLOOM_BLUR_FRAGMENT = `
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_texel;
uniform vec2 u_direction;
uniform float u_radius;
varying vec2 v_uv;

void main() {
  vec2 stepUv = u_texel * u_direction * u_radius;
  vec3 color = texture2D(u_texture, v_uv).rgb * 0.227027;
  color += texture2D(u_texture, v_uv + stepUv * 1.384615).rgb * 0.316216;
  color += texture2D(u_texture, v_uv - stepUv * 1.384615).rgb * 0.316216;
  color += texture2D(u_texture, v_uv + stepUv * 3.230769).rgb * 0.070270;
  color += texture2D(u_texture, v_uv - stepUv * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(color, 1.0);
}
`;

const BLOOM_COMPOSE_FRAGMENT = `
precision highp float;

uniform sampler2D u_source;
uniform sampler2D u_bloom;
uniform float u_intensity;
varying vec2 v_uv;

void main() {
  vec2 sourceUv = vec2(v_uv.x, 1.0 - v_uv.y);
  vec3 source = texture2D(u_source, sourceUv).rgb;
  vec3 bloom = texture2D(u_bloom, v_uv).rgb;
  gl_FragColor = vec4(min(source + bloom * u_intensity, vec3(1.0)), 1.0);
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

function fract(value) {
  return value - Math.floor(value);
}

function noiseHash(value) {
  return fract(Math.sin(value * 127.1) * 43758.5453123);
}

function smoothstep01(value) {
  return value * value * (3 - 2 * value);
}

function noise1(value) {
  const index = Math.floor(value);
  const amount = smoothstep01(fract(value));
  const a = noiseHash(index);
  const b = noiseHash(index + 1);
  return a + (b - a) * amount;
}

function fbm(value) {
  return (
    noise1(value * 0.08) * 0.5 +
    noise1(value * 0.21) * 0.25 +
    noise1(value * 0.67) * 0.15 +
    noise1(value * 2.3) * 0.07 +
    noise1(value * 8.0) * 0.03
  );
}

function unstableWave(value) {
  const noise = fbm(value);
  const delta = Math.abs(fbm(value + 0.015) - noise) / 0.015;
  return Math.min(1, noise * 0.55 + Math.pow(noise, 2.2) * 0.25 + Math.pow(delta, 1.4) * 0.2);
}

export class CrtRenderer {
  constructor(canvas, sourceCanvas) {
    this.canvas = canvas;
    this.sourceCanvas = sourceCanvas;
    this.settings = {
      // 画面の湾曲量。高いほど端が大きく曲がる。
      curve: 0.42,
      // 色にじみ量。高いほどRGBの横ずれと周辺発光が強くなる。
      bleed: 1.55,
      // H-Sync系の横揺れぼ強度
      sync: 1.0,
      // bloom対象にする明るさの基準値。高いほど明るい部分だけ光る。
      bloomThreshold: 0.18,
      // しきい値周辺のなだらかさ。低いほど光る/光らないがはっきり分かれる。
      bloomSoftness: 0.22,
      // bloomのにじみ幅。高いほど光が広がる。
      bloomRadius: 1.75,
      // blurの往復回数。高いほど広く滑らかに光るが負荷も増える。
      bloomPasses: 3,
      // bloom強度の通常値。ランダム波が弱い時はこの強さになる。
      bloomBaseIntensity: 0.01,
      // bloom強度の最大値。ランダム波が強い時もこの値を超えない。
      bloomIntensity: 3.725,
    };
    this.burst = 0;
    this.vsyncDriftStartMs = 0;
    this.vsyncDriftAmount = 0;
    this.vsyncSnapStartMs = 0;
    this.bloomWave = null;
    this.nextBloomWaveMs = 0;
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
    const brightProgram = createProgram(gl, VERTEX, BLOOM_BRIGHT_FRAGMENT);
    const blurProgram = createProgram(gl, VERTEX, BLOOM_BLUR_FRAGMENT);
    const composeProgram = createProgram(gl, VERTEX, BLOOM_COMPOSE_FRAGMENT);
    this.program = program;
    this.brightProgram = brightProgram;
    this.blurProgram = blurProgram;
    this.composeProgram = composeProgram;
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
    this.brightLocations = {
      position: gl.getAttribLocation(brightProgram, 'a_position'),
      texture: gl.getUniformLocation(brightProgram, 'u_texture'),
      threshold: gl.getUniformLocation(brightProgram, 'u_threshold'),
      softness: gl.getUniformLocation(brightProgram, 'u_softness'),
    };
    this.blurLocations = {
      position: gl.getAttribLocation(blurProgram, 'a_position'),
      texture: gl.getUniformLocation(blurProgram, 'u_texture'),
      texel: gl.getUniformLocation(blurProgram, 'u_texel'),
      direction: gl.getUniformLocation(blurProgram, 'u_direction'),
      radius: gl.getUniformLocation(blurProgram, 'u_radius'),
    };
    this.composeLocations = {
      position: gl.getAttribLocation(composeProgram, 'a_position'),
      source: gl.getUniformLocation(composeProgram, 'u_source'),
      bloom: gl.getUniformLocation(composeProgram, 'u_bloom'),
      intensity: gl.getUniformLocation(composeProgram, 'u_intensity'),
    };

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

    this.texture = this.createTexture(CRT_TEXTURE_ANTIALIAS ? gl.LINEAR : gl.NEAREST);
    this.bloomTargets = null;
  }

  createTexture(filter) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  createRenderTarget(width, height) {
    const gl = this.gl;
    const texture = this.createTexture(gl.LINEAR);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Bloom framebuffer is incomplete');
    }
    return { texture, framebuffer, width, height };
  }

  deleteRenderTarget(target) {
    if (!target) {
      return;
    }
    const gl = this.gl;
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
  }

  ensureBloomTargets() {
    const width = this.sourceCanvas.width;
    const height = this.sourceCanvas.height;
    if (this.bloomTargets?.width === width && this.bloomTargets?.height === height) {
      return;
    }

    if (this.bloomTargets) {
      this.deleteRenderTarget(this.bloomTargets.bright);
      this.deleteRenderTarget(this.bloomTargets.blurA);
      this.deleteRenderTarget(this.bloomTargets.blurB);
      this.deleteRenderTarget(this.bloomTargets.composite);
    }

    this.bloomTargets = {
      width,
      height,
      bright: this.createRenderTarget(width, height),
      blurA: this.createRenderTarget(width, height),
      blurB: this.createRenderTarget(width, height),
      composite: this.createRenderTarget(width, height),
    };
  }

  bindQuad(program, positionLocation) {
    const gl = this.gl;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
  }

  uploadSourceTexture() {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    const sourceVersion = this.sourceCanvas.__framebufferVersion;
    const sourceWidth = this.sourceCanvas.width;
    const sourceHeight = this.sourceCanvas.height;
    if (
      sourceVersion === undefined ||
      sourceVersion !== this.uploadedSourceVersion ||
      sourceWidth !== this.uploadedSourceWidth ||
      sourceHeight !== this.uploadedSourceHeight
    ) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.sourceCanvas);
      this.uploadedSourceVersion = sourceVersion;
      this.uploadedSourceWidth = sourceWidth;
      this.uploadedSourceHeight = sourceHeight;
    }
  }

  renderBrightPass(target) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    this.bindQuad(this.brightProgram, this.brightLocations.position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.brightLocations.texture, 0);
    gl.uniform1f(this.brightLocations.threshold, this.settings.bloomThreshold);
    gl.uniform1f(this.brightLocations.softness, this.settings.bloomSoftness);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  renderBlurPass(input, output, directionX, directionY, radius) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    gl.viewport(0, 0, output.width, output.height);
    this.bindQuad(this.blurProgram, this.blurLocations.position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input.texture);
    gl.uniform1i(this.blurLocations.texture, 0);
    gl.uniform2f(this.blurLocations.texel, 1 / output.width, 1 / output.height);
    gl.uniform2f(this.blurLocations.direction, directionX, directionY);
    gl.uniform1f(this.blurLocations.radius, radius);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  createBloomWave(timeMs) {
    const duration = 500 + Math.random() * 500;
    return {
      startMs: timeMs,
      durationMs: duration,
      amplitude: 0.18 + Math.random() * 0.82,
      peak: 0.12 + Math.random() * 0.76,
      riseSharpness: 0.45 + Math.random() * 3.2,
      fallSharpness: 0.45 + Math.random() * 3.2,
    };
  }

  // 次のbloom波が発生するまでの遅延時間を返す
  getNextBloomWaveDelayMs() {
    const shortest = 12000;
    const range = 10000;
    return shortest + Math.random() * range;
  }

  getBloomIntensity(timeMs) {
    if (this.bloomWave && timeMs - this.bloomWave.startMs >= this.bloomWave.durationMs) {
      this.bloomWave = null;
      this.nextBloomWaveMs = timeMs + this.getNextBloomWaveDelayMs();
    }

    if (!this.bloomWave && timeMs >= this.nextBloomWaveMs) {
      this.bloomWave = this.createBloomWave(timeMs);
    }

    if (!this.bloomWave) {
      return this.settings.bloomBaseIntensity;
    }

    const wave = this.bloomWave;
    const progress = Math.min(1, Math.max(0, (timeMs - wave.startMs) / wave.durationMs));
    const phase =
      progress < wave.peak
        ? Math.sin((progress / wave.peak) * Math.PI * 0.5)
        : Math.sin(((1 - progress) / (1 - wave.peak)) * Math.PI * 0.5);
    const sharpness = progress < wave.peak ? wave.riseSharpness : wave.fallSharpness;
    const envelope = Math.pow(Math.max(0, phase), sharpness);
    const base = this.settings.bloomBaseIntensity;
    const max = this.settings.bloomIntensity;
    return Math.min(max, base + (max - base) * wave.amplitude * envelope);
  }

  renderComposePass(bloomTarget, output, intensity) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
    gl.viewport(0, 0, output.width, output.height);
    this.bindQuad(this.composeProgram, this.composeLocations.position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.composeLocations.source, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomTarget.texture);
    gl.uniform1i(this.composeLocations.bloom, 1);
    gl.uniform1f(this.composeLocations.intensity, intensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  renderBloomTexture(timeMs) {
    this.ensureBloomTargets();
    const targets = this.bloomTargets;
    this.renderBrightPass(targets.bright);

    let read = targets.bright;
    let write = targets.blurA;
    const passes = Math.max(1, Math.floor(this.settings.bloomPasses));
    for (let pass = 0; pass < passes; pass += 1) {
      const radius = this.settings.bloomRadius + pass * 0.45;
      this.renderBlurPass(read, write, 1, 0, radius);
      read = write;
      write = read === targets.blurA ? targets.blurB : targets.blurA;
      this.renderBlurPass(read, write, 0, 1, radius);
      read = write;
      write = read === targets.blurA ? targets.blurB : targets.blurA;
    }

    this.renderComposePass(read, targets.composite, this.getBloomIntensity(timeMs));
    return targets.composite.texture;
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
    // CRT全体の不安定度。同じ時刻なら同じ値になるため、FPSに依存しない。
    const instability = unstableWave(time);
    const syncWave = Math.pow(instability, 1.2);
    const syncSpike = Math.pow(Math.max(0, instability - 0.34) * 3.0, 2.0);
    const effectiveSync = this.settings.sync * (0.55 + syncWave * 3.2 + syncSpike * 5.0);
    if (Math.random() < 0.006 * effectiveSync) {
      this.kickSync(Math.min(1.35, 0.35 + syncWave * 0.85 + syncSpike * 1.1));
    }
    if (Math.random() < CRT_VSYNC_DRIFT_RANDOM_CHANCE * effectiveSync) {
      this.kickVsyncDrift(CRT_VSYNC_DRIFT_RANDOM_AMOUNT);
    }
    this.burst *= 0.94;
    const vsyncOffset = this.getVsyncOffset(timeMs);
    const vsyncSnap = this.getVsyncSnap(timeMs);

    this.uploadSourceTexture();
    const crtInputTexture = this.renderBloomTexture(timeMs);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    this.bindQuad(this.program, this.locations.position);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, crtInputTexture);
    gl.uniform1i(this.locations.texture, 0);
    gl.uniform2f(this.locations.texel, 1 / this.sourceCanvas.width, 1 / this.sourceCanvas.height);
    gl.uniform2f(this.locations.sourceSize, this.sourceCanvas.width, this.sourceCanvas.height);
    gl.uniform1f(this.locations.time, time);
    gl.uniform1f(this.locations.curve, this.settings.curve);
    gl.uniform1f(this.locations.bleed, this.settings.bleed);
    gl.uniform1f(this.locations.sync, effectiveSync);
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
