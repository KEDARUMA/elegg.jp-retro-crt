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

function getTerminalGrid() {
  if (testMode) {
    return {
      cols: TERMINAL_COLS,
      rows: 40,
      width: TERMINAL_COLS * CELL_W,
      height: 40 * CELL_H,
    };
  }
  const rect = screenWrap.getBoundingClientRect();
  const width = TERMINAL_COLS * CELL_W;
  const sourceWidth = rect.width || crtCanvas.clientWidth || width;
  const sourceHeight = rect.height || crtCanvas.clientHeight || crtCanvas.height;
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
  renderer?.kickVsyncDrift();
}

new ResizeObserver(syncTerminalGrid).observe(screenWrap);

function getTerminalPoint(event) {
  const rect = pointerCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * lowCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * lowCanvas.height,
  };
}

pointerCanvas.addEventListener('click', (event) => {
  const { x, y } = getTerminalPoint(event);
  terminal.handlePointer(x, y);
});

pointerCanvas.addEventListener('mousedown', (event) => {
  if (event.button === 0) {
    terminal.setFastOutputActive(true);
  }
});

window.addEventListener('mouseup', (event) => {
  if (event.button === 0) {
    terminal.setFastOutputActive(false);
  }
});

window.addEventListener('blur', () => {
  terminal.setFastOutputActive(false);
});

pointerCanvas.addEventListener('mousemove', (event) => {
  const { x, y } = getTerminalPoint(event);
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
