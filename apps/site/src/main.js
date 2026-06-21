import './style.css';
import { CRT_CSS_IMAGE_ANTIALIAS, DEFAULT_RETRO_TUBE_PARAMETERS, RetroTube } from './retro-tube.js';
import { CELL_H, CELL_W, Terminal } from './terminal.js';
import { WebGlFramebufferCanvas } from './webgl-framebuffer-canvas.js';

const crtCanvas = document.querySelector('#crtCanvas');
const fpsCounter = document.querySelector('#fpsCounter');
const screenWrap = document.querySelector('.screen-wrap');
const TERMINAL_COLS = 80;
const NEON_DRIVE_RETRO_TUBE_PARAMETERS = {
  ...DEFAULT_RETRO_TUBE_PARAMETERS,
  burst: 0,
  bloomIntensity: 0.35,
  vsyncOffset: 0,
  vsyncSnap: 0,
};
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

let activeRuntime = null;
const runtimeStack = [];
const runtimeSystem = {
  pushRuntime,
  popRuntime,
  createNeonDriveRuntime,
};
const terminal = new Terminal(lowCanvas, { cols: initialGrid.cols, rows: initialGrid.rows, startupMdsPath, startupVfsPath, testMode, runtimeSystem });
const retroTube = testMode ? null : new RetroTube(crtCanvas, lowCanvas.canvas);
const pointerCanvas = testMode ? lowCanvas.canvas : crtCanvas;
const terminalRuntime = terminal;
activeRuntime = terminalRuntime;
if (mobileBrowserEnv) {
  installMobileViewportSync();
  installMobileTouchScroll();
  installMobileOrientationLockTriggers();
  requestMobileOrientationLock();
}

class NeonDriveRuntime {
  constructor(neonDrive, system) {
    this.neonDrive = neonDrive;
    this.system = system;
    this.exitMessage = 'NEON DRIVE TERMINATED';
  }

  render(time) {
    const imageData = this.neonDrive.render(time, lowCanvas.width, lowCanvas.height);
    if (imageData) {
      lowCanvas.putImageData(imageData, 0, 0);
    }
  }

  apply(retroTube) {
    retroTube?.setParameters(NEON_DRIVE_RETRO_TUBE_PARAMETERS);
  }

  handleKey(event) {
    if (this.neonDrive.handleKey(event) === 'exit') {
      this.system.popRuntime(this);
    }
  }

  handlePointer() {
    return false;
  }

  handlePointerMove() {
    return false;
  }

  handlePointerLeave() {}

  handleWheel() {}

  pasteText() {}
}

async function createNeonDriveRuntime() {
  const { NeonDrive } = await import('./neon-drive.js');
  return new NeonDriveRuntime(new NeonDrive(), runtimeSystem);
}

function pushRuntime(runtime) {
  if (!runtime) {
    return;
  }
  const previousRuntime = activeRuntime || terminalRuntime;
  previousRuntime?.suspend?.(runtime);
  runtimeStack.push(previousRuntime);
  activeRuntime = runtime;
  pointerCanvas.style.cursor = '';
  activeRuntime.enter?.(previousRuntime);
}

function popRuntime(runtime = activeRuntime) {
  if (runtime && runtime !== activeRuntime) {
    return;
  }
  const finishedRuntime = activeRuntime;
  finishedRuntime?.exit?.();
  activeRuntime = runtimeStack.pop() || terminalRuntime;
  pointerCanvas.style.cursor = '';
  activeRuntime.resume?.(finishedRuntime);
}

function forceTerminalRuntime(error) {
  const message = error?.message || String(error || 'unknown runtime error');
  runtimeStack.length = 0;
  activeRuntime = terminalRuntime;
  pointerCanvas.style.cursor = '';
  terminalRuntime.resume({ exitMessage: `runtime: ${message}` });
}

