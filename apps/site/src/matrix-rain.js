import { DEFAULT_RETRO_TUBE_PARAMETERS } from './retro-tube.js';

const RETRO_TUBE_PARAMETERS = {
  ...DEFAULT_RETRO_TUBE_PARAMETERS,
  curve: 0.14,
  bleed: 2.0,
  sync: 1,
  burst: 0,
  bloomThreshold: 0.7,
  bloomSoftness: 0.18,
  bloomRadius: 5.1,
  bloomPasses: 3,
  bloomIntensity: 1.8,
  vsyncOffset: 0,
  vsyncSnap: 0,
  vsyncSnapStretch: 0.05,
  vsyncSnapBrightness: 0.08,
};

const GLYPH_LIFETIME = 3; // 1文字の表示寿命（秒）
const STREAM_COUNT_MIN = 100; // ストリーム数の下限
const STREAM_COUNT_MAX = 200; // ストリーム数の上限
const MAX_GLYPHS_PER_STREAM = 25; // 1ストリームの最大文字数
const STREAM_FONT_SIZE = 18; // ストリーム内の基準フォントサイズ
const STREAM_Z_START_MIN = 0.5; // エントリー開始時の奥行き下限
const STREAM_Z_START_MAX = 5.0; // エントリー開始時の奥行き上限
const STREAM_Z_OFFSET = 0.5; // 開始奥行きから差し引く量
const STREAM_PROJECTION_FOCAL_LENGTH = 3.0; // z を画面倍率へ変換する係数
const STREAM_APPROACH_DURATION = 3; // 奥行きが手前へ進む時間
const STREAM_FADE_START = 1.8; // ストリーム全体のフェード開始時間
const STREAM_X_RANGE_MIN = 0; // エントリー時のX座標下限
const STREAM_X_RANGE_MAX = 640; // エントリー時のX座標上限
const STREAM_CANVAS_WIDTH_FACTOR = 4; // viewCanvas 幅の倍率
const STREAM_CANVAS_PADDING_FACTOR = 1.5; // 上下の透明余白倍率
const STREAM_CELL_STEP = 18.45; // 文字間隔の固定値（旧範囲の中間）
const GLYPH_MUTATION_FPS = 6; // 差し替え対象文字を1秒間に更新する回数
const GLYPH_MUTATION_INTERVAL = 1 / GLYPH_MUTATION_FPS; // 差し替え対象文字の更新間隔（秒）
const GLYPH_MUTATION_COUNT_MIN = 1; // 1ストリーム内の差し替え対象数の下限
const GLYPH_MUTATION_COUNT_MAX = 4; // 1ストリーム内の差し替え対象数の上限
const FONT_FAMILY = '"MS Gothic", "Hiragino Sans", monospace'; // グリフ描画用の等幅フォント
const GLYPH_CACHE_LIMIT = 768; // Glyph キャッシュの上限数
const KATAKANA = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝｧｨｩｪｫｬｭｮｯΓΔΛΞΠΣΦΨΩБДЖЩЭЯ'; // 使用する半角カタカナ一覧

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

function easeInOut(value) {
  return value * value * (3 - 2 * value);
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomKatakana() {
  return KATAKANA[Math.floor(Math.random() * KATAKANA.length)];
}

function randomKatakanaExcept(currentChar) {
  let nextChar = randomKatakana();
  while (nextChar === currentChar) {
    nextChar = randomKatakana();
  }
  return nextChar;
}

function createMutationSlots() {
  const count =
    GLYPH_MUTATION_COUNT_MIN +
    Math.floor(Math.random() * (GLYPH_MUTATION_COUNT_MAX - GLYPH_MUTATION_COUNT_MIN + 1));
  const slots = Array.from({ length: MAX_GLYPHS_PER_STREAM }, (_, index) => index);

  for (let index = 0; index < count; index += 1) {
    const swapIndex = index + Math.floor(Math.random() * (slots.length - index));
    [slots[index], slots[swapIndex]] = [slots[swapIndex], slots[index]];
  }

  return new Set(slots.slice(0, count));
}

class GlyphSpriteCache {
  constructor() {
    this.cache = new Map();
  }

  get(char, fontSize, tone) {
    const quantizedSize = Math.max(8, Math.round(fontSize / 4) * 4);
    const key = `${tone}:${quantizedSize}:${char}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    if (this.cache.size >= GLYPH_CACHE_LIMIT) {
      this.cache.clear();
    }

    const padding = Math.ceil(quantizedSize * 0.9);
    const size = quantizedSize + padding * 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D canvas is not available');
    }

    const white = tone === 'white';
    ctx.font = `700 ${quantizedSize}px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.shadowColor = white ? '#aaff9a' : '#21ff16';
    ctx.shadowBlur = quantizedSize * (white ? 0.65 : 0.48);
    ctx.fillStyle = white ? '#f4fff0' : '#43ff35';
    ctx.fillText(char, size / 2, size / 2);
    if (!white) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#98ff7d';
      ctx.fillText(char, size / 2, size / 2);
    }
    ctx.restore();

    this.cache.set(key, canvas);
    return canvas;
  }
}

