import './style.css';
import { CRT_CSS_IMAGE_ANTIALIAS, CrtRenderer } from './renderer.js';
import { CELL_H, CELL_W, Terminal } from './terminal.js';
import { WebGlFramebufferCanvas } from './webgl-framebuffer-canvas.js';

const crtCanvas = document.querySelector('#crtCanvas');
const fpsCounter = document.querySelector('#fpsCounter');
const screenWrap = document.querySelector('.screen-wrap');
const TERMINAL_COLS = 80;
const params = new URLSearchParams(window.location.search);
const testMode = params.get('test') === '1';
const startupMdsPath = params.get('mds') || '';
const startupVfsPath = params.get('vfs') || '';
const mobileBrowserEnv = !testMode && isMobileBrowserEnv();
const MOBILE_FAST_OUTPUT_LATCH_MS = 900;
if (mobileBrowserEnv) {
  document.documentElement.classList.add('is-mobile-terminal');
  syncMobileViewport(false);
}
crtCanvas.classList.toggle('is-antialiased', CRT_CSS_IMAGE_ANTIALIAS);
screenWrap.classList.toggle('is-test-mode', testMode);
const initialGrid = getTerminalGrid();
crtCanvas.width = initialGrid.width;
crtCanvas.height = initialGrid.height;
const lowCanvas = new WebGlFramebufferCanvas(initialGrid.width, initialGrid.height);
lowCanvas.canvas.className = 'test-canvas';
if (testMode) {
  screenWrap.append(lowCanvas.canvas);
  crtCanvas.hidden = true;
  document.querySelector('.glass')?.setAttribute('hidden', '');
}

const terminal = new Terminal(lowCanvas, { cols: initialGrid.cols, rows: initialGrid.rows, startupMdsPath, startupVfsPath, testMode });
const renderer = testMode ? null : new CrtRenderer(crtCanvas, lowCanvas.canvas);
const pointerCanvas = testMode ? lowCanvas.canvas : crtCanvas;
if (mobileBrowserEnv) {
  installMobileViewportSync();
  installMobileTouchScroll();
  installMobileOrientationLockTriggers();
  requestMobileOrientationLock();
}

function getTerminalGrid() {
  if (testMode) {
    return {
      cols: TERMINAL_COLS,
      rows: 40,
      width: TERMINAL_COLS * CELL_W,
      height: 40 * CELL_H,
    };
  }
  const width = TERMINAL_COLS * CELL_W;
  const mobileStage = mobileBrowserEnv ? getMobileStageSize() : null;
  const rect = mobileStage ? null : screenWrap.getBoundingClientRect();
  const sourceWidth = mobileStage?.width || rect?.width || crtCanvas.clientWidth || width;
  const sourceHeight = mobileStage?.height || rect?.height || crtCanvas.clientHeight || crtCanvas.height;
  const displayScale = sourceWidth / width;
  const rows = Math.max(1, Math.floor(sourceHeight / (CELL_H * displayScale)));
  return {
    cols: TERMINAL_COLS,
    rows,
    width,
    height: rows * CELL_H,
  };
}

function syncTerminalGrid() {
  const grid = getTerminalGrid();
  if (grid.width === lowCanvas.width && grid.height === lowCanvas.height) {
    return;
  }
  crtCanvas.width = grid.width;
  crtCanvas.height = grid.height;
  lowCanvas.resize(grid.width, grid.height);
  terminal.resize(grid.cols, grid.rows);
  if (!mobileBrowserEnv) {
    renderer?.kickVsyncDrift();
  }
}

new ResizeObserver(syncTerminalGrid).observe(screenWrap);

function isMobileBrowserEnv() {
  const userAgent = navigator.userAgent || '';
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const isAndroid = /Android/i.test(userAgent) || /Android/i.test(platform);
  const isIOS = /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return isAndroid || isIOS;
}

function getVisualViewportBox() {
  const viewport = window.visualViewport;
  const width = Math.max(1, viewport?.width || window.innerWidth || document.documentElement.clientWidth || 1);
  const height = Math.max(1, viewport?.height || window.innerHeight || document.documentElement.clientHeight || 1);
  return {
    width,
    height,
    left: viewport?.offsetLeft || 0,
    top: viewport?.offsetTop || 0,
  };
}

function getMobileStageSize() {
  const viewport = getVisualViewportBox();
  return {
    width: Math.max(viewport.width, viewport.height),
    height: Math.min(viewport.width, viewport.height),
  };
}

function isMobilePortraitViewport() {
  if (!mobileBrowserEnv) {
    return false;
  }
  const viewport = getVisualViewportBox();
  return viewport.height > viewport.width;
}

