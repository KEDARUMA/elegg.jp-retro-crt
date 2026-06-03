const COLS = 64;
const ROWS = 16;
const CELL_W = 8;
const CELL_H = 16;
// 同時に発光アニメーションできる文字数。
const MAX_GLYPH_TASKS = 14;
// 白い矩形から文字画像へ到達するまでのフレーム数。
const GLYPH_STEPS = 20;
// 1フレームで新しく開始できる文字タスク数。
const MAX_GLYPH_STARTS_PER_FRAME = 1;

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

function isFullWidth(char) {
  return /[^\u0000-\u00ff]/.test(char);
}

function freshCell() {
  return {
    ch: ' ',
    fg: 10,
    bg: 0,
    bold: false,
    inverse: false,
    wideTail: false,
  };
}

function dir(children) {
  return { type: 'dir', children };
}

function file(content) {
  return { type: 'file', content };
}

function hexToRgb(hex) {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

class GlyphTask {
  constructor({ x, y, char, fg, bg, bold, inverse }) {
    this.x = x;
    this.y = y;
    this.char = char;
    this.width = isFullWidth(char) ? CELL_W * 2 : CELL_W;
    this.height = CELL_H;
    this.step = 0;
    this.current = new ImageData(this.width, this.height);
    this.target = new ImageData(this.width, this.height);
    this.prepare({ fg, bg, bold, inverse });
  }

  prepare({ fg, bg, bold, inverse }) {
    const fgColor = hexToRgb(PALETTE[inverse ? bg : fg]);
    const bgColor = hexToRgb(PALETTE[inverse ? fg : bg]);
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = this.width;
    maskCanvas.height = this.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.clearRect(0, 0, this.width, this.height);
    maskCtx.fillStyle = '#fff';
    maskCtx.textBaseline = 'top';
    maskCtx.font = `${bold ? 700 : 400} 16px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if (this.char) {
      maskCtx.fillText(this.char, 0, -1);
    }
    const mask = maskCtx.getImageData(0, 0, this.width, this.height).data;

    for (let i = 0; i < this.current.data.length; i += 4) {
      this.current.data[i] = 255;
      this.current.data[i + 1] = 255;
      this.current.data[i + 2] = 255;
      this.current.data[i + 3] = 255;

      const alpha = mask[i + 3] / 255;
      this.target.data[i] = Math.round(bgColor.r + (fgColor.r - bgColor.r) * alpha);
      this.target.data[i + 1] = Math.round(bgColor.g + (fgColor.g - bgColor.g) * alpha);
      this.target.data[i + 2] = Math.round(bgColor.b + (fgColor.b - bgColor.b) * alpha);
      this.target.data[i + 3] = 255;
    }
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
}

export class Terminal {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.cells = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, freshCell));
    this.cursorX = 0;
    this.cursorY = 0;
    this.state = { fg: 10, bg: 0, bold: false, inverse: false };
    this.command = '';
    this.fs = dir({});
    this.cwd = '/home/guest';
    this.cursorVisible = true;
    this.ready = false;
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
  }

  async boot() {
    this.clear();
    this.write('\x1b[92mIBM-PC COMPATIBLE CRT BIOS v0.86\x1b[0m\r\n');
    this.write('MEMORY TEST: 640K OK\r\n');
    this.write('MOUNTING / FROM public/root ...\r\n');
    try {
      await this.loadFileSystem();
      this.ready = true;
      this.write('\x1b[36mANSI.SYS LOADED\x1b[0m\r\n');
      this.write('\x1b[36mROOTFS READY\x1b[0m\r\n\r\n');
      this.write('type \x1b[93mhelp\x1b[0m or \x1b[93mls -la\x1b[0m and press ENTER.\r\n\r\n');
    } catch (error) {
      this.write(`\x1b[91mROOTFS ERROR: ${error.message}\x1b[0m\r\n\r\n`);
    }
    this.showPrompt();
  }

  async handleKey(event) {
    if (event.key === 'Enter') {
      this.write('\r\n');
      await this.runCommand(this.command.trim());
      this.command = '';
      this.showPrompt();
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
      this.command += event.key;
      this.write(event.key);
    }
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
      this.write('  cd PATH   change directory\r\n');
      this.write('  ls -la    list files\r\n');
      this.write('  cat FILE  print file\r\n');
      this.write('  reload    reload root filesystem\r\n');
      this.write('  ansi      print ANSI color test\r\n');
      this.write('  clear     clear screen\r\n');
      return;
    }
    if (name === 'about') {
      this.write('\x1b[92mElegg Retro CRT\x1b[0m\r\n');
      this.write('512x256 offscreen terminal with phosphor drift.\r\n');
      this.write('日本語は全角セルで表示します。\r\n');
      return;
    }
    if (name === 'projects') {
      this.write('\x1b[93m01\x1b[0m CRT shader port\r\n');
      this.write('\x1b[93m02\x1b[0m ANSI terminal simulator\r\n');
      this.write('\x1b[93m03\x1b[0m HSYNC / VSYNC instability\r\n');
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
    if (name === 'reload') {
      await this.reloadFileSystem();
      return;
    }
    this.write(`Bad command or file name: ${command}\r\n`);
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
    this.fs = dir({});
    for (const path of manifest.dirs || []) {
      this.ensureDirectory(path);
    }
    for (const path of manifest.files || []) {
      const response = await fetch(`/root/${path}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`${path} ${response.status}`);
      }
      const content = (await response.text()).replace(/\r?\n/g, '\r\n').replace(/\r\n$/, '');
      this.writeFile(path, content);
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

  writeFile(path, content) {
    const parts = this.normalizePath(`/${path}`).slice(1).split('/').filter(Boolean);
    const name = parts.pop();
    this.ensureDirectory(`/${parts.join('/')}`);
    let node = this.fs;
    for (const part of parts) {
      node = node.children[part];
    }
    node.children[name] = file(content);
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
    const size = isDir ? 512 : node.content.length;
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
      this.write(`${result.node.content}\r\n`);
    }
  }

  clear() {
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        this.cells[y][x] = freshCell();
      }
    }
    this.cursorX = 0;
    this.cursorY = 0;
    this.activeGlyphTasks = [];
    this.waitingGlyphTasks = [];
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  write(text) {
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '\x1b' && text[i + 1] === '[') {
        const end = text.indexOf('m', i);
        const cursorEnd = text.slice(i).search(/[HfJ]/);
        if (end !== -1 && (cursorEnd === -1 || end < i + cursorEnd)) {
          this.applySgr(text.slice(i + 2, end));
          i = end;
          continue;
        }
        if (cursorEnd !== -1) {
          const finalIndex = i + cursorEnd;
          this.applyCursor(text.slice(i + 2, finalIndex), text[finalIndex]);
          i = finalIndex;
          continue;
        }
      }
      if (char === '\r') {
        this.cursorX = 0;
        continue;
      }
      if (char === '\n') {
        this.newLine();
        continue;
      }
      this.putChar(char);
    }
  }

  applySgr(payload) {
    const codes = payload ? payload.split(';').map((value) => Number(value || 0)) : [0];
    for (const code of codes) {
      if (code === 0) {
        this.state = { fg: 10, bg: 0, bold: false, inverse: false };
      } else if (code === 1) {
        this.state.bold = true;
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
      this.cursorY = Math.max(0, Math.min(ROWS - 1, Number(row) - 1));
      this.cursorX = Math.max(0, Math.min(COLS - 1, Number(col) - 1));
    }
  }

  putChar(char) {
    const width = isFullWidth(char) ? 2 : 1;
    if (this.cursorX + width > COLS) {
      this.newLine();
    }
    const cell = {
      ch: char,
      fg: this.state.fg,
      bg: this.state.bg,
      bold: this.state.bold,
      inverse: this.state.inverse,
      wideTail: false,
    };
    this.cells[this.cursorY][this.cursorX] = cell;
    this.enqueueGlyphTask({
      x: this.cursorX * CELL_W,
      y: this.cursorY * CELL_H,
      char,
      fg: cell.fg,
      bg: cell.bg,
      bold: cell.bold,
      inverse: cell.inverse,
    });
    if (width === 2 && this.cursorX + 1 < COLS) {
      this.cells[this.cursorY][this.cursorX + 1] = { ...cell, ch: '', wideTail: true };
    }
    this.cursorX += width;
    if (this.cursorX >= COLS) {
      this.newLine();
    }
  }

  backspace() {
    if (this.cursorX === 0) {
      return;
    }
    this.cursorX -= 1;
    this.cells[this.cursorY][this.cursorX] = freshCell();
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(this.cursorX * CELL_W, this.cursorY * CELL_H, CELL_W, CELL_H);
  }

  newLine() {
    this.cursorX = 0;
    this.cursorY += 1;
    if (this.cursorY < ROWS) {
      return;
    }
    this.cells.shift();
    this.cells.push(Array.from({ length: COLS }, freshCell));
    this.cursorY = ROWS - 1;
    this.scrollFramebuffer();
  }

  render(time) {
    this.startWaitingGlyphTasks();
    this.activeGlyphTasks = this.activeGlyphTasks.filter((task) => !task.tick(this.ctx));
  }

  enqueueGlyphTask(task) {
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
      if (started >= MAX_GLYPH_STARTS_PER_FRAME) {
        break;
      }
    }
  }

  scrollFramebuffer() {
    this.ctx.drawImage(this.canvas, 0, CELL_H, this.canvas.width, this.canvas.height - CELL_H, 0, 0, this.canvas.width, this.canvas.height - CELL_H);
    this.ctx.fillStyle = PALETTE[0];
    this.ctx.fillRect(0, this.canvas.height - CELL_H, this.canvas.width, CELL_H);
    for (const task of [...this.activeGlyphTasks, ...this.waitingGlyphTasks]) {
      task.y -= CELL_H;
    }
    this.activeGlyphTasks = this.activeGlyphTasks.filter((task) => task.y + task.height > 0);
    this.waitingGlyphTasks = this.waitingGlyphTasks.filter((task) => task.y + task.height > 0);
  }
}