class RainStream {
  constructor(width, height, initialDelay) {
    this.viewCanvas = document.createElement('canvas');
    this.viewCtx = this.viewCanvas.getContext('2d');
    if (!this.viewCtx) {
      throw new Error('2D canvas is not available');
    }
    this.glyphs = [];
    this.reset(width, height, initialDelay);
  }

  reset(width, height, spawnDelay = 0) {
    this.x = randomBetween(STREAM_X_RANGE_MIN, STREAM_X_RANGE_MAX); // エントリー時のX座標
    this.y = randomBetween(-height * 0.15, height * 0.15); // 画面中央からの縦オフセット
    this.startZ = randomBetween(STREAM_Z_START_MIN, STREAM_Z_START_MAX); // エントリー時の奥行き
    this.targetZ = this.startZ - STREAM_Z_OFFSET; // 到達させる手前側の奥行き
    this.approachAge = 0;
    this.baseCellStep = STREAM_CELL_STEP;
    this.spawnInterval = randomBetween(0.055, 0.11);
    this.spawnAccumulator = -spawnDelay;
    this.mutationSlots = createMutationSlots();
    this.mutationAccumulator = 0;
    this.nextSlot = 0;
    this.z = this.startZ;
    this.viewPadding = Math.ceil(STREAM_FONT_SIZE * STREAM_CANVAS_PADDING_FACTOR);
    this.viewCanvas.width = Math.ceil(STREAM_FONT_SIZE * STREAM_CANVAS_WIDTH_FACTOR);
    this.viewCanvas.height = Math.ceil(this.viewPadding * 2 + this.baseCellStep * (MAX_GLYPHS_PER_STREAM - 1) + STREAM_FONT_SIZE);
    this.glyphs.length = 0;
  }

  getDepth() {
    // 奥行きを手前方向へなめらかに遷移する。
    const progress = clamp(this.approachAge / STREAM_APPROACH_DURATION, 0, 1);
    this.z = lerp(this.startZ, this.targetZ, easeInOut(progress));
    return this.z;
  }

  getOpacity() {
    const fadeProgress = clamp(
      (this.approachAge - STREAM_FADE_START) / (STREAM_APPROACH_DURATION - STREAM_FADE_START),
      0,
      1,
    );
    return 1 - easeInOut(fadeProgress);
  }

  project(width, height) {
    // z から投影倍率を出して、画面中央基準で位置とサイズを決める。
    const z = this.getDepth();
    const scale = STREAM_PROJECTION_FOCAL_LENGTH / z;
    return {
      screenX: width * 0.5 + (this.x - width * 0.5) * scale,
      screenY: height * 0.5 + this.y * scale,
      scale,
      z,
    };
  }

  update(dt, nowSeconds, width, height) {
    this.spawnAccumulator += dt;
    if (this.spawnAccumulator >= 0) {
      this.approachAge += dt;
    }

    while (this.spawnAccumulator >= this.spawnInterval && this.nextSlot < MAX_GLYPHS_PER_STREAM) {
      this.spawnAccumulator -= this.spawnInterval;
      this.glyphs.push({
        char: randomKatakana(),
        bornAt: nowSeconds - this.spawnAccumulator,
        slot: this.nextSlot,
      });
      this.nextSlot += 1;
    }

    if (this.spawnAccumulator >= 0) {
      this.mutationAccumulator += dt;
      while (this.mutationAccumulator >= GLYPH_MUTATION_INTERVAL) {
        this.mutationAccumulator -= GLYPH_MUTATION_INTERVAL;
        for (const glyph of this.glyphs) {
          if (this.mutationSlots.has(glyph.slot)) {
            glyph.char = randomKatakanaExcept(glyph.char);
          }
        }
      }
    }

    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.glyphs.length; readIndex += 1) {
      const glyph = this.glyphs[readIndex];
      if (nowSeconds - glyph.bornAt < GLYPH_LIFETIME) {
        this.glyphs[writeIndex] = glyph;
        writeIndex += 1;
      }
    }
    this.glyphs.length = writeIndex;

