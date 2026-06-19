const DEFAULT_COLS = 64;
const DEFAULT_ROWS = 16;
export const CELL_W = 8;
export const CELL_H = 16;
const CRT_FONT_FAMILY = '"MS Gothic", monospace';
const CRT_FONT_SIZE = 16;
// 同時に発光アニメーションできる文字数。
const MAX_GLYPH_TASKS = 14;
// 白い矩形から文字画像へ到達するまでのフレーム数。
const GLYPH_STEPS = 20;
// 1フレームで新しく開始できる文字タスク数。
const MAX_TEXT_GLYPH_STARTS_PER_FRAME = 1;

// 同時に発光アニメーションできる画像ブロック数。
const MAX_IMAGE_TASKS = 80;
// 白い矩形から画像ブロックへ到達するまでのフレーム数。
const IMAGE_STEPS = 20;
// 1フレームで新しく開始できる画像ブロックタスク数。
const MAX_IMAGE_GLYPH_STARTS_PER_FRAME = 2;
// 1フレームで処理するテキスト文字数。
const TEXT_OUTPUT_CHARS_PER_FRAME = 1;
const MAX_SCROLLBACK_ROWS = 256;
const MDS_ROOT_PATH = '/var/www/mds';
const GLYPH_CACHE_LIMIT = 4096;

const PALETTE = [
  '#060806',
  '#b43d3d',
  '#45b86a',
  '#c9b458',
  '#4a82d8',
  '#b85ad8',
  '#53b8c8',
  '#d8d0bd',
  '#60685f',
  '#ff6565',
  '#7fff9c',
  '#fff06a',
  '#74a7ff',
  '#df87ff',
  '#80f2ff',
  '#fff8e6',
];

const COLOR_NAMES = {
  black: 0,
  red: 9,
  green: 10,
  yellow: 11,
  blue: 12,
  magenta: 13,
  cyan: 14,
  white: 15,
  gray: 8,
  grey: 8,
};

const DEFAULT_TEXT_STATE = { fg: 10, bg: 0, bold: false, inverse: false, underline: false, strike: false };
const GRAPHEME_SEGMENTER = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const measuredCharWidths = new Map();
const glyphTargetCache = new Map();
let measureDomHost;
let measureDomText = null;
let measuredDomFont = '';
let measuredDomHalfWidth = null;
let measuredDomFullWidth = null;

function freshTextState() {
  return { ...DEFAULT_TEXT_STATE };
}

function getCrtFont(bold = false) {
  return `${bold ? 700 : 400} ${CRT_FONT_SIZE}px ${CRT_FONT_FAMILY}`;
}

function readNextGrapheme(text, index) {
  const firstCodePoint = text.codePointAt(index);
  const firstCodePointSize = firstCodePoint > 0xffff ? 2 : 1;

  // 単独の結合文字は、AA のセル配置を維持するため1文字ずつ扱う。
  if (isCombiningCodePoint(firstCodePoint)) {
    return { value: text.slice(index, index + firstCodePointSize), nextIndex: index + firstCodePointSize };
  }

  if (GRAPHEME_SEGMENTER) {
    const iterator = GRAPHEME_SEGMENTER.segment(text.slice(index))[Symbol.iterator]();
    const segment = iterator.next().value?.segment;
    if (segment) {
      const standaloneCombiningIndex = findStandaloneCellCombiningIndex(segment);
      const value = standaloneCombiningIndex > 0 ? segment.slice(0, standaloneCombiningIndex) : segment;
      return { value, nextIndex: index + value.length };
    }
  }

  let nextIndex = index + firstCodePointSize;

  while (nextIndex < text.length) {
    const codePoint = text.codePointAt(nextIndex);
    const size = codePoint > 0xffff ? 2 : 1;
    if (isStandaloneCellCombiningCodePoint(codePoint)) {
      break;
    }
    if (isCombiningCodePoint(codePoint) || isVariationSelectorCodePoint(codePoint)) {
      nextIndex += size;
      continue;
    }
    if (codePoint === 0x200d && nextIndex + size < text.length) {
      nextIndex += size;
      const joinedCodePoint = text.codePointAt(nextIndex);
      nextIndex += joinedCodePoint > 0xffff ? 2 : 1;
      continue;
    }
    break;
  }

  return { value: text.slice(index, nextIndex), nextIndex };
}

function isCombiningCodePoint(codePoint) {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isStandaloneCellCombiningCodePoint(codePoint) {
  return codePoint >= 0x035c && codePoint <= 0x0362;
}

function findStandaloneCellCombiningIndex(text) {
  let index = 0;

  for (const char of text) {
    if (index > 0 && isStandaloneCellCombiningCodePoint(char.codePointAt(0))) {
      return index;
    }
    index += char.length;
  }

  return -1;
}

function isVariationSelectorCodePoint(codePoint) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

function getMeasureFont() {
  return `${CRT_FONT_SIZE}px ${CRT_FONT_FAMILY}`;
}

function getMeasureDomText() {
  if (measureDomHost !== undefined) {
    return measureDomText;
  }

  if (typeof document === 'undefined') {
    throw new Error('DOM text measurement requires document.');
  }

  const measureRoot = document.body ?? document.documentElement;

  if (!measureRoot) {
    throw new Error('DOM text measurement root is unavailable.');
  }

  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.left = '-10000px';
  host.style.top = '-10000px';
  host.style.visibility = 'hidden';
  host.style.pointerEvents = 'none';
  host.style.whiteSpace = 'pre';
  host.style.contain = 'layout style';

  const text = document.createElement('span');
  text.style.display = 'inline-block';
  text.style.margin = '0';
  text.style.padding = '0';
  text.style.border = '0';
  text.style.whiteSpace = 'pre';

  host.appendChild(text);
  measureRoot.appendChild(host);
  measureDomHost = host;
  measureDomText = text;
  return text;
}

function ensureDomMeasureFont(text, font) {
  if (measuredDomFont === font) {
    return;
  }

  text.style.font = font;
  measuredDomFont = font;
  measuredDomHalfWidth = null;
  measuredDomFullWidth = null;
}

function measureDomTextWidth(text, value) {
  text.textContent = value;
  return text.getBoundingClientRect().width;
}

function getMeasuredDomHalfWidth(text) {
  if (measuredDomHalfWidth === null) {
    measuredDomHalfWidth = measureDomTextWidth(text, 'A');
  }

  return measuredDomHalfWidth;
}

function getMeasuredDomFullWidth(text) {
  if (measuredDomFullWidth === null) {
    measuredDomFullWidth = measureDomTextWidth(text, 'あ');
  }

  return measuredDomFullWidth;
}

function toCellWidth(charWidth, halfWidth, fullWidth) {
  if (halfWidth <= 0 || fullWidth <= 0 || charWidth < 0) {
    throw new Error(`Invalid DOM text measurement: char=${charWidth}, half=${halfWidth}, full=${fullWidth}`);
  }

  return Math.abs(charWidth - fullWidth) < Math.abs(charWidth - halfWidth) ? 2 : 1;
}

function getWebCharWidth(char) {
  if (char === '') {
    return 1;
  }

  const font = getMeasureFont();
  const cacheKey = `${font}\n${char}`;
  const cachedWidth = measuredCharWidths.get(cacheKey);

  if (cachedWidth) {
    return cachedWidth;
  }

  const text = getMeasureDomText();
  ensureDomMeasureFont(text, font);
  const halfWidth = getMeasuredDomHalfWidth(text);
  const fullWidth = getMeasuredDomFullWidth(text);
  const charWidth = measureDomTextWidth(text, char);
  const width = toCellWidth(charWidth, halfWidth, fullWidth);
  measuredCharWidths.set(cacheKey, width);
  return width;
}

function isFullWidth(char) {
  return getWebCharWidth(char) === 2;
}

function isBlankChar(char) {
  return char === ' ' || char === '　';
}

function freshCell() {
  return {
    ch: ' ',
    fg: 10,
    bg: 0,
    bold: false,
    inverse: false,
    underline: false,
    strike: false,
    link: null,
    linkAuto: false,
    wideTail: false,
  };
}

function freshRow(cols) {
  return Array.from({ length: cols }, freshCell);
}

function imageCell(imageData, link = null, offsetX = 0) {
  return {
    ...freshCell(),
    media: 'image-block',
    imageData,
    blockWidth: imageData.width,
    blockHeight: imageData.height,
    offsetX,
    link,
  };
}

function invertImageData(imageData) {
  const inverted = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  for (let i = 0; i < inverted.data.length; i += 4) {
    inverted.data[i] = 255 - inverted.data[i];
    inverted.data[i + 1] = 255 - inverted.data[i + 1];
    inverted.data[i + 2] = 255 - inverted.data[i + 2];
  }
  return inverted;
}

function dir(children) {
  return { type: 'dir', children };
}

function file(content, options = {}) {
  return { type: 'file', content, ...options };
}

function hexToRgb(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function isImagePath(path) {
  return /\.(?:jpe?g|png|gif|webp)$/i.test(path);
}

function makeWhiteImageData(width, height) {
  const imageData = new ImageData(width, height);
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] = 255;
    imageData.data[i + 1] = 255;
    imageData.data[i + 2] = 255;
    imageData.data[i + 3] = 255;
  }
  return imageData;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`cannot load image: ${url}`));
    image.src = url;
  });
}

