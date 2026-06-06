import './style.css';
import { CRT_CSS_IMAGE_ANTIALIAS, CrtRenderer } from './renderer.js';
import { CELL_H, CELL_W, Terminal } from './terminal.js';
import { WebGlFramebufferCanvas } from './webgl-framebuffer-canvas.js';

const crtCanvas = document.querySelector('#crtCanvas');
const screenWrap = document.querySelector('.screen-wrap');
const TERMINAL_DISPLAY_SCALE = 3;
crtCanvas.classList.toggle('is-antialiased', CRT_CSS_IMAGE_ANTIALIAS);
const initialGrid = getTerminalGrid();
crtCanvas.width = initialGrid.width;
crtCanvas.height = initialGrid.height;
const lowCanvas = new WebGlFramebufferCanvas(initialGrid.width, initialGrid.height);

const terminal = new Terminal(lowCanvas, { cols: initialGrid.cols, rows: initialGrid.rows });
const renderer = new CrtRenderer(crtCanvas, lowCanvas.canvas);

function getTerminalGrid() {
  const rect = screenWrap.getBoundingClientRect();
  const sourceWidth = rect.width || crtCanvas.clientWidth || crtCanvas.width;
  const sourceHeight = rect.height || crtCanvas.clientHeight || crtCanvas.height;
  const cols = Math.max(1, Math.floor(sourceWidth / (CELL_W * TERMINAL_DISPLAY_SCALE)));
  const rows = Math.max(1, Math.floor(sourceHeight / (CELL_H * TERMINAL_DISPLAY_SCALE)));
  return {
    cols,
    rows,
    width: cols * CELL_W,
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
  renderer.kickVsyncDrift();
}

new ResizeObserver(syncTerminalGrid).observe(screenWrap);

function getTerminalPoint(event) {
  const rect = crtCanvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * lowCanvas.width,
    y: ((event.clientY - rect.top) / rect.height) * lowCanvas.height,
  };
}

crtCanvas.addEventListener('click', (event) => {
  const { x, y } = getTerminalPoint(event);
  terminal.handlePointer(x, y);
});

crtCanvas.addEventListener('mousemove', (event) => {
  const { x, y } = getTerminalPoint(event);
  crtCanvas.style.cursor = terminal.handlePointerMove(x, y) ? 'pointer' : '';
});

crtCanvas.addEventListener('mouseleave', () => {
  terminal.handlePointerLeave();
  crtCanvas.style.cursor = '';
});

crtCanvas.addEventListener('wheel', (event) => {
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
    renderer.kickVsyncDrift();
  }
});

window.addEventListener('resize', () => {
  syncTerminalGrid();
  renderer.kickVsyncDrift();
});

terminal.boot();

function frame(time) {
  terminal.render(time);
  lowCanvas.present();
  renderer.render(time);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
