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

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  event.preventDefault();
  terminal.handleKey(event);
});

terminal.boot();

function frame(time) {
  terminal.render(time);
  renderer.render(time);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