function callActiveRuntime(methodName, ...args) {
  try {
    const result = activeRuntime?.[methodName]?.(...args);
    result?.catch?.((error) => forceTerminalRuntime(error));
    return result;
  } catch (error) {
    forceTerminalRuntime(error);
    return null;
  }
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
    callActiveRuntime('kickRetroTubeVsyncDrift');
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
      const point = getRuntimePoint(event.touches[0], { applyCurve: false });
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
      const point = getRuntimePoint(event.touches[0], { applyCurve: false });
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
      callActiveRuntime('scrollBack', mobileTouchScroll.pendingY > 0 ? lines : -lines);
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
  if (!retroTube) {
    return uv;
  }
  // シェーダーと同じ湾曲式で、表示位置から元キャンバス座標へ合わせる。
  const centeredX = uv.x - 0.5;
  const centeredY = uv.y - 0.5;
  const distance = centeredX * centeredX + centeredY * centeredY;
  const curve = 0.34 + retroTube.parameters.curve * 0.42;
  const scale = 1 + distance * curve;
  return {
    x: centeredX * scale + 0.5,
    y: centeredY * scale + 0.5,
  };
}

function getRuntimePoint(event, { applyCurve = true } = {}) {
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
let fastOutputRuntime = null;

function beginFastOutput() {
  if (fastOutputEndTimer) {
    clearTimeout(fastOutputEndTimer);
    fastOutputEndTimer = 0;
  }
  fastOutputRuntime = activeRuntime;
  fastOutputRuntime?.setFastOutputActive?.(true);
}

function endFastOutput({ latchMs = 0 } = {}) {
  const targetRuntime = fastOutputRuntime;
  if (fastOutputEndTimer) {
    clearTimeout(fastOutputEndTimer);
    fastOutputEndTimer = 0;
  }
  if (latchMs > 0) {
    fastOutputEndTimer = window.setTimeout(() => {
      fastOutputEndTimer = 0;
      targetRuntime?.setFastOutputActive?.(false);
      if (fastOutputRuntime === targetRuntime) {
        fastOutputRuntime = null;
      }
    }, latchMs);
    return;
  }
  targetRuntime?.setFastOutputActive?.(false);
  if (fastOutputRuntime === targetRuntime) {
    fastOutputRuntime = null;
  }
}

pointerCanvas.addEventListener('click', (event) => {
  if (performance.now() < suppressClickUntil) {
    event.preventDefault();
    return;
  }
  const point = getRuntimePoint(event);
  if (!point) {
    return;
  }
  const { x, y } = point;
  callActiveRuntime('handlePointer', x, y, event);
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
  const point = getRuntimePoint(event);
  if (!point) {
    callActiveRuntime('handlePointerLeave', event);
    pointerCanvas.style.cursor = '';
    return;
  }
  const { x, y } = point;
  pointerCanvas.style.cursor = callActiveRuntime('handlePointerMove', x, y, event) ? 'pointer' : '';
});

pointerCanvas.addEventListener('mouseleave', () => {
  callActiveRuntime('handlePointerLeave');
  pointerCanvas.style.cursor = '';
});

pointerCanvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  callActiveRuntime('handleWheel', event.deltaY, event);
});

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    callActiveRuntime('handleKey', event);
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  event.preventDefault();
  callActiveRuntime('handleKey', event);
});

window.addEventListener('paste', (event) => {
  const text = event.clipboardData?.getData('text/plain') || '';
  if (!text) {
    return;
  }
  event.preventDefault();
  callActiveRuntime('pasteText', text);
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    callActiveRuntime('kickRetroTubeVsyncDrift');
  }
});

window.addEventListener('resize', () => {
  if (mobileBrowserEnv) {
    scheduleMobileViewportSync();
    return;
  }
  syncTerminalGrid();
  callActiveRuntime('kickRetroTubeVsyncDrift');
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

function renderActiveRuntime(time) {
  try {
    activeRuntime.render(time);
  } catch (error) {
    forceTerminalRuntime(error);
    terminalRuntime.render(time);
  }
}

function applyActiveRuntime(time) {
  try {
    activeRuntime.apply?.(retroTube, time);
  } catch (error) {
    forceTerminalRuntime(error);
    terminalRuntime.apply?.(retroTube, time);
  }
}

function frame(time) {
  renderActiveRuntime(time);
  lowCanvas.present();
  applyActiveRuntime(time);
  retroTube?.render(time);
  if (previousFrameTime !== null) {
    fpsCounter.textContent = `FPS:${Math.round(1000 / (time - previousFrameTime))}`;
  }
  previousFrameTime = time;
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