function syncMobileViewport(shouldSyncGrid = true) {
  if (!mobileBrowserEnv) {
    return;
  }
  const viewport = getVisualViewportBox();
  const stageWidth = Math.max(viewport.width, viewport.height);
  const stageHeight = Math.min(viewport.width, viewport.height);
  const centerX = viewport.left + viewport.width / 2;
  const centerY = viewport.top + viewport.height / 2;

  document.documentElement.style.setProperty('--mobile-vp-width', `${viewport.width}px`);
  document.documentElement.style.setProperty('--mobile-vp-height', `${viewport.height}px`);
  document.documentElement.style.setProperty('--mobile-stage-width', `${stageWidth}px`);
  document.documentElement.style.setProperty('--mobile-stage-height', `${stageHeight}px`);
  document.documentElement.style.setProperty('--mobile-center-x', `${centerX}px`);
  document.documentElement.style.setProperty('--mobile-center-y', `${centerY}px`);
  document.documentElement.classList.toggle('is-mobile-portrait', viewport.height > viewport.width);

  if (shouldSyncGrid) {
    syncTerminalGrid();
  }
}

let mobileViewportSyncFrame = 0;

function scheduleMobileViewportSync() {
  if (mobileViewportSyncFrame) {
    cancelAnimationFrame(mobileViewportSyncFrame);
  }
  mobileViewportSyncFrame = requestAnimationFrame(() => {
    mobileViewportSyncFrame = 0;
    syncMobileViewport();
  });
}

function installMobileViewportSync() {
  window.visualViewport?.addEventListener('resize', scheduleMobileViewportSync, { passive: true });
  window.visualViewport?.addEventListener('scroll', scheduleMobileViewportSync, { passive: true });
  window.addEventListener('orientationchange', () => {
    scheduleMobileViewportSync();
    setTimeout(scheduleMobileViewportSync, 250);
  });
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.cancelable) {
        event.preventDefault();
      }
    },
    { passive: false },
  );
}

let mobileTouchScroll = null;

function installMobileTouchScroll() {
  pointerCanvas.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) {
        mobileTouchScroll = null;
        endFastOutput();
        return;
      }
      beginFastOutput();
      const point = getTerminalPoint(event.touches[0], { applyCurve: false });
      mobileTouchScroll = point
        ? {
            lastY: point.y,
            pendingY: 0,
            movedY: 0,
          }
        : null;
    },
    { passive: true },
  );

  pointerCanvas.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length !== 1 || !mobileTouchScroll) {
        return;
      }
      if (event.cancelable) {
        event.preventDefault();
      }
      const point = getTerminalPoint(event.touches[0], { applyCurve: false });
      if (!point) {
        return;
      }
      const deltaY = point.y - mobileTouchScroll.lastY;
      mobileTouchScroll.lastY = point.y;
      mobileTouchScroll.pendingY += deltaY;
      mobileTouchScroll.movedY += Math.abs(deltaY);

      const lines = Math.trunc(Math.abs(mobileTouchScroll.pendingY) / CELL_H);
      if (lines <= 0) {
        return;
      }
      terminal.scrollBack(mobileTouchScroll.pendingY > 0 ? lines : -lines);
      mobileTouchScroll.pendingY -= Math.sign(mobileTouchScroll.pendingY) * lines * CELL_H;
    },
    { passive: false },
  );

  const finishTouchScroll = () => {
    if (mobileTouchScroll?.movedY > CELL_H * 0.4) {
      suppressClickUntil = performance.now() + 450;
    }
    endFastOutput({ latchMs: MOBILE_FAST_OUTPUT_LATCH_MS });
    mobileTouchScroll = null;
  };

  pointerCanvas.addEventListener('touchend', finishTouchScroll, { passive: true });
  pointerCanvas.addEventListener('touchcancel', finishTouchScroll, { passive: true });
}

let mobileOrientationLockActive = false;
let mobileOrientationLockGestureTried = false;

async function requestMobileOrientationLock() {
  if (!mobileBrowserEnv || mobileOrientationLockActive) {
    return;
  }
  mobileOrientationLockActive = true;
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    // orientation lock は fullscreen やブラウザ対応に依存するため、失敗しても表示回転で補完する。
  } finally {
    mobileOrientationLockActive = false;
    scheduleMobileViewportSync();
  }
}

