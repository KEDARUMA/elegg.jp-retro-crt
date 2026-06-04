import './style.css';
import { CRT_CSS_IMAGE_ANTIALIAS, CrtRenderer } from './renderer.js';
import { Terminal } from './terminal.js';

const crtCanvas = document.querySelector('#crtCanvas');
crtCanvas.classList.toggle('is-antialiased', CRT_CSS_IMAGE_ANTIALIAS);
const lowCanvas = document.createElement('canvas');
lowCanvas.width = 512;
lowCanvas.height = 256;

const terminal = new Terminal(lowCanvas);
const renderer = new CrtRenderer(crtCanvas, lowCanvas);

const controls = {
  curve: document.querySelector('#curve'),
  bleed: document.querySelector('#bleed'),
  sync: document.querySelector('#sync'),
  degauss: document.querySelector('#degauss'),
};

for (const [key, element] of Object.entries(controls)) {
  if (element instanceof HTMLInputElement) {
    element.addEventListener('input', () => {
      renderer.settings[key] = Number(element.value);
    });
  }
}

controls.degauss.addEventListener('click', () => {
  renderer.kickSync(1.4);
  terminal.write('\x1b[92m\r\nDEGAUSS COMPLETE\x1b[0m\r\n');
});

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

terminal.boot();

function frame(time) {
  terminal.render(time);
  renderer.render(time);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
