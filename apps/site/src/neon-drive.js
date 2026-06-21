const BUILDING_LAYERS = [
  { seed: 11, count: 22, baseY: 0.53, minHeight: 0.11, maxHeight: 0.24, minWidth: 14, maxWidth: 34, gap: 6, parallax: 0.08, drift: 0.018, fill: '#09052a', edge: '#2642a8', window: '#355cff' },
  { seed: 29, count: 18, baseY: 0.59, minHeight: 0.16, maxHeight: 0.34, minWidth: 18, maxWidth: 44, gap: 8, parallax: 0.22, drift: 0.05, fill: '#0b0738', edge: '#6b2dff', window: '#ca47ff' },
  { seed: 47, count: 15, baseY: 0.66, minHeight: 0.22, maxHeight: 0.46, minWidth: 24, maxWidth: 58, gap: 10, parallax: 0.48, drift: 0.11, fill: '#080613', edge: '#ff2fb2', window: '#ff6adf' },
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

export class NeonDrive {
  constructor() {
    this.sceneCanvas = document.createElement('canvas');
    this.sceneCtx = this.sceneCanvas.getContext('2d', { alpha: false });
    if (!this.sceneCtx) {
      throw new Error('2D canvas is not available');
    }
    this.distance = 0;
    this.lateral = 0;
    this.forwardSpeed = 0.9;
    this.lateralSpeed = 0;
    this.lastTime = null;
    this.stars = this.createStars();
    this.buildingLayers = BUILDING_LAYERS.map((config) => this.createBuildingLayer(config));
  }

  handleKey(event) {
    const key = event.key.toLowerCase();
    if (event.key === 'Escape' || key === 'q') {
      return 'exit';
    }
    if (event.key === 'ArrowUp') {
      this.forwardSpeed = clamp(this.forwardSpeed + 0.18, -1.8, 4.2);
      return 'handled';
    }
    if (event.key === 'ArrowDown') {
      this.forwardSpeed = clamp(this.forwardSpeed - 0.18, -1.8, 4.2);
      return 'handled';
    }
    if (event.key === 'ArrowLeft') {
      this.lateralSpeed = clamp(this.lateralSpeed - 0.35, -4.2, 4.2);
      return 'handled';
    }
    if (event.key === 'ArrowRight') {
      this.lateralSpeed = clamp(this.lateralSpeed + 0.35, -4.2, 4.2);
      return 'handled';
    }
    return 'ignored';
  }

  render(time, width, height) {
    const previousTime = this.lastTime ?? time;
    const dt = clamp((time - previousTime) / 1000 || 0, 0, 0.05);
    this.lastTime = time;
    this.distance += this.forwardSpeed * dt * 72;
    this.lateral += this.lateralSpeed * dt * 72;
    this.lateralSpeed *= Math.pow(0.9, dt * 60);
    if (Math.abs(this.lateralSpeed) < 0.01) {
      this.lateralSpeed = 0;
    }
    return this.draw(time / 1000, width, height);
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
    let x = 0;
    for (let i = 0; i < config.count; i += 1) {
      const width = Math.round(config.minWidth + random() * (config.maxWidth - config.minWidth));
      buildings.push({
        x,
        width,
        height: config.minHeight + random() * (config.maxHeight - config.minHeight),
        roof: random() > 0.58 ? 'antenna' : 'flat',
        windowPhase: Math.floor(random() * 17),
      });
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
    this.drawAtmosphere(ctx, width, height);
    ctx.restore();

    return ctx.getImageData(0, 0, width, height);
  }

  drawStars(ctx, width, height, timeSeconds) {
    for (const star of this.stars) {
      const x = wrapOffset(star.x * width - this.lateral * 0.012 * star.depth, width);
      const y = star.y * height + Math.sin(timeSeconds * 0.8 + star.twinkle) * 0.5;
      const alpha = 0.45 + Math.sin(timeSeconds * 2.2 + star.twinkle) * 0.22 + star.depth * 0.22;
      ctx.globalAlpha = clamp(alpha, 0.2, 1);
      ctx.fillStyle = star.color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(star.size)), Math.max(1, Math.round(star.size)));
    }
    ctx.globalAlpha = 1;
  }

  drawSun(ctx, width, height, horizonY) {
    const radius = Math.max(28, Math.min(width, height) * 0.16);
    const x = clamp(width * 0.5 - this.lateral * 0.025, width * 0.28, width * 0.72);
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
    const baseY = Math.round(height * layer.baseY);
    const scroll = this.lateral * layer.parallax + this.distance * layer.drift;
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
        ctx.fillRect(x + wx, y + wy, Math.max(1, Math.floor(cellW * 0.38)), 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawGrid(ctx, width, height, horizonY) {
    const centerX = width * 0.5 - this.lateral * 0.12;
    const bottomY = height;
    const roadHalfWidth = width * 0.98;
    const cellWidth = Math.max(24, width / 8);
    const lateralOffset = wrapOffset(this.lateral * 0.8, cellWidth);

    ctx.save();
    ctx.fillStyle = '#040106';
    ctx.fillRect(0, horizonY, width, height - horizonY);
    ctx.lineWidth = 1;
    ctx.shadowBlur = 9;

    ctx.strokeStyle = '#ff2fb2';
    ctx.shadowColor = '#ff2fb2';
    for (let i = -18; i <= 18; i += 1) {
      const bottomX = centerX + i * cellWidth - lateralOffset;
      ctx.beginPath();
      ctx.moveTo(centerX, horizonY);
      ctx.lineTo(bottomX, bottomY);
      ctx.stroke();
    }

    const lineCount = 28;
    const scroll = wrapOffset(this.distance * 0.045, 1);
    for (let i = 0; i <= lineCount; i += 1) {
      const t = (i + scroll) / lineCount;
      if (t > 1) {
        continue;
      }
      const eased = t * t * (1.15 - 0.15 * t);
      const y = horizonY + eased * (bottomY - horizonY);
      const halfWidth = roadHalfWidth * t;
      ctx.globalAlpha = clamp(0.25 + t * 0.85, 0.25, 1);
      ctx.strokeStyle = i % 5 === 0 ? '#7df9ff' : '#ff2fb2';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.beginPath();
      ctx.moveTo(centerX - halfWidth, y);
      ctx.lineTo(centerX + halfWidth, y);
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
}