function installMobileOrientationLockTriggers() {
  const requestOnce = () => {
    if (mobileOrientationLockGestureTried) {
      return;
    }
    mobileOrientationLockGestureTried = true;
    requestMobileOrientationLock();
  };
  window.addEventListener('pointerdown', requestOnce, { capture: true, passive: true });
  window.addEventListener('touchstart', requestOnce, { capture: true, passive: true });
}

function getPointerUv(event) {
  const rect = pointerCanvas.getBoundingClientRect();
  if (isMobilePortraitViewport()) {
    return {
      x: (event.clientY - rect.top) / rect.height,
      y: 1 - (event.clientX - rect.left) / rect.width,
    };
  }
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function applyCrtCurveToUv(uv) {
  if (!renderer) {
    return uv;
  }
  // シェーダーと同じ湾曲式で、表示位置から元キャンバス座標へ合わせる。
  const centeredX = uv.x - 0.5;
  const centeredY = uv.y - 0.5;
  const distance = centeredX * centeredX + centeredY * centeredY;
  const curve = 0.34 + renderer.settings.curve * 0.42;
  const scale = 1 + distance * curve;
  return {
    x: centeredX * scale + 0.5,
    y: centeredY * scale + 0.5,
  };
}

function getTerminalPoint(event, { applyCurve = true } = {}) {
  const uv = applyCurve ? applyCrtCurveToUv(getPointerUv(event)) : getPointerUv(event);
  if (uv.x < 0 || uv.x > 1 || uv.y < 0 || uv.y > 1) {
    return null;
  }
  return {
    x: uv.x * lowCanvas.width,
    y: uv.y * lowCanvas.height,
  };
}

let suppressClickUntil = 0;
let fastOutputEndTimer = 0;

function beginFastOutput() {
  if (fastOutputEndTimer) {
    clearTimeout(fastOutputEndTimer);
    fastOutputEndTimer = 0;
  }
  terminal.setFastOutputActive(true);
}

function endFastOutput({ latchMs = 0 } = {}) {
  if (fastOutputEndTimer) {
    clearTimeout(fastOutputEndTimer);
    fastOutputEndTimer = 0;
  }
  if (latchMs > 0) {
    fastOutputEndTimer = window.setTimeout(() => {
      fastOutputEndTimer = 0;
      terminal.setFastOutputActive(false);
    }, latchMs);
    return;
  }
  terminal.setFastOutputActive(false);
}

pointerCanvas.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil) {
    event.preventDefault();
    return;
  }
  const point = getTerminalPoint(event);
  if (!point) {
    return;
  }
  const { x, y } = point;
  terminal.handlePointer(x, y);
});

pointerCanvas.addEventListener('mousedown', (event) => {
  if (event.button === 0) {
    beginFastOutput();
  }
});

window.addEventListener('mouseup', (event) => {
  if (event.button === 0) {
    endFastOutput();
  }
});

window.addEventListener('blur', () => {
  endFastOutput();
});

pointerCanvas.addEventListener('mousemove', (event) => {
  const point = getTerminalPoint(event);
  if (!point) {
    terminal.handlePointerLeave();
    pointerCanvas.style.cursor = '';
    return;
  }
  const { x, y } = point;
  pointerCanvas.style.cursor = terminal.handlePointerMove(x, y) ? 'pointer' : '';
});

pointerCanvas.addEventListener('mouseleave', () => {
  terminal.handlePointerLeave();
  pointerCanvas.style.cursor = '';
});

pointerCanvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  terminal.handleWheel(event.deltaY);
});

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    terminal.handleKey(event);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  event.preventDefault();
  terminal.handleKey(event);
});

window.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!text) {
    return;
  }
  event.preventDefault();
  terminal.pasteText(text);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    renderer?.kickVsyncDrift();
  }
});

window.addEventListener('resize', () => {
  if (mobileBrowserEnv) {
    scheduleMobileViewportSync();
    return;
  }
  syncTerminalGrid();
  renderer?.kickVsyncDrift();
});

terminal.boot();

window.addEventListener('popstate', () => {
  const nextParams = new URLSearchParams(window.location.search);
  const nextMdsPath = nextParams.get('mds') || '';
  const nextVfsPath = nextParams.get('vfs') || '';
  if (nextVfsPath) {
    terminal.openVfsPath(nextVfsPath);
    return;
  }
  if (nextMdsPath) {
    terminal.mdsBrowser([nextMdsPath]);
  }
});

let previousFrameTime = null;

function frame(time) {
  terminal.render(time);
  lowCanvas.present();
  renderer?.render(time);
  if (previousFrameTime !== null) {
    fpsCounter.textContent = `FPS:${Math.round(1000 / (time - previousFrameTime))}`;
  }
  previousFrameTime = time;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
