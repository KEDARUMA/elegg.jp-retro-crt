import { DEFAULT_RETRO_TUBE_PARAMETERS } from './retro-tube.js';

const RETRO_TUBE_PARAMETERS = {
  ...DEFAULT_RETRO_TUBE_PARAMETERS,
  // 画面の湾曲量。高いほど端が大きく曲がる。
  curve: 0.42,
  // 色にじみ量。高いほどRGBの横ずれと周辺発光が強くなる。
  bleed: 0.5,
  // H-Sync系の横揺れ強度。外部が毎フレーム更新すると振幅表現になる。
  sync: 0.0,
  // 瞬間的な横方向の破綻量。
  burst: 0,
  // bloom対象にする明るさの基準値。高いほど明るい部分だけ光る。
  bloomThreshold: 0.0,
  // しきい値周辺のなだらかさ。低いほど光る/光らないがはっきり分かれる。
  bloomSoftness: 0.22,
  // bloomのにじみ幅。高いほど光が広がる。
  bloomRadius: 2.75,
  // blurの往復回数。高いほど広く滑らかに光るが負荷も増える。
  bloomPasses: 2,
  // 現在フレームのbloom強度。
  bloomIntensity: 2.1,
  // 縦同期ズレ量。
  vsyncOffset: 0,
  // 縦同期復帰時の瞬間発光量。
  vsyncSnap: 0,
  // 縦同期復帰時の縦方向の伸び量。
  vsyncSnapStretch: 0.08,
  // 縦同期復帰時の明るさ。
  vsyncSnapBrightness: 0.1,
};

const LIGHT_BIKE_IMAGE_URL = new URL('./assets/neon-drive-light-bike.png', import.meta.url).href;
const FORWARD_ACCELERATION = 1.8;
const FORWARD_COAST_DECELERATION = 0.75;
const MAX_FORWARD_SPEED = 1;
const CRUISE_FORWARD_SPEED = MAX_FORWARD_SPEED * 0.5;
const MAX_LATERAL_SPEED = 1.8;
const LATERAL_ACCELERATION = 7;
const LATERAL_DECELERATION = 5;
const FORWARD_WORLD_RATE = 72;
const GRID_FORWARD_RATE = 0.18;
const GRID_LATERAL_RATE = 0.35;
const GRID_VERTICAL_OVERSCAN = 6;
const GRID_LINE_COUNT = 14;
const CYAN_LINE_INTERVAL = 5;
const EXHAUST_RING_PAIR_COUNT = 10;
const EXHAUST_PORT_X_RATIO = 0.15;
const EXHAUST_PORT_Y_RATIO = 0.43;
const EXHAUST_RING_MAX_RADIUS_RATIO = 0.18;
const MAX_BIKE_LEAN = Math.PI / 4;
const BIKE_LEAN_DURATION = 3;
const BIKE_LEAN_RATE = MAX_BIKE_LEAN / BIKE_LEAN_DURATION;

const BUILDING_LAYERS = [
  { seed: 11, count: 22, baseY: 0.53, yOffset: 30, minHeight: 0.11, maxHeight: 0.24, minWidth: 14, maxWidth: 34, gap: 6, parallax: 0.08, drift: 0.06, fill: '#09052a', edge: '#2642a8', window: '#355cff' },
  { seed: 29, count: 18, baseY: 0.59, minHeight: 0.16, maxHeight: 0.34, minWidth: 18, maxWidth: 44, gap: 8, parallax: 0.22, drift: 0.16, fill: '#0b0738', edge: '#6b2dff', window: '#ca47ff' },
  { seed: 47, count: 15, baseY: 0.66, minHeight: 0.22, maxHeight: 0.46, minWidth: 24, maxWidth: 58, gap: 10, parallax: 0.48, drift: 0.38, fill: '#080613', edge: '#ff2fb2', window: '#ff6adf' },
];

function createSeededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function wrapOffset(value, size) {
  if (size <= 0) {
    return 0;
  }
  return ((value % size) + size) % size;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function moveToward(value, target, amount) {
  if (value < target) {
    return Math.min(target, value + amount);
  }
  if (value > target) {
    return Math.max(target, value - amount);
  }
  return value;
}

function getControlAction(event) {
  switch (event.code) {
    case 'KeyW':
    case 'ArrowUp':
      return 'forward';
    case 'KeyA':
    case 'ArrowLeft':
      return 'left';
    case 'KeyD':
    case 'ArrowRight':
      return 'right';
    default:
      return null;
  }
}

export class NeonDrive {
  constructor() {
    this.sceneCanvas = document.createElement('canvas');
    this.sceneCtx = this.sceneCanvas.getContext('2d', { alpha: false });
    if (!this.sceneCtx) {
      throw new Error('2D canvas is not available');
    }
    this.distance = 0;
    this.lateral = 0;
    this.forwardSpeed = CRUISE_FORWARD_SPEED;
    this.lateralSpeed = 0;
    this.bikeLean = 0;
    this.activeControls = new Set();
    this.pointerControls = new Set();
    this.lastTime = null;
    this.stars = this.createStars();
    this.buildingLayers = BUILDING_LAYERS.map((config) => this.createBuildingLayer(config));
    this.lightBikeImage = null;
    this.lightBikeReady = false;
    this.lightBikeImagePromise = null;
    this.exhaustRingPairs = [];
    this.exhaustRingViewport = '';
    this.loadLightBikeImage();
  }

  applyRetroTubeParameters(retroTube) {
    retroTube?.setParameters(RETRO_TUBE_PARAMETERS);
  }

  handleKey(event) {
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' || key === 'q') {
      return 'exit';
    }

    const action = getControlAction(event);
    if (action) {
      this.activeControls.add(action);
      return 'handled';
    }
    return 'ignored';
  }

  handleKeyUp(event) {
    const action = getControlAction(event);
    if (!action) {
      return 'ignored';
    }
    this.activeControls.delete(action);
    return 'handled';
  }

  handlePointerDown(x, width) {
    this.pointerControls.clear();
    this.pointerControls.add('forward');
    if (x < width / 3) {
      this.pointerControls.add('left');
    } else if (x > (width * 2) / 3) {
      this.pointerControls.add('right');
    }
  }

  handlePointerUp() {
    this.pointerControls.clear();
  }

  releaseInput() {
    this.activeControls.clear();
    this.pointerControls.clear();
  }

  render(time, width, height) {
    const previousTime = this.lastTime ?? time;
    const dt = clamp((time - previousTime) / 1000 || 0, 0, 0.05);
    this.lastTime = time;
    this.updateMovement(dt);
    return this.draw(time / 1000, width, height);
  }

  updateMovement(dt) {
    const hasControl = (action) => this.activeControls.has(action) || this.pointerControls.has(action);
    const targetForwardSpeed = hasControl('forward') ? MAX_FORWARD_SPEED : CRUISE_FORWARD_SPEED;
    const forwardRate = targetForwardSpeed > this.forwardSpeed ? FORWARD_ACCELERATION : FORWARD_COAST_DECELERATION;
    this.forwardSpeed = moveToward(this.forwardSpeed, targetForwardSpeed, forwardRate * dt);

    const steering = Number(hasControl('right')) - Number(hasControl('left'));
    const targetLateralSpeed = steering * MAX_LATERAL_SPEED;
    const lateralRate = steering === 0 ? LATERAL_DECELERATION : LATERAL_ACCELERATION;
    this.lateralSpeed = moveToward(this.lateralSpeed, targetLateralSpeed, lateralRate * dt);
    this.bikeLean = moveToward(this.bikeLean, steering * MAX_BIKE_LEAN, BIKE_LEAN_RATE * dt);

    this.distance += this.forwardSpeed * dt * FORWARD_WORLD_RATE;
    this.lateral += this.lateralSpeed * dt;
  }

  createStars(count = 120) {
    const random = createSeededRandom(913);
    const colors = ['#ffffff', '#ff6adf', '#7df9ff', '#f6d6ff'];
    return Array.from({ length: count }, () => ({
      x: random(),
      y: random() * 0.52,
      size: 0.45 + random() * 1.3,
      depth: 0.2 + random() * 0.8,
      twinkle: random() * Math.PI * 2,
      color: colors[Math.floor(random() * colors.length)],
    }));
  }

  createBuildingLayer(config) {
    const random = createSeededRandom(config.seed);
    const buildings = [];
    const keepCount = Math.round(config.count * 0.75);
    let x = 0;
    for (let i = 0; i < config.count; i += 1) {
      const width = Math.round(config.minWidth + random() * (config.maxWidth - config.minWidth));
      const building = {
        x,
        width,
        height: config.minHeight + random() * (config.maxHeight - config.minHeight),
        roof: random() > 0.58 ? 'antenna' : 'flat',
        windowPhase: Math.floor(random() * 17),
      };
      const keptBefore = Math.floor((i * keepCount) / config.count);
      const keptAfter = Math.floor(((i + 1) * keepCount) / config.count);
      if (keptAfter > keptBefore) {
        buildings.push(building);
      }
      x += width + config.gap + Math.round(random() * config.gap);
    }
    return {
      ...config,
      buildings,
      patternWidth: Math.max(x, 1),
    };
  }

  draw(timeSeconds, width, height) {
    if (this.sceneCanvas.width !== width || this.sceneCanvas.height !== height) {
      this.sceneCanvas.width = width;
      this.sceneCanvas.height = height;
    }
    const ctx = this.sceneCtx;
    const horizonY = Math.round(height * 0.58);

    ctx.save();
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#030008');
    sky.addColorStop(0.42, '#130028');
    sky.addColorStop(0.7, '#080013');
    sky.addColorStop(1, '#020104');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    this.drawStars(ctx, width, height, timeSeconds);
    this.drawSun(ctx, width, height, horizonY);
    for (const layer of this.buildingLayers) {
      this.drawBuildingLayer(ctx, layer, width, height, timeSeconds);
    }
    this.drawGrid(ctx, width, height, horizonY);
    this.drawLightBike(ctx, width, height, timeSeconds);
    this.drawExhaustRings(ctx, width, height, horizonY, timeSeconds);
    this.drawAtmosphere(ctx, width, height);
    ctx.restore();

    return ctx.getImageData(0, 0, width, height);
  }

  loadLightBikeImage() {
    if (this.lightBikeImagePromise) {
      return this.lightBikeImagePromise;
    }

    const image = new Image();
    image.decoding = 'async';
    this.lightBikeImage = image;
    this.lightBikeImagePromise = new Promise((resolve) => {
      image.onload = () => {
        this.lightBikeReady = true;
        resolve(image);
      };
      image.onerror = () => {
        this.lightBikeReady = false;
        resolve(null);
      };
    });
    image.src = LIGHT_BIKE_IMAGE_URL;
    return this.lightBikeImagePromise;
  }

  drawStars(ctx, width, height, timeSeconds) {
    for (const star of this.stars) {
      const x = wrapOffset(star.x * width - this.lateral * width * 0.08 * star.depth, width);
      const y = star.y * height + Math.sin(timeSeconds * 0.8 + star.twinkle) * 0.5;
      const alpha = 0.45 + Math.sin(timeSeconds * 2.2 + star.twinkle) * 0.22 + star.depth * 0.22;
      ctx.globalAlpha = clamp(alpha, 0.2, 1);
      ctx.fillStyle = star.color;
      const size = Math.max(2, Math.round(star.size));
      ctx.fillRect(Math.round(x), Math.round(y), size, size);
    }
    ctx.globalAlpha = 1;
  }

  drawSun(ctx, width, height, horizonY) {
    const radius = Math.max(28, Math.min(width, height) * 0.16);
    const x = clamp(width * (0.5 - this.lateral * 0.04), width * 0.28, width * 0.72);
    const y = clamp(horizonY - radius * 0.68 + Math.sin(this.distance * 0.01) * height * 0.018, height * 0.2, horizonY - radius * 0.12);
    const stripe = Math.max(4, Math.round(radius * 0.13));

    ctx.save();
    ctx.shadowColor = '#ff2fb2';
    ctx.shadowBlur = Math.max(12, radius * 0.32);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.clip();

    const sunGradient = ctx.createLinearGradient(0, y - radius, 0, y + radius);
    sunGradient.addColorStop(0, '#ff5f8f');
    sunGradient.addColorStop(0.52, '#ff2fb2');
    sunGradient.addColorStop(1, '#8f3cff');
    ctx.fillStyle = sunGradient;
    for (let sy = y - radius; sy < y + radius; sy += stripe * 2) {
      ctx.fillRect(x - radius, sy, radius * 2, stripe);
    }
    ctx.restore();
  }

  drawBuildingLayer(ctx, layer, width, height, timeSeconds) {
    const baseY = Math.round(height * layer.baseY) + (layer.yOffset || 0);
    const lateralScroll = this.lateral * width * layer.parallax * 0.35;
    const scroll = lateralScroll + this.distance * layer.drift;
    const startX = -wrapOffset(scroll, layer.patternWidth) - layer.patternWidth;

    ctx.save();
    ctx.lineWidth = 1;
    ctx.shadowColor = layer.edge;
    ctx.shadowBlur = layer.parallax > 0.3 ? 8 : 3;
    for (let repeatX = startX; repeatX < width + layer.patternWidth; repeatX += layer.patternWidth) {
      for (const building of layer.buildings) {
        const x = Math.round(repeatX + building.x);
        const buildingWidth = building.width;
        if (x > width || x + buildingWidth < 0) {
          continue;
        }
        const buildingHeight = Math.round(height * building.height);
        const y = baseY - buildingHeight;
        ctx.fillStyle = layer.fill;
        ctx.fillRect(x, y, buildingWidth, buildingHeight);
        ctx.strokeStyle = layer.edge;
        ctx.strokeRect(x + 0.5, y + 0.5, buildingWidth, buildingHeight);
        if (building.roof === 'antenna') {
          ctx.beginPath();
          ctx.moveTo(x + buildingWidth * 0.5, y);
          ctx.lineTo(x + buildingWidth * 0.5, y - Math.max(5, buildingHeight * 0.16));
          ctx.stroke();
        }
        this.drawWindows(ctx, layer, building, x, y, buildingWidth, buildingHeight, timeSeconds);
      }
    }
    ctx.restore();
  }

  drawWindows(ctx, layer, building, x, y, width, height, timeSeconds) {
    const cellW = layer.parallax > 0.3 ? 7 : 6;
    const cellH = layer.parallax > 0.3 ? 8 : 7;
    ctx.fillStyle = layer.window;
    ctx.shadowColor = layer.window;
    ctx.shadowBlur = layer.parallax > 0.3 ? 5 : 2;
    for (let wy = 8; wy < height - 4; wy += cellH) {
      for (let wx = 4; wx < width - 4; wx += cellW) {
        const pulse = Math.sin(timeSeconds * 1.7 + building.windowPhase + wx * 0.37 + wy * 0.19);
        if ((wx + wy + building.windowPhase) % 4 === 0 || pulse < -0.45) {
          continue;
        }
        ctx.globalAlpha = layer.parallax > 0.3 ? 0.8 : 0.52;
        ctx.fillRect(x + wx, y + wy, Math.max(2, Math.floor(cellW * 0.38)), 2);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawGrid(ctx, width, height, horizonY) {
    const centerX = width * 0.5;
    const bottomY = height;
    const cellWidth = Math.max(24, width / 8);
    const lateralGridOffset = wrapOffset(this.getGridLateralOffset(width), cellWidth);
    const verticalLineRadius = Math.ceil((width * GRID_VERTICAL_OVERSCAN) / cellWidth);

    ctx.save();
    ctx.fillStyle = '#040106';
    ctx.fillRect(0, horizonY, width, height - horizonY);
    ctx.lineWidth = 1;
    ctx.shadowBlur = 9;

    ctx.strokeStyle = '#ff2fb2';
    ctx.shadowColor = '#ff2fb2';
    for (let i = -verticalLineRadius; i <= verticalLineRadius; i += 1) {
      const bottomX = centerX + i * cellWidth - lateralGridOffset;
      ctx.beginPath();
      ctx.moveTo(centerX, horizonY);
      ctx.lineTo(bottomX, bottomY);
      ctx.stroke();
    }

    const gridProgress = this.distance * GRID_FORWARD_RATE;
    const magentaPhase = wrapOffset(gridProgress, 1);
    for (let i = 0; i <= GRID_LINE_COUNT; i += 1) {
      const t = (i + magentaPhase) / GRID_LINE_COUNT;
      if (t > 1) {
        continue;
      }
      const eased = t * t * (1.15 - 0.15 * t);
      const y = horizonY + eased * (bottomY - horizonY);
      ctx.globalAlpha = clamp(0.25 + t * 0.85, 0.25, 1);
      ctx.strokeStyle = '#ff2fb2';
      ctx.shadowColor = '#ff2fb2';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const cyanPhase = wrapOffset(gridProgress, CYAN_LINE_INTERVAL);
    for (let i = 0; i <= Math.ceil(GRID_LINE_COUNT / CYAN_LINE_INTERVAL); i += 1) {
      const t = (i * CYAN_LINE_INTERVAL + cyanPhase) / GRID_LINE_COUNT;
      if (t > 1) {
        continue;
      }
      const eased = t * t * (1.15 - 0.15 * t);
      const y = horizonY + eased * (bottomY - horizonY);
      ctx.globalAlpha = clamp(0.35 + t * 0.65, 0.35, 1);
      ctx.strokeStyle = '#7df9ff';
      ctx.shadowColor = '#7df9ff';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawAtmosphere(ctx, width, height) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#ff2fb2';
    for (let y = 0; y < height; y += 5) {
      ctx.fillRect(0, y, width, 1);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawLightBike(ctx, width, height, timeSeconds) {
    const image = this.lightBikeImage;
    if (!image || !this.lightBikeReady || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    const transform = this.getLightBikeTransform(width, height, timeSeconds);

    ctx.save();
    ctx.translate(transform.centerX, transform.bottomY);
    ctx.rotate(transform.lean);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, -transform.targetWidth / 2, -transform.targetHeight, transform.targetWidth, transform.targetHeight);
    ctx.restore();
  }

  drawExhaustRings(ctx, width, height, horizonY, timeSeconds) {
    const image = this.lightBikeImage;
    if (!image || !this.lightBikeReady || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    const transform = this.getLightBikeTransform(width, height, timeSeconds);
    const gridProgress = this.distance * GRID_FORWARD_RATE;
    this.prepareExhaustRingPairs(transform, width, height, horizonY, gridProgress);
    const maxRadius = height * EXHAUST_RING_MAX_RADIUS_RATIO;
    const currentGridOffset = this.getGridLateralOffset(width);

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 5;

    for (const pair of this.exhaustRingPairs) {
      let progress = (gridProgress - pair.spawnGridProgress) / GRID_LINE_COUNT;
      if (progress >= 1) {
        progress = wrapOffset(progress, 1);
        this.resetExhaustRingPair(pair, transform, width, gridProgress - progress * GRID_LINE_COUNT);
      }
      const eased = progress * progress * (1.15 - 0.15 * progress);
      const radius = 2 + maxRadius * eased;
      const alpha = clamp((1 - progress) * 1.35, 0, 1);

      for (const origin of pair.origins) {
        const y = origin.portY + (height + radius - origin.portY) * eased;
        const depth = clamp((y - horizonY) / (height - horizonY), 0.001, 1);
        const x = origin.portX - (currentGridOffset - origin.spawnGridOffset) * depth;

        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  prepareExhaustRingPairs(transform, width, height, horizonY, gridProgress) {
    const viewport = `${width}x${height}`;
    if (this.exhaustRingPairs.length === EXHAUST_RING_PAIR_COUNT && this.exhaustRingViewport === viewport) {
      return;
    }

    this.exhaustRingViewport = viewport;
    this.exhaustRingPairs = Array.from({ length: EXHAUST_RING_PAIR_COUNT }, (_, index) => {
      const pair = { spawnGridProgress: 0, origins: [] };
      const progress = index / EXHAUST_RING_PAIR_COUNT;
      this.resetExhaustRingPair(pair, transform, width, gridProgress - progress * GRID_LINE_COUNT);
      return pair;
    });
  }

  resetExhaustRingPair(pair, transform, width, spawnGridProgress) {
    const spawnGridOffset = this.getGridLateralOffset(width);
    pair.spawnGridProgress = spawnGridProgress;
    pair.origins = [-1, 1].map((side) => {
      const port = this.getExhaustPortPosition(transform, side);
      return {
        portX: port.x,
        portY: port.y,
        spawnGridOffset,
      };
    });
  }

  getLightBikeTransform(width, height, timeSeconds) {
    const speedRatio = this.forwardSpeed / MAX_FORWARD_SPEED;
    const targetHeight = height * (0.74 + speedRatio * 0.06);
    const scale = targetHeight / this.lightBikeImage.naturalHeight;
    const targetWidth = this.lightBikeImage.naturalWidth * scale;
    const leanRatio = Math.abs(this.bikeLean) / MAX_BIKE_LEAN;
    const idleLean = Math.sin(timeSeconds * 1.7) * 0.012 * speedRatio * (1 - leanRatio);
    return {
      centerX: width * 0.5,
      bottomY: height * 0.95 + Math.sin(timeSeconds * 7.2 + this.distance * 0.01) * 3 * speedRatio,
      lean: clamp(this.bikeLean + idleLean, -MAX_BIKE_LEAN, MAX_BIKE_LEAN),
      targetWidth,
      targetHeight,
    };
  }

  getExhaustPortPosition(transform, side) {
    const localX = transform.targetWidth * EXHAUST_PORT_X_RATIO * side;
    const localY = -transform.targetHeight * EXHAUST_PORT_Y_RATIO;
    const cos = Math.cos(transform.lean);
    const sin = Math.sin(transform.lean);
    return {
      x: transform.centerX + localX * cos - localY * sin,
      y: transform.bottomY + localX * sin + localY * cos,
    };
  }

  getGridLateralOffset(width) {
    return this.lateral * width * GRID_LATERAL_RATE;
  }
}