function resolveTextColor(value) {
  if (typeof value === 'number') {
    return PALETTE[value] || PALETTE[10];
  }
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) {
    return value;
  }
  return PALETTE[10];
}

function makeGlyphTarget({ char, width, fg, bg, bold, inverse, underline, strike }) {
  const cacheKey = [
    char,
    width,
    fg,
    bg,
    bold ? 1 : 0,
    inverse ? 1 : 0,
    underline ? 1 : 0,
    strike ? 1 : 0,
  ].join('\0');
  const cached = glyphTargetCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const fgColor = hexToRgb(resolveTextColor(inverse ? bg : fg));
  const bgColor = hexToRgb(resolveTextColor(inverse ? fg : bg));
  const glyphCanvas = document.createElement('canvas');
  glyphCanvas.width = width;
  glyphCanvas.height = CELL_H;
  const glyphCtx = glyphCanvas.getContext('2d', { willReadFrequently: true });
  glyphCtx.fillStyle = `rgb(${bgColor.r}, ${bgColor.g}, ${bgColor.b})`;
  glyphCtx.fillRect(0, 0, width, CELL_H);
  glyphCtx.fillStyle = `rgb(${fgColor.r}, ${fgColor.g}, ${fgColor.b})`;
  glyphCtx.font = getCrtFont(bold);
  glyphCtx.textAlign = 'center';
  glyphCtx.textBaseline = 'middle';
  if (char) {
    glyphCtx.fillText(char, width / 2, CELL_H / 2);
  }
  if (underline) {
    glyphCtx.fillRect(0, CELL_H - 3, width, 1);
  }
  if (strike) {
    glyphCtx.fillRect(0, Math.floor(CELL_H / 2), width, 1);
  }

  const imageData = glyphCtx.getImageData(0, 0, width, CELL_H);
  if (glyphTargetCache.size >= GLYPH_CACHE_LIMIT) {
    glyphTargetCache.clear();
  }
  glyphTargetCache.set(cacheKey, imageData);
  return imageData;
}

function shouldPaintTextCell(cell) {
  if (!cell || cell.wideTail) {
    return false;
  }
  if (!isBlankChar(cell.ch || ' ')) {
    return true;
  }
  return cell.bg !== DEFAULT_TEXT_STATE.bg || cell.inverse || cell.underline || cell.strike;
}

class ImageBlockTask {
  constructor({ x, y, target }) {
    this.x = x;
    this.y = y;
    this.width = target.width;
    this.height = target.height;
    this.step = 0;
    this.current = makeWhiteImageData(this.width, this.height);
    this.target = target;
  }

  tick(ctx) {
    if (this.y + this.height <= 0 || this.y >= ctx.canvas.height) {
      return true;
    }
    const current = this.current.data;
    const target = this.target.data;
    const progress = Math.min(1, (this.step + 1) / IMAGE_STEPS);
    for (let i = 0; i < current.length; i += 4) {
      current[i] = Math.round(255 + (target[i] - 255) * progress);
      current[i + 1] = Math.round(255 + (target[i + 1] - 255) * progress);
      current[i + 2] = Math.round(255 + (target[i + 2] - 255) * progress);
      current[i + 3] = 255;
    }
    ctx.putImageData(this.current, this.x, this.y);
    this.step += 1;
    return this.step >= IMAGE_STEPS;
  }

  finish(ctx) {
    ctx.putImageData(this.target, this.x, this.y);
  }
}

class GlyphTask {
  constructor({ x, y, char, fg, bg, bold, inverse, underline, strike }) {
    this.x = x;
    this.y = y;
    this.char = char;
    this.width = isFullWidth(char) ? CELL_W * 2 : CELL_W;
    this.height = CELL_H;
    this.step = 0;
    this.current = makeWhiteImageData(this.width, this.height);
    this.target = new ImageData(this.width, this.height);
    this.prepare({ fg, bg, bold, inverse, underline, strike });
  }

  prepare({ fg, bg, bold, inverse, underline, strike }) {
    this.target = makeGlyphTarget({ char: this.char, width: this.width, fg, bg, bold, inverse, underline, strike });
  }

  tick(ctx) {
    if (this.y + this.height <= 0 || this.y >= ctx.canvas.height) {
      return true;
    }
    const current = this.current.data;
    const target = this.target.data;
    const progress = Math.min(1, (this.step + 1) / GLYPH_STEPS);
    for (let i = 0; i < current.length; i += 4) {
      current[i] = Math.round(255 + (target[i] - 255) * progress);
      current[i + 1] = Math.round(255 + (target[i + 1] - 255) * progress);
      current[i + 2] = Math.round(255 + (target[i + 2] - 255) * progress);
      current[i + 3] = 255;
    }
    ctx.putImageData(this.current, this.x, this.y);
    this.step += 1;
    return this.step >= GLYPH_STEPS;
  }

  finish(ctx) {
    ctx.putImageData(this.target, this.x, this.y);
  }
}

