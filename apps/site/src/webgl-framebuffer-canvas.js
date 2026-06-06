const DRAW_VERTEX = `
attribute vec2 a_position;
attribute vec2 a_uv;
uniform vec2 u_resolution;
varying vec2 v_uv;

void main() {
  vec2 zeroToOne = a_position / u_resolution;
  vec2 clip = zeroToOne * 2.0 - 1.0;
  gl_Position = vec4(clip * vec2(1.0, -1.0), 0.0, 1.0);
  v_uv = a_uv;
}
`;

const DRAW_FRAGMENT = `
precision mediump float;

uniform sampler2D u_texture;
uniform vec4 u_color;
uniform float u_useTexture;
varying vec2 v_uv;

void main() {
  if (u_useTexture > 0.5) {
    gl_FragColor = texture2D(u_texture, v_uv);
  } else {
    gl_FragColor = u_color;
  }
}
`;

const COPY_VERTEX = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const COPY_FRAGMENT = `
precision mediump float;

uniform sampler2D u_texture;
varying vec2 v_uv;

void main() {
  gl_FragColor = texture2D(u_texture, v_uv);
}
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || 'Framebuffer shader compile failed');
  }
  return shader;
}

function createProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'Framebuffer program link failed');
  }
  return program;
}

function parseColor(value) {
  if (typeof value !== 'string' || !value.startsWith('#') || value.length !== 7) {
    return [0, 0, 0, 1];
  }
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
    1,
  ];
}

const FULLSCREEN_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);

export class WebGlFramebufferCanvas {
  constructor(width, height) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.width = width;
    this.height = height;
    this.version = 0;
    this.canvas.__framebufferVersion = this.version;
    this.fillStyle = '#000000';

    this.stagingCanvas = document.createElement('canvas');
    this.stagingCtx = this.stagingCanvas.getContext('2d', { willReadFrequently: true });

    this.gl = this.canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) {
      throw new Error('WebGL framebuffer canvas is not supported');
    }
    this.init();
  }

  getContext(type) {
    if (type !== '2d') {
      return null;
    }
    return this;
  }

  init() {
    const gl = this.gl;
    this.drawProgram = createProgram(gl, DRAW_VERTEX, DRAW_FRAGMENT);
    this.copyProgram = createProgram(gl, COPY_VERTEX, COPY_FRAGMENT);
    this.drawBuffer = gl.createBuffer();
    this.copyBuffer = gl.createBuffer();
    this.drawLocations = {
      position: gl.getAttribLocation(this.drawProgram, 'a_position'),
      uv: gl.getAttribLocation(this.drawProgram, 'a_uv'),
      resolution: gl.getUniformLocation(this.drawProgram, 'u_resolution'),
      color: gl.getUniformLocation(this.drawProgram, 'u_color'),
      useTexture: gl.getUniformLocation(this.drawProgram, 'u_useTexture'),
      texture: gl.getUniformLocation(this.drawProgram, 'u_texture'),
    };
    this.copyLocations = {
      position: gl.getAttribLocation(this.copyProgram, 'a_position'),
      texture: gl.getUniformLocation(this.copyProgram, 'u_texture'),
    };
    this.quadData = new Float32Array(24);

    this.frontTexture = this.createTexture();
    this.backTexture = this.createTexture();
    this.uploadTexture = this.createTexture();
    this.frontFramebuffer = this.createFramebuffer(this.frontTexture);
    this.backFramebuffer = this.createFramebuffer(this.backTexture);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frontFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.initDrawBuffer();
    this.initCopyBuffer();
    this.present();
  }

  initDrawBuffer() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.drawBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.quadData.byteLength, gl.DYNAMIC_DRAW);
  }

  initCopyBuffer() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.copyBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, FULLSCREEN_QUAD, gl.STATIC_DRAW);
  }

  createTexture() {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }

  createFramebuffer(texture) {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    return framebuffer;
  }

  markDirty() {
    this.version += 1;
    this.canvas.__framebufferVersion = this.version;
  }

  resize(width, height) {
    if (width === this.width && height === this.height) {
      return;
    }
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    for (const texture of [this.frontTexture, this.backTexture]) {
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
      this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, width, height, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, null);
    }
    this.bindFrontTarget();
    this.gl.clearColor(0, 0, 0, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.markDirty();
    this.present();
  }

  bindFrontTarget() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frontFramebuffer);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
  }

  drawQuad({ x, y, width, height, texture = null, uv = [0, 0, 1, 1], color = [0, 0, 0, 1], useTexture = false }) {
    const gl = this.gl;
    const x2 = x + width;
    const y2 = y + height;
    const [u1, v1, u2, v2] = uv;
    const data = this.quadData;
    data[0] = x;
    data[1] = y;
    data[2] = u1;
    data[3] = v1;
    data[4] = x2;
    data[5] = y;
    data[6] = u2;
    data[7] = v1;
    data[8] = x;
    data[9] = y2;
    data[10] = u1;
    data[11] = v2;
    data[12] = x;
    data[13] = y2;
    data[14] = u1;
    data[15] = v2;
    data[16] = x2;
    data[17] = y;
    data[18] = u2;
    data[19] = v1;
    data[20] = x2;
    data[21] = y2;
    data[22] = u2;
    data[23] = v2;
    this.bindFrontTarget();
    gl.useProgram(this.drawProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.drawBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    gl.enableVertexAttribArray(this.drawLocations.position);
    gl.vertexAttribPointer(this.drawLocations.position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.drawLocations.uv);
    gl.vertexAttribPointer(this.drawLocations.uv, 2, gl.FLOAT, false, 16, 8);
    gl.uniform2f(this.drawLocations.resolution, this.width, this.height);
    gl.uniform4fv(this.drawLocations.color, color);
    gl.uniform1f(this.drawLocations.useTexture, useTexture ? 1 : 0);
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(this.drawLocations.texture, 0);
    } else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.markDirty();
  }

  fillRect(x, y, width, height) {
    this.drawQuad({ x, y, width, height, color: parseColor(this.fillStyle), useTexture: false });
  }

  putImageData(imageData, x, y) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.uploadTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, imageData.width, imageData.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, imageData.data);
    this.drawQuad({ x, y, width: imageData.width, height: imageData.height, texture: this.uploadTexture, useTexture: true });
  }

  drawImage(sourceCanvas, sx, sy, sw, sh, dx, dy, dw, dh) {
    if (sourceCanvas !== this && sourceCanvas !== this.canvas) {
      this.stagingCanvas.width = dw;
      this.stagingCanvas.height = dh;
      this.stagingCtx.clearRect(0, 0, dw, dh);
      this.stagingCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, dw, dh);
      const imageData = this.stagingCtx.getImageData(0, 0, dw, dh);
      this.putImageData(imageData, dx, dy);
      return;
    }

    this.copyFrontToBack();
    const u1 = sx / this.width;
    const u2 = (sx + sw) / this.width;
    const v1 = 1 - sy / this.height;
    const v2 = 1 - (sy + sh) / this.height;
    this.drawQuad({
      x: dx,
      y: dy,
      width: dw,
      height: dh,
      texture: this.backTexture,
      uv: [u1, v1, u2, v2],
      useTexture: true,
    });
  }

  copyFrontToBack() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.frontFramebuffer);
    gl.bindTexture(gl.TEXTURE_2D, this.backTexture);
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, this.width, this.height);
  }

  present() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.copyProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.copyBuffer);
    gl.enableVertexAttribArray(this.copyLocations.position);
    gl.vertexAttribPointer(this.copyLocations.position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frontTexture);
    gl.uniform1i(this.copyLocations.texture, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