    if (this.approachAge >= STREAM_APPROACH_DURATION) {
      this.reset(width, height);
    }
  }

  draw(ctx, spriteCache, nowSeconds, projection) {
    const viewCtx = this.viewCtx;
    viewCtx.clearRect(0, 0, this.viewCanvas.width, this.viewCanvas.height);
    const centerX = this.viewCanvas.width * 0.5;
    const fontSize = STREAM_FONT_SIZE;

    for (const glyph of this.glyphs) {
      const y = this.viewPadding + glyph.slot * this.baseCellStep;
      const age = nowSeconds - glyph.bornAt;
      const life = clamp(age / GLYPH_LIFETIME, 0, 1);
      const alpha = Math.pow(1 - life, 1.25);
      const headStrength = clamp(1 - age / 0.22, 0, 1);
      const greenSprite = spriteCache.get(glyph.char, fontSize, 'green');

      viewCtx.globalAlpha = alpha;
      viewCtx.drawImage(greenSprite, centerX - greenSprite.width / 2, y - greenSprite.height / 2);

      if (headStrength > 0) {
        const whiteSprite = spriteCache.get(glyph.char, fontSize, 'white');
        viewCtx.globalAlpha = alpha * headStrength;
        viewCtx.drawImage(whiteSprite, centerX - whiteSprite.width / 2, y - whiteSprite.height / 2);
      }
    }
    viewCtx.globalAlpha = 1;

    const scale = projection.scale;
    const drawWidth = this.viewCanvas.width * scale;
    const drawHeight = this.viewCanvas.height * scale;
    ctx.globalAlpha = this.getOpacity();
    ctx.drawImage(this.viewCanvas, projection.screenX - drawWidth / 2, projection.screenY - drawHeight / 2, drawWidth, drawHeight);
    ctx.globalAlpha = 1;
  }
}

export class MatrixRain {
  constructor() {
    this.sceneCanvas = document.createElement('canvas');
    this.sceneCtx = this.sceneCanvas.getContext('2d', { alpha: false });
    if (!this.sceneCtx) {
      throw new Error('2D canvas is not available');
    }
    this.spriteCache = new GlyphSpriteCache();
    this.streams = [];
    this.viewportKey = '';
    this.lastTime = null;
  }

  applyRetroTubeParameters(retroTube) {
    retroTube?.setParameters(RETRO_TUBE_PARAMETERS);
  }

  handleKey(event) {
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' || key === 'q') {
      return 'exit';
    }
    return 'ignored';
  }

  handleKeyUp() {
    return 'ignored';
  }

  releaseInput() {
    this.lastTime = null;
  }

  render(time, width, height) {
    const previousTime = this.lastTime ?? time;
    const dt = clamp((time - previousTime) / 1000 || 0, 0, GLYPH_LIFETIME);
    this.lastTime = time;
    if (this.sceneCanvas.width !== width || this.sceneCanvas.height !== height) {
      this.sceneCanvas.width = width;
      this.sceneCanvas.height = height;
    }
    this.ensureStreams(width, height);

    const nowSeconds = time / 1000;
    for (const stream of this.streams) {
      stream.update(dt, nowSeconds, width, height);
    }
    const projectedStreams = this.streams.map((stream) => ({
      stream,
      projection: stream.project(width, height),
    }));
    projectedStreams.sort((left, right) => left.projection.scale - right.projection.scale);
    this.drawScene(nowSeconds, width, height, projectedStreams);
    return this.sceneCanvas;
  }

  ensureStreams(width, height) {
    const viewportKey = `${width}x${height}`;
    const targetCount = clamp(Math.round(width / 16), STREAM_COUNT_MIN, STREAM_COUNT_MAX);
    if (this.viewportKey === viewportKey && this.streams.length === targetCount) {
      return;
    }
    this.viewportKey = viewportKey;
    this.streams = Array.from(
      { length: targetCount },
      (_, index) => new RainStream(width, height, (STREAM_APPROACH_DURATION * index) / targetCount),
    );
  }

  drawScene(nowSeconds, width, height, projectedStreams) {
    const ctx = this.sceneCtx;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    for (const { stream, projection } of projectedStreams) {
      stream.draw(ctx, this.spriteCache, nowSeconds, projection);
    }
    ctx.globalAlpha = 1;
  }
}