export class Terminal {
  constructor(canvas, { cols = DEFAULT_COLS, rows = DEFAULT_ROWS, startupMdsPath = '', startupVfsPath = '', testMode = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: this.rows }, () => freshRow(this.cols));
    this.scrollbackRows = [];
    this.scrollbackOffset = 0;
    this.viewportDirty = false;
    this.viewportCanvas = document.createElement('canvas');
    this.viewportCtx = this.viewportCanvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.cursorX = 0;
    this.cursorY = 0;
    this.state = freshTextState();
    this.stateStack = [];
    this.colorStack = [];
    this.bgColorStack = [];
    this.activeLink = null;
    this.command = '';
    this.lastCommand = '';
    this.fs = dir({});
    this.cwd = '/home/guest';
    this.cursorVisible = true;
    this.ready = false;
    this.startupMdsPath = startupMdsPath;
    this.startupVfsPath = startupVfsPath;
    this.currentMdsPath = '';
    this.currentVfsPath = '';
    this.testMode = testMode;
    this.skipAnimations = testMode;
    this.fastOutputActive = false;
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
    this.activeImageTasks = [];
    this.waitingImageTasks = [];
    this.waitingImageRows = [];
    this.outputQueue = [];
    this.imageActionPending = false;
    this.hoverRange = null;
    this.mdsBrowserActive = false;
  }

  resize(cols, rows) {
    if (cols === this.cols && rows === this.rows) {
      return;
    }

    this.setHoverRange(null);
    this.cols = cols;
    this.rows = rows;
    this.cells = this.resizeRows(this.cells, rows, cols);
    this.scrollbackRows = this.scrollbackRows.map((row) => this.resizeRow(row, cols));
    this.scrollbackOffset = Math.max(0, Math.min(this.scrollbackRows.length, this.scrollbackOffset));
    this.cursorX = Math.max(0, Math.min(this.cols - 1, this.cursorX));
    this.cursorY = Math.max(0, Math.min(this.rows - 1, this.cursorY));
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
    this.activeImageTasks = [];
    this.waitingImageTasks = [];
    this.waitingImageRows = [];
    this.requestViewportRepaint();
  }

  resizeRows(rows, nextRows, nextCols) {
    const resized = rows.slice(-nextRows).map((row) => this.resizeRow(row, nextCols));
    while (resized.length < nextRows) {
      resized.unshift(freshRow(nextCols));
    }
    return resized;
  }

  resizeRow(row, nextCols) {
    const resized = row.slice(0, nextCols);
    const last = resized[resized.length - 1];
    if (last?.wideTail || isFullWidth(last?.ch || '')) {
      resized[resized.length - 1] = freshCell();
    }
    while (resized.length < nextCols) {
      resized.push(freshCell());
    }
    return resized;
  }

  async boot() {
    this.clear();
    this.write('\x1b[92mIBM-PC COMPATIBLE CRT BIOS v0.86\x1b[0m\r\n');
    this.write('MEMORY TEST: 640K OK\r\n');
    this.write(`GEOMETRY: ${this.cols} COLS x ${this.rows} ROWS (${this.canvas.width}x${this.canvas.height})\r\n`);
    this.write('MOUNTING / FROM public/root ...\r\n');
    try {
      await this.loadFileSystem();
      this.ready = true;
      this.write('\x1b[36mANSI.SYS LOADED\x1b[0m\r\n');
      this.write('\x1b[36mROOTFS READY\x1b[0m\r\n\r\n');
      this.write('type \x1b[93mhelp\x1b[0m or \x1b[93mls -la\x1b[0m and press ENTER.\r\n\r\n');
      if (this.startupVfsPath) {
        this.openVfsPath(this.startupVfsPath);
      } else if (this.startupMdsPath) {
        this.mdsBrowser([this.startupMdsPath]);
      } else {
        await this.runStartupScript();
      }
    } catch (error) {
      this.write(`\x1b[91mROOTFS ERROR: ${error.message}\x1b[0m\r\n\r\n`);
    }
    if (!this.mdsBrowserActive) {
      this.showPrompt();
    }
  }

  async handleKey(event) {
    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      this.exitMdsBrowser();
      return;
    }
    if (event.key === 'PageUp') {
      this.scrollBack(this.rows);
      return;
    }
    if (event.key === 'PageDown') {
      this.scrollBack(-this.rows);
      return;
    }
    if (this.mdsBrowserActive) {
      return;
    }
    if (event.key === 'Enter') {
      await this.submitCommand();
      return;
    }
    if (event.key === 'ArrowUp') {
      if (this.lastCommand) {
        this.replaceCurrentCommand(this.lastCommand);
      }
      return;
    }
    if (event.key === 'Tab') {
      this.completePath();
      return;
    }
    if (event.key === 'Backspace') {
      if (this.command.length > 0) {
        this.command = this.command.slice(0, -1);
        this.backspace();
      }
      return;
    }
    if (event.key.length === 1 && /^[\x20-\x7e]$/.test(event.key)) {
      this.typeChar(event.key);
    }
  }

  async pasteText(text) {
    if (this.mdsBrowserActive) {
      return;
    }
    const normalized = text.replace(/\r\n?/g, '\n');
    for (const char of normalized) {
      if (char === '\n') {
        await this.submitCommand();
      } else if (/^[\x20-\x7e]$/.test(char)) {
        this.typeChar(char);
      }
    }
  }

  typeChar(char) {
    this.command += char;
    this.write(char);
  }

  async submitCommand() {
    this.write('\r\n');
    const command = this.command.trim();
    if (command) {
      this.lastCommand = command;
    }
    await this.runCommand(command);
    this.command = '';
    if (!this.mdsBrowserActive) {
      this.showPrompt();
    }
  }

  async handlePointer(x, y) {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(x / CELL_W)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL_H)));
    const link = this.getVisibleRows()[row]?.[col]?.link;
    if (!link) {
      return false;
    }
    await this.openLink(link);
    return true;
  }

  setFastOutputActive(active) {
    if (this.fastOutputActive === active) {
      return;
    }
    this.fastOutputActive = active;
    if (active) {
      this.finishOutputAnimations();
    }
  }

  shouldSkipOutputAnimations() {
    return this.skipAnimations || this.fastOutputActive;
  }

  finishOutputAnimations() {
    for (const task of [
      ...this.activeGlyphTasks,
      ...this.waitingGlyphTasks,
      ...this.activeImageTasks,
      ...this.waitingImageTasks,
    ]) {
      task.finish(this.ctx);
    }
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
    this.activeImageTasks = [];
    this.waitingImageTasks = [];
  }

  handlePointerMove(x, y) {
    const col = Math.max(0, Math.min(this.cols - 1, Math.floor(x / CELL_W)));
    const row = Math.max(0, Math.min(this.rows - 1, Math.floor(y / CELL_H)));
    const range = this.getLinkRange(row, col);
    this.setHoverRange(range);
    return Boolean(range);
  }

  handlePointerLeave() {
    this.setHoverRange(null);
  }

  handleWheel(deltaY) {
    const lines = Math.max(1, Math.ceil(Math.abs(deltaY) / CELL_H));
    this.scrollBack(deltaY > 0 ? -lines : lines);
  }

  scrollBack(lines) {
    const nextOffset = Math.max(0, Math.min(this.scrollbackRows.length, this.scrollbackOffset + lines));
    if (nextOffset === this.scrollbackOffset) {
      return;
    }
    this.setHoverRange(null);
    this.scrollbackOffset = nextOffset;
    this.requestViewportRepaint();
  }

  followOutput() {
    if (this.scrollbackOffset === 0) {
      return;
    }
    this.setHoverRange(null);
    this.scrollbackOffset = 0;
    this.requestViewportRepaint();
  }

  getLinkRange(row, col) {
    const rows = this.getVisibleRows();
    const cell = rows[row]?.[col];
    const link = cell?.link;
    if (!link) {
      return null;
    }
    if (cell.media === 'image-block') {
      return this.getImageLinkRange(rows, row, col, link);
    }
    let start = col;
    let end = col;
    while (start > 0 && rows[row][start - 1].link === link) {
      start -= 1;
    }
    while (end < this.cols - 1 && rows[row][end + 1].link === link) {
      end += 1;
    }
    return { type: 'text', row, start, end, link, key: `text:${row}:${start}:${end}:${link}` };
  }

  getImageLinkRange(rows, row, col, link) {
    const seen = new Set();
    const cells = [];
    const queue = [{ x: col, y: row }];
    while (queue.length > 0) {
      const current = queue.shift();
      const key = `${current.x},${current.y}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const cell = rows[current.y]?.[current.x];
      if (cell?.media !== 'image-block' || cell.link !== link) {
        continue;
      }
      cells.push(current);
      for (let y = current.y - 1; y <= current.y + 1; y += 1) {
        for (let x = current.x - 1; x <= current.x + 1; x += 1) {
          if ((x !== current.x || y !== current.y) && x >= 0 && x < this.cols && y >= 0 && y < this.rows) {
            queue.push({ x, y });
          }
        }
      }
    }
    cells.sort((a, b) => a.y - b.y || a.x - b.x);
    return {
      type: 'image',
      link,
      cells,
      key: `image:${link}:${cells.map((cell) => `${cell.x},${cell.y}`).join(';')}`,
    };
  }

  setHoverRange(range) {
    if (this.hoverRange && range && this.hoverRange.key === range.key) {
      return;
    }
    const previous = this.hoverRange;
    this.hoverRange = null;
    if (previous) {
      this.repaintRange(previous, false);
    }
    this.hoverRange = range;
    if (this.hoverRange) {
      this.repaintRange(this.hoverRange, true);
    }
  }

  replaceCurrentCommand(command) {
    for (let i = 0; i < this.command.length; i += 1) {
      this.backspace();
    }
    this.command = '';
    for (const char of command) {
      if (/^[\x20-\x7e]$/.test(char)) {
        this.command += char;
        this.write(char);
      }
    }
  }

  completePath() {
    const match = this.command.match(/(?:^|\s)(\S*)$/);
    if (!match) {
      return;
    }
    const token = match[1];
    const tokenStart = this.command.length - token.length;
    const completed = this.getPathCompletion(token);
    if (!completed || completed === token) {
      return;
    }
    const nextCommand = `${this.command.slice(0, tokenStart)}${completed}`;
    this.replaceCurrentCommand(nextCommand);
  }

  getPathCompletion(token) {
    const slashIndex = token.lastIndexOf('/');
    const dirToken = slashIndex >= 0 ? token.slice(0, slashIndex + 1) : '';
    const namePrefix = slashIndex >= 0 ? token.slice(slashIndex + 1) : token;
    const dirPath = dirToken || '.';
    const result = this.getNode(dirPath);
    if (!result.node || result.node.type !== 'dir') {
      return null;
    }
    const names = Object.entries(result.node.children)
      .filter(([name]) => name.startsWith(namePrefix))
      .map(([name, node]) => `${name}${node.type === 'dir' ? '/' : ''}`)
      .sort((a, b) => a.localeCompare(b));
    if (names.length === 0) {
      return null;
    }
    const suffix = names.length === 1 ? names[0] : this.commonPrefix(names);
    return `${dirToken}${suffix}`;
  }

  commonPrefix(values) {
    let prefix = values[0] || '';
    for (const value of values.slice(1)) {
      while (prefix && !value.startsWith(prefix)) {
        prefix = prefix.slice(0, -1);
      }
    }
    return prefix;
  }

  async runCommand(command) {
    const argv = this.parseArgs(command);
    const name = (argv[0] || '').toLowerCase();
    if (!name) {
      return;
    }
    if (!this.ready && name !== 'clear' && name !== 'cls' && name !== 'reload') {
      this.write('shell: root filesystem is not ready\r\n');
      return;
    }
    if (name === 'clear' || name === 'cls') {
      this.clear();
      return;
    }
    if (name === 'help') {
      this.write('\x1b[96mCOMMANDS\x1b[0m\r\n');
      this.write('  help      show command list\r\n');
      this.write('  about     show site profile\r\n');
      this.write('  projects  list experiments\r\n');
      this.write('  echo TEXT print text\r\n');
      this.write('  cd PATH   change directory\r\n');
      this.write('  ls -la    list files\r\n');
      this.write('  cat FILE  print file\r\n');
      this.write('  imgcat FILE.jpg [SIZE%]\r\n');
      this.write('  mds-browser FILE.mds\r\n');
      this.write('  reload    reload root filesystem\r\n');
      this.write('  ansi      print ANSI color test\r\n');
      this.write('  clear     clear screen\r\n');
      return;
    }
    if (name === 'about') {
      this.write('\x1b[92mElegg Retro CRT\x1b[0m\r\n');
      this.write(`${this.cols}x${this.rows} cells, 8x16 font with phosphor drift.\r\n`);
      this.write('日本語は全角セルで表示します。\r\n');
      return;
    }
    if (name === 'projects') {
      this.write('\x1b[93m01\x1b[0m CRT shader port\r\n');
      this.write('\x1b[93m02\x1b[0m ANSI terminal simulator\r\n');
      this.write('\x1b[93m03\x1b[0m HSYNC / VSYNC instability\r\n');
      return;
    }
    if (name === 'echo') {
      this.write(`${argv.slice(1).join(' ')}\r\n`);
      return;
    }
    if (name === 'ansi') {
      for (let i = 0; i < 16; i += 1) {
        const code = i < 8 ? 30 + i : 90 + i - 8;
        this.write(`\x1b[${code}mCOLOR ${String(i).padStart(2, '0')}\x1b[0m `);
        if (i % 4 === 3) {
          this.write('\r\n');
        }
      }
      return;
    }
    if (name === 'pwd') {
      this.write(`${this.cwd}\r\n`);
      return;
    }
    if (name === 'cd') {
      this.changeDirectory(argv[1] || '/home/guest');
      return;
    }
    if (name === 'ls') {
      this.listDirectory(argv);
      return;
    }
    if (name === 'cat') {
      this.catFile(argv.slice(1));
      return;
    }
    if (name === 'imgcat') {
      await this.imgCat(argv.slice(1));
      return;
    }
    if (name === 'mds-browser') {
      this.mdsBrowser(argv.slice(1));
      return;
    }
    if (name === 'reload') {
      await this.reloadFileSystem();
      return;
    }
    this.write(`Bad command or file name: ${command}\r\n`);
  }

  async runStartupScript() {
    const result = this.getNode('/home/guest/.eshrc');
    if (!result.node || result.node.type !== 'file' || result.node.media === 'image/jpeg') {
      return;
    }
    const lines = result.node.content.split(/\r\n|\n|\r/);
    for (const line of lines) {
      const command = line.trim();
      if (!command || command.startsWith('#')) {
        continue;
      }
      await this.runCommand(command);
      if (this.mdsBrowserActive) {
        return;
      }
    }
  }

  showPrompt() {
    this.write(`\x1b[92mguest@elegg:${this.cwd}$ \x1b[0m`);
  }

  async loadFileSystem() {
    const manifestResponse = await fetch('/root-manifest.json', { cache: 'no-store' });
    if (!manifestResponse.ok) {
      throw new Error(`manifest ${manifestResponse.status}`);
    }
    const manifest = await manifestResponse.json();
    const sizes = manifest.sizes || {};
    this.fs = dir({});
    for (const path of manifest.dirs || []) {
      this.ensureDirectory(path);
    }
    for (const path of manifest.files || []) {
      if (isImagePath(path)) {
        this.writeImageFile(path, sizes[path] ?? 0);
        continue;
      }
      const response = await fetch(`/root/${path}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`${path} ${response.status}`);
      }
      const content = (await response.text()).replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '');
      this.writeFile(path, content, sizes[path] ?? content.length);
    }
  }

  async reloadFileSystem() {
    this.ready = false;
    this.write('reloading root filesystem...\r\n');
    try {
      await this.loadFileSystem();
      this.ready = true;
      if (!this.getNode(this.cwd).node) {
        this.cwd = this.getNode('/home/guest').node ? '/home/guest' : '/';
      }
      this.write('rootfs ready\r\n');
    } catch (error) {
      this.write(`reload: ${error.message}\r\n`);
    }
  }

  ensureDirectory(path) {
    let node = this.fs;
    for (const part of this.normalizePath(path).slice(1).split('/').filter(Boolean)) {
      node.children[part] ||= dir({});
      node = node.children[part];
      if (node.type !== 'dir') {
        throw new Error(`${path} is blocked by a file`);
      }
    }
  }

  writeFile(path, content, size = content.length) {
    const parts = this.normalizePath(`/${path}`).slice(1).split('/').filter(Boolean);
    const name = parts.pop();
    this.ensureDirectory(`/${parts.join('/')}`);
    let node = this.fs;
    for (const part of parts) {
      node = node.children[part];
    }
    node.children[name] = file(content, { size });
  }

  writeImageFile(path, size = 0) {
    const parts = this.normalizePath(`/${path}`).slice(1).split('/').filter(Boolean);
    const name = parts.pop();
    this.ensureDirectory(`/${parts.join('/')}`);
    let node = this.fs;
    for (const part of parts) {
      node = node.children[part];
    }
    node.children[name] = file('', {
      media: 'image',
      url: `/root/${path}`,
      size,
    });
  }

  parseArgs(command) {
    return command.match(/"[^"]*"|'[^']*'|\S+/g)?.map((part) => part.replace(/^["']|["']$/g, '')) || [];
  }

  normalizePath(path) {
    const source = path?.startsWith('/') ? path : `${this.cwd}/${path || ''}`;
    const parts = [];
    for (const part of source.split('/')) {
      if (!part || part === '.') {
        continue;
      }
      if (part === '..') {
        parts.pop();
      } else {
        parts.push(part);
      }
    }
    return `/${parts.join('/')}`;
  }

  getNode(path) {
    const normalized = this.normalizePath(path);
    if (normalized === '/') {
      return { node: this.fs, path: normalized, name: '/' };
    }
    let node = this.fs;
    const parts = normalized.slice(1).split('/');
    for (const part of parts) {
      if (node.type !== 'dir' || !node.children[part]) {
        return { node: null, path: normalized, name: part };
      }
      node = node.children[part];
    }
    return { node, path: normalized, name: parts[parts.length - 1] };
  }

  changeDirectory(path) {
    const result = this.getNode(path);
    if (!result.node) {
      this.write(`cd: no such file or directory: ${path}\r\n`);
      return;
    }
    if (result.node.type !== 'dir') {
      this.write(`cd: not a directory: ${path}\r\n`);
      return;
    }
    this.cwd = result.path;
  }

  listDirectory(argv) {
    const paths = argv.filter((arg) => !arg.startsWith('-')).slice(1);
    const target = paths[0] || '.';
    const result = this.getNode(target);
    if (!result.node) {
      this.write(`ls: cannot access '${target}': No such file or directory\r\n`);
      return;
    }
    if (result.node.type === 'file') {
      this.write(this.formatEntry(result.name, result.node));
      return;
    }
    const entries = [
      ['.', result.node],
      ['..', this.getNode(`${result.path}/..`).node || this.fs],
      ...Object.entries(result.node.children).sort(([a], [b]) => a.localeCompare(b)),
    ];
    for (const [name, node] of entries) {
      this.write(this.formatEntry(name, node));
    }
  }

  formatEntry(name, node) {
    const isDir = node.type === 'dir';
    const mode = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
    const size = isDir ? 512 : (node.size ?? node.content.length);
    const label = isDir ? `\x1b[94m${name}\x1b[0m` : name;
    return `${mode} 1 guest guest ${String(size).padStart(5, ' ')} Jun 04 00:00 ${label}\r\n`;
  }

  catFile(paths) {
    if (paths.length === 0) {
      this.write('cat: missing operand\r\n');
      return;
    }
    for (const path of paths) {
      const result = this.getNode(path);
      if (!result.node) {
        this.write(`cat: ${path}: No such file or directory\r\n`);
        continue;
      }
      if (result.node.type !== 'file') {
        this.write(`cat: ${path}: Is a directory\r\n`);
        continue;
      }
      if (result.node.media === 'image/jpeg') {
        this.write(`cat: ${path}: Is a binary file\r\n`);
        continue;
      }
      this.write(`${result.node.content}\r\n`);
    }
  }

  mdsBrowser(paths, { basePath = '', updateHistory = false } = {}) {
    const path = paths[0];
    if (!path) {
      this.write('mds-browser: missing file operand\r\n');
      return;
    }
    if (!/\.mds$/i.test(path)) {
      this.write(`mds-browser: ${path}: only .mds is supported\r\n`);
      return;
    }
    const resolvedPath = this.resolveMdsPath(path, basePath);
    const result = this.getNode(resolvedPath);
    if (!result.node) {
      this.write(`mds-browser: ${path}: No such file or directory\r\n`);
      return;
    }
    if (result.node.type !== 'file') {
      this.write(`mds-browser: ${path}: Is a directory\r\n`);
      return;
    }
    this.mdsBrowserActive = true;
    this.currentMdsPath = result.path;
    this.currentVfsPath = result.path;
    if (updateHistory) {
      this.pushMdsHistory(result.path);
    }
    const content = this.expandMdsIncludes(result.node.content, result.path, [result.path]);
    this.writeMds(`${content}\r\n`);
  }

  resolveMdsPath(path, basePath = '') {
    if (path.startsWith('/')) {
      return this.normalizePath(path);
    }
    const base = basePath || (this.mdsBrowserActive && this.currentMdsPath ? this.dirname(this.currentMdsPath) : this.cwd);
    return this.normalizePath(`${base}/${path}`);
  }

  dirname(path) {
    const normalized = this.normalizePath(path);
    const slash = normalized.lastIndexOf('/');
    return slash <= 0 ? '/' : normalized.slice(0, slash);
  }

  expandMdsIncludes(text, sourcePath, includeStack) {
    const lines = String(text).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) || [];
    let fence = null;
    let output = '';

    for (const line of lines) {
      const content = line.replace(/(?:\r\n|\r|\n)$/, '');
      const lineBreak = line.slice(content.length);
      const fenceTag = content.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);

      if (fence) {
        output += line;
        if (
          fenceTag &&
          fenceTag[1][0] === fence.marker &&
          fenceTag[1].length >= fence.length &&
          fenceTag[2].trim() === ''
        ) {
          fence = null;
        }
        continue;
      }

      if (fenceTag) {
        fence = { marker: fenceTag[1][0], length: fenceTag[1].length };
        output += line;
        continue;
      }

      output += this.expandMdsIncludeTags(content, sourcePath, includeStack) + lineBreak;
    }

    return output;
  }

  expandMdsIncludeTags(text, sourcePath, includeStack) {
    return text.replace(/<include\b[^>\r\n]*>/gi, (source) => {
      const body = source.slice('<include'.length, -1).trim();
      if (!body.endsWith('/')) {
        return this.formatMdsIncludeError('self-closing tag is required');
      }

      const attrs = this.parseMdsAttrs(body.slice(0, -1));
      const src = String(attrs.src || '').trim();
      if (!src) {
        return this.formatMdsIncludeError('src is required');
      }
      if (src.startsWith('/')) {
        return this.formatMdsIncludeError(`${src}: only relative paths are supported`);
      }
      if (!/\.mds$/i.test(src)) {
        return this.formatMdsIncludeError(`${src}: only .mds is supported`);
      }

      const includePath = this.normalizePath(`${this.dirname(sourcePath)}/${src}`);
      if (includePath !== MDS_ROOT_PATH && !includePath.startsWith(`${MDS_ROOT_PATH}/`)) {
        return this.formatMdsIncludeError(`${src}: path is outside ${MDS_ROOT_PATH}`);
      }

      const result = this.getNode(includePath);
      if (!result.node) {
        return this.formatMdsIncludeError(`${src}: No such file or directory`);
      }
      if (result.node.type !== 'file') {
        return this.formatMdsIncludeError(`${src}: Is a directory`);
      }
      if (includeStack.includes(result.path)) {
        return this.formatMdsIncludeError(`${src}: circular reference`);
      }

      return this.expandMdsIncludes(result.node.content, result.path, [...includeStack, result.path]);
    });
  }

  formatMdsIncludeError(message) {
    const safeMessage = String(message).replaceAll('<', '‹').replaceAll('>', '›').replace(/[\r\n]/g, ' ');
    return `<color="red">[include error: ${safeMessage}]<color>`;
  }

  pushMdsHistory(path) {
    const params = new URLSearchParams(window.location.search);
    params.delete('vfs');
    params.set('mds', path);
    const query = params.toString();
    window.history.pushState({ mds: path }, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  resolveVfsPath(value, basePath = '') {
    const source = String(value || '').trim();
    const path = source.startsWith('vfs:') ? source.slice('vfs:'.length) : source;
    return this.resolveMdsPath(path, basePath);
  }

  getVfsNode(value, basePath = '') {
    const path = this.resolveVfsPath(value, basePath);
    return this.getNode(path);
  }

  pushVfsHistory(path) {
    const params = new URLSearchParams(window.location.search);
    params.delete('mds');
    params.set('vfs', path);
    const query = params.toString();
    window.history.pushState({ vfs: path }, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }

  openVfsPath(path, { basePath = '', updateHistory = false } = {}) {
    const result = this.getVfsNode(path, basePath || this.dirname(this.currentVfsPath || this.currentMdsPath || this.cwd));
    if (!result.node) {
      this.write(`vfs: ${path}: No such file or directory\r\n`);
      return;
    }
    if (result.node.type !== 'file') {
      this.write(`vfs: ${path}: Is a directory\r\n`);
      return;
    }
    if (/\.mds$/i.test(result.path)) {
      this.mdsBrowser([result.path], { updateHistory });
      return;
    }
    if (result.node.media === 'image') {
      this.showVfsImage(result, { updateHistory });
      return;
    }
    this.write(`vfs: ${path}: Unsupported file type\r\n`);
  }

  showVfsImage(result, { updateHistory = false } = {}) {
    this.mdsBrowserActive = true;
    this.currentVfsPath = result.path;
    this.clearMdsScreen();
    if (updateHistory) {
      this.pushVfsHistory(result.path);
    }
    this.enqueueOutputAction(() => {
      this.imageActionPending = true;
      loadImage(result.node.url).then((image) => {
        this.drawImageFromNextLine(image, {
          targetWidth: Math.min(image.naturalWidth || this.canvas.width, this.canvas.width),
          align: 'center',
        });
        this.imageActionPending = false;
      }).catch((error) => {
        this.imageActionPending = false;
        this.write(`vfs: ${error.message}\r\n`);
      });
    });
  }

  exitMdsBrowser() {
    if (!this.mdsBrowserActive) {
      return;
    }
    this.mdsBrowserActive = false;
    this.write('\r\n^C\r\n');
    this.showPrompt();
  }

  writeMds(text) {
    let index = 0;
    while (index < text.length) {
      const rest = text.slice(index);
      const tag = this.parseMdsTag(rest);
      if (tag) {
        const consumed = this.writeMdsTag(tag);
        if (consumed > 0) {
          index += consumed;
          continue;
        }
      }

      if (rest.startsWith('[[clear]]')) {
        this.enqueueOutputAction(() => this.clearMdsScreen());
        index += '[[clear]]'.length;
        continue;
      }

      const markdownLink = rest.match(/^\[([^\]\r\n]+)\]\(([^)\r\n]+)\)/);
      if (markdownLink) {
        this.writeLinkedText(markdownLink[1], markdownLink[2], { fg: 14, bold: true, inverse: true, underline: true });
        index += markdownLink[0].length;
        continue;
      }

      const autoUrl = rest.match(/^https?:\/\/[^\s)]+/);
      if (autoUrl) {
        this.writeLinkedText(autoUrl[0], autoUrl[0], { fg: 14, bold: true, underline: true });
        index += autoUrl[0].length;
        continue;
      }

      const boldText = rest.match(/^\*([^*\r\n]+)\*/);
      if (boldText) {
        this.outputQueue.push({ type: 'style-push', style: { bold: true } });
        this.write(boldText[1]);
        this.outputQueue.push({ type: 'style-pop' });
        index += boldText[0].length;
        continue;
      }

      const grapheme = readNextGrapheme(text, index);
      this.write(grapheme.value);
      index = grapheme.nextIndex;
    }
  }

  parseMdsTag(text) {
    const match = text.match(/^<([/a-zA-Z][^>\r\n]*)>/);
    if (!match) {
      return null;
    }
    const source = match[0];
    const body = match[1].trim();
    if (body.startsWith('/')) {
      return { source, sourceContext: text, name: body.slice(1).trim().toLowerCase(), closing: true, attrs: {} };
    }
    const colorMatch = body.match(/^(color|bgcolor)(?:\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+)))?$/i);
    if (colorMatch) {
      return {
        source,
        sourceContext: text,
        name: colorMatch[1].toLowerCase(),
        closing: false,
        attrs: { value: colorMatch[2] ?? colorMatch[3] ?? colorMatch[4] ?? '' },
      };
    }
    const [name = '', ...rest] = body.split(/\s+/);
    return {
      source,
      sourceContext: text,
      name: name.toLowerCase(),
      closing: false,
      attrs: this.parseMdsAttrs(rest.join(' ')),
    };
  }

  parseMdsAttrs(text) {
    const attrs = {};
    for (const match of text.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
    }
    return attrs;
  }

  writeMdsTag(tag) {
    if (tag.name === 'clear' && !tag.closing) {
      this.enqueueOutputAction(() => this.clearMdsScreen());
      return tag.source.length;
    }
    if (tag.name === 'color' && !tag.closing) {
      this.outputQueue.push(tag.attrs.value ? { type: 'color-push', fg: this.parseMdsColor(tag.attrs.value) } : { type: 'color-pop' });
      return tag.source.length;
    }
    if (tag.name === 'bgcolor' && !tag.closing) {
      this.outputQueue.push(
        tag.attrs.value ? { type: 'bgcolor-push', bg: this.parseMdsColor(tag.attrs.value, DEFAULT_TEXT_STATE.bg) } : { type: 'bgcolor-pop' },
      );
      return tag.source.length;
    }
    const rangeTags = {
      u: { underline: true },
      s: { strike: true },
      inv: { inverse: true },
    };
    if (rangeTags[tag.name] && !tag.closing) {
      const close = `</${tag.name}>`;
      const end = this.findMdsCloseTag(tag.sourceContext, close, tag.source.length);
      if (end >= 0) {
        this.outputQueue.push({ type: 'style-push', style: rangeTags[tag.name] });
        this.writeMds(tag.sourceContext.slice(tag.source.length, end));
        this.outputQueue.push({ type: 'style-pop' });
        return end + close.length;
      }
      this.outputQueue.push({ type: 'style-push', style: rangeTags[tag.name] });
      return tag.source.length;
    }
    if (rangeTags[tag.name] && tag.closing) {
      this.outputQueue.push({ type: 'style-pop' });
      return tag.source.length;
    }
    return this.writeMdsComplexTag(tag);
  }

  writeMdsComplexTag(tag) {
    if (tag.name === 'a' && !tag.closing) {
      const close = '</a>';
      const end = this.findMdsCloseTag(tag.sourceContext, close, tag.source.length);
      if (end < 0 || !tag.attrs.href) {
        return 0;
      }
      const content = tag.sourceContext.slice(tag.source.length, end);
      const imageTag = this.parseMdsTag(content.trim());
      if (imageTag?.name === 'img' && !imageTag.closing && imageTag.source.length === content.trim().length) {
        this.writeMdsImage(imageTag.attrs, tag.attrs.href);
      } else {
        this.outputQueue.push({ type: 'style-push', style: { fg: 14, bold: true, underline: true } });
        this.outputQueue.push({ type: 'link-start', target: tag.attrs.href });
        this.writeMds(content);
        this.outputQueue.push({ type: 'link-end' });
        this.outputQueue.push({ type: 'style-pop' });
      }
      return end + close.length;
    }
    if (tag.name === 'img' && !tag.closing) {
      this.writeMdsImage(tag.attrs, null);
      return tag.source.length;
    }
    return 0;
  }

  findMdsCloseTag(text, close, start) {
    return text.toLowerCase().indexOf(close.toLowerCase(), start);
  }

  parseMdsColor(value, fallback = DEFAULT_TEXT_STATE.fg) {
    const color = String(value || '').trim().toLowerCase();
    if (!color) {
      return fallback;
    }
    if (/^#[0-9a-f]{6}$/i.test(color)) {
      return color;
    }
    return COLOR_NAMES[color] ?? fallback;
  }

  writeMdsImage(attrs, link) {
    const src = attrs.src;
    if (!src) {
      return;
    }
    const imageResult = this.resolveMdsImage(src);
    if (imageResult.error) {
      this.write(`img: ${imageResult.error}\r\n`);
      return;
    }
    const align = ['left', 'center', 'right'].includes(attrs.align) ? attrs.align : 'left';
    this.enqueueOutputAction(() => {
      this.imageActionPending = true;
      try {
        loadImage(imageResult.url).then((image) => {
          this.drawImageFromNextLine(image, {
            targetWidth: Math.min(image.naturalWidth || this.canvas.width, this.canvas.width),
            align,
            link,
          });
          this.imageActionPending = false;
        }).catch((error) => {
          this.imageActionPending = false;
          this.write(`img: ${error.message}\r\n`);
        });
      } catch (error) {
        this.imageActionPending = false;
        this.write(`img: ${error.message}\r\n`);
      }
    });
  }

  resolveMdsImage(src) {
    const value = String(src || '').trim();
    if (/^https?:\/\//i.test(value)) {
      return { url: value };
    }
    if (!value.startsWith('vfs:')) {
      return { url: value };
    }
    if (value.startsWith('vfs:/root/')) {
      return { error: `${value}: /root is not a virtual filesystem path` };
    }
    const path = this.resolveVfsPath(value, this.dirname(this.currentMdsPath));
    if (!isImagePath(path)) {
      return { error: `${value}: only image files are supported` };
    }
    const result = this.getNode(path);
    if (!result.node) {
      return { error: `${value}: No such file or directory` };
    }
    if (result.node.type !== 'file') {
      return { error: `${value}: Is a directory` };
    }
    if (result.node.media !== 'image') {
      return { error: `${value}: Not an image file` };
    }
    return { path: result.path, url: result.node.url };
  }

  writeLinkedText(text, target, style) {
    this.outputQueue.push({ type: 'style-push', style });
    this.outputQueue.push({ type: 'link-start', target });
    this.write(text);
    this.outputQueue.push({ type: 'link-end' });
    this.outputQueue.push({ type: 'style-pop' });
  }

  async openLink(target) {
    if (/^https?:\/\//i.test(target)) {
      window.open(target, '_blank', 'noopener,noreferrer');
      return;
    }
    if (target.startsWith('vfs:')) {
      this.openVfsPath(target, { basePath: this.dirname(this.currentVfsPath || this.currentMdsPath), updateHistory: true });
      return;
    }
    if (target.startsWith('page:')) {
      this.write(`\r\nlink: page: is deprecated; use vfs:\r\n`);
      return;
    }
    if (target.startsWith('cmd:')) {
      const command = target.slice('cmd:'.length).trim();
      this.write(`\r\n$ ${command}\r\n`);
      await this.runCommand(command);
      if (!this.mdsBrowserActive) {
        this.showPrompt();
      }
      return;
    }
    this.write(`\r\nlink: unsupported target: ${target}\r\n`);
  }

  async imgCat(args) {
    const [path, sizeArg] = args;
    if (!path) {
      this.write('imgcat: missing file operand\r\n');
      return;
    }
    if (!isImagePath(path)) {
      this.write(`imgcat: ${path}: only image files are supported\r\n`);
      return;
    }
    const result = this.getNode(path);
    if (!result.node) {
      this.write(`imgcat: ${path}: No such file or directory\r\n`);
      return;
    }
    if (result.node.type !== 'file') {
      this.write(`imgcat: ${path}: Is a directory\r\n`);
      return;
    }
    if (result.node.media !== 'image') {
      this.write(`imgcat: ${path}: Not an image file\r\n`);
      return;
    }

    const scalePercent = this.parseImagePercent(sizeArg);
    if (scalePercent === null) {
      this.write(`imgcat: invalid size: ${sizeArg}\r\n`);
      return;
    }

    try {
      const image = await loadImage(result.node.url);
      this.enqueueOutputAction(() => this.drawImageFromNextLine(image, { scalePercent }));
    } catch (error) {
      this.write(`imgcat: ${error.message}\r\n`);
    }
  }

  parseImagePercent(value) {
    if (!value) {
      return 100;
    }
    const match = value.match(/^(\d+(?:\.\d+)?)%$/);
    if (!match) {
      return null;
    }
    const percent = Number(match[1]);
    if (!Number.isFinite(percent) || percent <= 0) {
      return null;
    }
    return percent;
  }

  drawImageFromNextLine(image, { scalePercent = null, targetWidth = null, align = 'left', link = null } = {}) {
    this.followOutput();
    const width = Math.max(
      1,
      Math.min(
        this.canvas.width,
        targetWidth === null ? Math.round(this.canvas.width * ((scalePercent || 100) / 100)) : targetWidth,
      ),
    );
    const targetHeight = Math.max(1, Math.round(width * (image.naturalHeight / image.naturalWidth)));
    const offsetX = this.getImageOffsetX(width, align);
    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = width;
    imageCanvas.height = targetHeight;
    const imageCtx = imageCanvas.getContext('2d', { willReadFrequently: true });
    imageCtx.drawImage(image, 0, 0, width, targetHeight);

    this.moveToNextImageLine();
    for (let sourceY = 0; sourceY < targetHeight; sourceY += CELL_H) {
      const blockHeight = Math.min(CELL_H, targetHeight - sourceY);
      const blocks = [];
      for (let sourceX = 0; sourceX < width; sourceX += CELL_W) {
        const blockWidth = Math.min(CELL_W, width - sourceX);
        blocks.push({
          x: offsetX + sourceX,
          target: imageCtx.getImageData(sourceX, sourceY, blockWidth, blockHeight),
          link,
        });
      }
      this.waitingImageRows.push(blocks);
    }
  }

  getImageOffsetX(width, align) {
    if (align === 'center') {
      return Math.max(0, Math.floor((this.canvas.width - width) / 2));
    }
    if (align === 'right') {
      return Math.max(0, this.canvas.width - width);
    }
    return 0;
  }

  clear() {
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        this.cells[y][x] = freshCell();
      }
    }
    this.scrollbackRows = [];
    this.scrollbackOffset = 0;
    this.cursorX = 0;
    this.cursorY = 0;
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
    this.activeImageTasks = [];
    this.waitingImageTasks = [];
    this.waitingImageRows = [];
    this.outputQueue = [];
    this.stateStack = [];
    this.state = freshTextState();
    this.colorStack = [];
    this.bgColorStack = [];
    this.activeLink = null;
    this.hoverRange = null;
    this.imageActionPending = false;
    this.mdsBrowserActive = false;
    this.viewportDirty = false;
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  clearMdsScreen() {
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        this.cells[y][x] = freshCell();
      }
    }
    this.scrollbackRows = [];
    this.scrollbackOffset = 0;
    this.cursorX = 0;
    this.cursorY = 0;
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
    this.activeImageTasks = [];
    this.waitingImageTasks = [];
    this.waitingImageRows = [];
    this.state = freshTextState();
    this.stateStack = [];
    this.colorStack = [];
    this.bgColorStack = [];
    this.activeLink = null;
    this.imageActionPending = false;
    this.hoverRange = null;
    this.viewportDirty = false;
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  write(text) {
    for (let i = 0; i < text.length;) {
      const char = text[i];
      if (char === '\x1b' && text[i + 1] === '[') {
        const end = text.indexOf('m', i);
        const cursorEnd = text.slice(i).search(/[HfJ]/);
        if (end !== -1 && (cursorEnd === -1 || end < cursorEnd)) {
          this.outputQueue.push({ type: 'sgr', payload: text.slice(i + 2, end) });
          i = end + 1;
          continue;
        }
        if (cursorEnd !== -1) {
          const finalIndex = i + cursorEnd;
          this.outputQueue.push({
            type: 'cursor',
            payload: text.slice(i + 2, finalIndex),
            finalChar: text[finalIndex],
          });
          i = finalIndex + 1;
          continue;
        }
      }
      if (char === '\r' && text[i + 1] === '\n') {
        this.outputQueue.push({ type: 'char', char: '\n' });
        i += 2;
        continue;
      }
      const grapheme = readNextGrapheme(text, i);
      this.outputQueue.push({ type: 'char', char: grapheme.value });
      i = grapheme.nextIndex;
    }
  }

  enqueueOutputAction(action) {
    this.outputQueue.push({ type: 'action', action });
  }

  processOutputQueue() {
    if (
      this.waitingImageRows.length > 0 ||
      this.waitingImageTasks.length > 0 ||
      this.activeImageTasks.length > 0 ||
      this.imageActionPending
    ) {
      return;
    }
    let processed = 0;
    const skipOutputAnimations = this.shouldSkipOutputAnimations();
    const charLimit = skipOutputAnimations ? Number.POSITIVE_INFINITY : TEXT_OUTPUT_CHARS_PER_FRAME;
    while (this.outputQueue.length > 0 && processed < charLimit) {
      const item = this.outputQueue.shift();
      if (item.type === 'action') {
        item.action();
        break;
      }
      if (item.type === 'style-push') {
        this.stateStack.push({ ...this.state });
        this.state = { ...this.state, ...item.style };
        continue;
      }
      if (item.type === 'style-set') {
        this.state = { ...this.state, ...item.style };
        continue;
      }
      if (item.type === 'color-push') {
        this.colorStack.push(this.state.fg);
        this.state = { ...this.state, fg: item.fg };
        continue;
      }
      if (item.type === 'color-pop') {
        if (this.colorStack.length > 0) {
          this.state = { ...this.state, fg: this.colorStack.pop() };
        }
        continue;
      }
      if (item.type === 'bgcolor-push') {
        this.bgColorStack.push(this.state.bg);
        this.state = { ...this.state, bg: item.bg };
        continue;
      }
      if (item.type === 'bgcolor-pop') {
        if (this.bgColorStack.length > 0) {
          this.state = { ...this.state, bg: this.bgColorStack.pop() };
        }
        continue;
      }
      if (item.type === 'style-pop') {
        this.state = this.stateStack.pop() || freshTextState();
        continue;
      }
      if (item.type === 'link-start') {
        this.activeLink = item.target;
        continue;
      }
      if (item.type === 'link-end') {
        this.activeLink = null;
        continue;
      }
      if (item.type === 'sgr') {
        this.applySgr(item.payload);
        continue;
      }
      if (item.type === 'cursor') {
        this.applyCursor(item.payload, item.finalChar);
        continue;
      }
      if (item.type === 'char') {
        const isBlank = isBlankChar(item.char);
        if (
          !skipOutputAnimations &&
          !isBlank &&
          this.activeGlyphTasks.length + this.waitingGlyphTasks.length >= MAX_GLYPH_TASKS
        ) {
          this.outputQueue.unshift(item);
          break;
        }
        const didNewLine = this.processOutputChar(item.char);
        if (!isBlank) {
          processed += 1;
        }
        if (didNewLine) {
          break;
        }
      }
    }
  }

  processOutputChar(char) {
    this.followOutput();
    return this.putChar(char);
  }

  applySgr(payload) {
    const codes = payload ? payload.split(';').map((value) => Number(value || 0)) : [0];
    for (const code of codes) {
      if (code === 0) {
        this.state = freshTextState();
      } else if (code === 1) {
        this.state.bold = true;
      } else if (code === 4) {
        this.state.underline = true;
      } else if (code === 7) {
        this.state.inverse = true;
      } else if (code >= 30 && code <= 37) {
        this.state.fg = code - 30;
      } else if (code >= 40 && code <= 47) {
        this.state.bg = code - 40;
      } else if (code >= 90 && code <= 97) {
        this.state.fg = code - 90 + 8;
      } else if (code >= 100 && code <= 107) {
        this.state.bg = code - 100 + 8;
      }
    }
  }

  applyCursor(payload, finalChar) {
    if (finalChar === 'J' && (payload === '2' || payload === '')) {
      this.clear();
      return;
    }
    if (finalChar === 'H' || finalChar === 'f') {
      const [row = '1', col = '1'] = payload.split(';');
      this.cursorY = Math.max(0, Math.min(this.rows - 1, Number(row) - 1));
      this.cursorX = Math.max(0, Math.min(this.cols - 1, Number(col) - 1));
    }
  }

  putChar(char) {
    if (char === '\r') {
      this.cursorX = 0;
      return false;
    }
    if (char === '\n') {
      this.newLine();
      return true;
    }
    const width = isFullWidth(char) ? 2 : 1;
    if (this.cursorX + width > this.cols) {
      this.newLine();
    }
    const previousCell = this.cells[this.cursorY][this.cursorX];
    const cell = {
      ch: char,
      fg: this.state.fg,
      bg: this.state.bg,
      bold: this.state.bold,
      inverse: this.state.inverse,
      underline: this.state.underline,
      strike: this.state.strike,
      link: this.activeLink,
      linkAuto: false,
      wideTail: false,
    };
    this.cells[this.cursorY][this.cursorX] = cell;
    if (!isBlankChar(char)) {
      this.enqueueGlyphTask({
        x: this.cursorX * CELL_W,
        y: this.cursorY * CELL_H,
        char,
        fg: cell.fg,
        bg: cell.bg,
        bold: cell.bold,
        inverse: cell.inverse,
        underline: cell.underline,
        strike: cell.strike,
      });
    } else if (shouldPaintTextCell(cell) || shouldPaintTextCell(previousCell)) {
      this.ctx.putImageData(
        makeGlyphTarget({
          char,
          width: width * CELL_W,
          fg: cell.fg,
          bg: cell.bg,
          bold: cell.bold,
          inverse: cell.inverse,
          underline: cell.underline,
          strike: cell.strike,
        }),
        this.cursorX * CELL_W,
        this.cursorY * CELL_H,
      );
    }
    if (width === 2 && this.cursorX + 1 < this.cols) {
      this.cells[this.cursorY][this.cursorX + 1] = { ...cell, ch: '', wideTail: true };
    }
    this.markAutoLinksForRow(this.cursorY);
    this.cursorX += width;
    if (this.cursorX >= this.cols) {
      this.newLine();
    }
  }

  backspace() {
    if (this.cursorX === 0) {
      return;
    }
    this.cursorX -= 1;
    this.cells[this.cursorY][this.cursorX] = freshCell();
    this.markAutoLinksForRow(this.cursorY);
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(this.cursorX * CELL_W, this.cursorY * CELL_H, CELL_W, CELL_H);
  }

  markAutoLinksForRow(row) {
    const cells = this.cells[row];
    const line = cells.map((cell) => cell.ch || ' ').join('');
    for (const cell of cells) {
      if (cell.linkAuto) {
        cell.link = null;
        cell.linkAuto = false;
      }
    }
    for (const match of line.matchAll(/https?:\/\/[^\s)]+/g)) {
      const target = match[0];
      for (let x = match.index; x < match.index + target.length && x < this.cols; x += 1) {
        if (!cells[x].link) {
          cells[x].link = target;
          cells[x].linkAuto = true;
        }
      }
    }
  }

  repaintRange(range, hover) {
    const rows = this.getVisibleRows();
    if (range.type === 'image') {
      for (const cell of range.cells) {
        this.repaintCell(cell.x, cell.y, hover, rows);
      }
      return;
    }
    for (let x = range.start; x <= range.end; x += 1) {
      this.repaintCell(x, range.row, hover, rows);
    }
  }

  repaintCell(x, y, hover = false, rows = null) {
    const cell = (rows || this.getVisibleRows())[y]?.[x];
    if (!cell || cell.wideTail) {
      return;
    }
    this.paintCell(this.ctx, cell, x, y, hover);
  }

  paintCell(ctx, cell, x, y, hover = false) {
    if (cell.media === 'image-block') {
      this.repaintImageCell(cell, x, y, hover, ctx);
      return;
    }
    const char = cell.ch || ' ';
    const width = isFullWidth(char) ? CELL_W * 2 : CELL_W;
    const imageData = makeGlyphTarget({
      char,
      width,
      fg: cell.fg,
      bg: cell.bg,
      bold: cell.bold,
      inverse: hover ? !cell.inverse : cell.inverse,
      underline: cell.underline,
      strike: cell.strike,
    });
    ctx.putImageData(imageData, x * CELL_W, y * CELL_H);
  }

  getVisibleRows() {
    const scrollbackLength = this.scrollbackRows.length;
    const totalLength = scrollbackLength + this.cells.length;
    const end = Math.max(this.rows, totalLength - this.scrollbackOffset);
    const start = Math.max(0, end - this.rows);
    const visible = [];
    for (let index = start; index < end; index += 1) {
      visible.push(index < scrollbackLength ? this.scrollbackRows[index] : this.cells[index - scrollbackLength]);
    }
    while (visible.length < this.rows) {
      visible.unshift(freshRow(this.cols));
    }
    return visible;
  }

  requestViewportRepaint() {
    this.viewportDirty = true;
  }

  repaintViewport() {
    if (this.viewportCanvas.width !== this.canvas.width || this.viewportCanvas.height !== this.canvas.height) {
      this.viewportCanvas.width = this.canvas.width;
      this.viewportCanvas.height = this.canvas.height;
    }
    this.viewportCtx.fillStyle = PALETTE[0];
    this.viewportCtx.fillRect(0, 0, this.viewportCanvas.width, this.viewportCanvas.height);
    const rows = this.getVisibleRows();
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const cell = rows[y][x];
        if (!cell || cell.wideTail) {
          continue;
        }
        if (cell.media === 'image-block') {
          this.repaintImageCell(cell, x, y, false, this.viewportCtx);
        } else if (shouldPaintTextCell(cell)) {
          this.paintCell(this.viewportCtx, cell, x, y, false);
        }
      }
    }
    this.ctx.putImageData(
      this.viewportCtx.getImageData(0, 0, this.viewportCanvas.width, this.viewportCanvas.height),
      0,
      0,
    );
    this.viewportDirty = false;
  }

  repaintImageCell(cell, x, y, hover = false, ctx = this.ctx) {
    const destX = x * CELL_W + (cell.offsetX || 0);
    const destY = y * CELL_H;
    ctx.fillStyle = PALETTE[0];
    ctx.fillRect(destX, destY, cell.blockWidth, cell.blockHeight);
    ctx.putImageData(hover ? invertImageData(cell.imageData) : cell.imageData, destX, destY);
  }

  newLine() {
    this.cursorX = 0;
    if (this.cursorY < this.rows - 1) {
      this.cursorY += 1;
      return;
    }
    this.scrollUp();
  }

  render(time) {
    this.processOutputQueue();
    if (this.viewportDirty) {
      this.repaintViewport();
    }
    if (this.scrollbackOffset > 0) {
      return;
    }
    this.startWaitingImageRow();
    this.startWaitingImageTasks();
    this.startWaitingGlyphTasks();
    this.activeGlyphTasks = this.activeGlyphTasks.filter((task) => !task.tick(this.ctx));
    this.activeImageTasks = this.activeImageTasks.filter((task) => !task.tick(this.ctx));
    if (this.hoverRange) {
      this.repaintRange(this.hoverRange, true);
    }
  }

  enqueueGlyphTask(task) {
    if (this.shouldSkipOutputAnimations()) {
      const imageData = makeGlyphTarget({
        ...task,
        width: isFullWidth(task.char) ? CELL_W * 2 : CELL_W,
      });
      this.ctx.putImageData(imageData, task.x, task.y);
      return;
    }
    this.waitingGlyphTasks.push(new GlyphTask(task));
  }

  startWaitingGlyphTasks() {
    let started = 0;
    while (this.waitingGlyphTasks.length > 0 && this.activeGlyphTasks.length < MAX_GLYPH_TASKS) {
      this.activeGlyphTasks.push(this.waitingGlyphTasks.shift());
      started += 1;
      if (this.activeGlyphTasks.length >= MAX_GLYPH_TASKS) {
        break;
      }
      if (started >= MAX_TEXT_GLYPH_STARTS_PER_FRAME) {
        break;
      }
    }
  }

  startWaitingImageTasks() {
    let started = 0;
    while (this.waitingImageTasks.length > 0 && this.activeImageTasks.length < MAX_IMAGE_TASKS) {
      this.activeImageTasks.push(this.waitingImageTasks.shift());
      started += 1;
      if (started >= MAX_IMAGE_GLYPH_STARTS_PER_FRAME) {
        break;
      }
    }
  }

  startWaitingImageRow() {
    if (
      this.waitingImageRows.length === 0 ||
      this.waitingImageTasks.length > 0 ||
      this.activeImageTasks.length > 0 ||
      this.waitingGlyphTasks.length > 0 ||
      this.activeGlyphTasks.length > 0
    ) {
      return;
    }
    const blocks = this.waitingImageRows.shift();
    const destY = this.cursorY * CELL_H;
    for (const block of blocks) {
      const cellX = Math.floor(block.x / CELL_W);
      if (cellX >= 0 && cellX < this.cols) {
        this.cells[this.cursorY][cellX] = imageCell(block.target, block.link, block.x - cellX * CELL_W);
      }
      if (this.shouldSkipOutputAnimations()) {
        this.ctx.putImageData(block.target, block.x, destY);
        continue;
      }
      this.waitingImageTasks.push(
        new ImageBlockTask({
          x: block.x,
          y: destY,
          target: block.target,
        }),
      );
    }
    this.moveToNextImageLine();
  }

  moveToNextImageLine() {
    this.cursorX = 0;
    if (this.cursorY >= this.rows - 1) {
      this.scrollUp();
      return;
    }
    this.cursorY += 1;
  }

  pushScrollbackRow(row) {
    const preserveViewport = this.scrollbackOffset > 0;
    this.scrollbackRows.push(row);
    if (preserveViewport) {
      this.scrollbackOffset += 1;
    }
    if (this.scrollbackRows.length > MAX_SCROLLBACK_ROWS) {
      this.scrollbackRows.shift();
    }
    this.scrollbackOffset = Math.max(0, Math.min(this.scrollbackRows.length, this.scrollbackOffset));
    if (preserveViewport) {
      this.requestViewportRepaint();
    }
  }

  scrollUp() {
    this.pushScrollbackRow(this.cells.shift());
    this.cells.push(freshRow(this.cols));
    this.cursorY = this.rows - 1;
    if (this.scrollbackOffset > 0) {
      this.shiftOutputTasks();
      this.requestViewportRepaint();
      return;
    }
    this.scrollFramebuffer();
  }

  scrollFramebuffer() {
    if (this.hoverRange) {
      this.repaintRange(this.hoverRange, false);
    }
    this.hoverRange = null;
    this.ctx.drawImage(this.canvas, 0, CELL_H, this.canvas.width, this.canvas.height - CELL_H, 0, 0, this.canvas.width, this.canvas.height - CELL_H);
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(0, this.canvas.height - CELL_H, this.canvas.width, CELL_H);
    this.shiftOutputTasks();
  }

  shiftOutputTasks() {
    for (const task of [...this.activeGlyphTasks, ...this.waitingGlyphTasks, ...this.activeImageTasks, ...this.waitingImageTasks]) {
      task.y -= CELL_H;
    }
    this.activeGlyphTasks = this.activeGlyphTasks.filter((task) => task.y + task.height > 0);
    this.waitingGlyphTasks = this.waitingGlyphTasks.filter((task) => task.y + task.height > 0);
    this.activeImageTasks = this.activeImageTasks.filter((task) => task.y + task.height > 0);
    this.waitingImageTasks = this.waitingImageTasks.filter((task) => task.y + task.height > 0);
  }
}
