import "./style.css";
import charPalettes from "./data/char-palettes.json";
import { composeDocument } from "./model/composeLayers";
import { createEmptyDocument, createInitialToolState } from "./model/createDocument";
import { eraseCell, getCell, getHeadCell, placeChar } from "./model/gridOperations";
import type { Cell, CompositedCell, Layer, Tool } from "./model/types";

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const [activePalette] = charPalettes;
const documentModel = createEmptyDocument();
const toolState = createInitialToolState();
let gridZoom = toolState.zoom;
let isDrawing = false;
let lastDrawnCellKey: string | null = null;
let lastDrawnPosition: { x: number; y: number } | null = null;
const tools = [
  {
    id: "move",
    label: "移動",
    icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  },
  {
    id: "select",
    label: "範囲選択",
    icon: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M8 5v14M16 5v14M5 8h14M5 16h14"/>',
  },
  {
    id: "eyedropper",
    label: "スポイト",
    icon: '<path d="M14 4l6 6M13 5l7 7-9 9H5v-6zM7 17l3 3"/>',
  },
  {
    id: "pen",
    label: "ペン",
    icon: '<path d="M16 4l4 4-11 11H5v-4zM13 7l4 4"/>',
  },
  {
    id: "eraser",
    label: "消しゴム",
    icon: '<path d="M5 15l8-8 6 6-6 6H8zM11 19h9M9 12l6 6"/>',
  },
  {
    id: "text",
    label: "テキスト",
    icon: '<path d="M5 5h14M12 5v16M8 21h8"/>',
  },
  {
    id: "stamp",
    label: "スタンプ",
    icon: '<path d="M9 4h6v7l3 3v6H6v-6l3-3zM7 17h10"/>',
  },
  {
    id: "range-color",
    label: "範囲カラー",
    icon: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 14h16M14 4v16"/>',
  },
];

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("AA Maker mount target was not found.");
}

const gridCells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => {
  const x = index % GRID_COLUMNS;
  const y = Math.floor(index / GRID_COLUMNS);

  return `<div class="aa-cell" data-x="${x}" data-y="${y}" aria-label="cell ${x + 1},${y + 1}">&nbsp;</div>`;
}).join("");

const paletteItems = activePalette.chars
  .map((char, index) => {
    const code = activePalette.startCode + index;
    const selectedClass = index === 0 ? " is-selected" : "";

    return `<button class="palette-button${selectedClass}" type="button" data-code="${code}" title="0x${code.toString(16).padStart(2, "0")}">${char}</button>`;
  })
  .join("");

const toolButtons = tools
  .map((tool) => {
    const selectedClass = tool.id === "pen" ? " is-selected" : "";
    const implemented = tool.id === "pen" || tool.id === "eraser" || tool.id === "eyedropper";
    const disabled = implemented ? "" : " disabled";
    const title = implemented ? tool.label : `${tool.label} は未実装です`;

    return `
      <button class="tool-button${selectedClass}" type="button"${disabled} data-tool="${tool.id}" title="${title}" aria-label="${tool.label}">
        <svg aria-hidden="true" viewBox="0 0 24 24">
          ${tool.icon}
        </svg>
      </button>
    `;
  })
  .join("");

app.innerHTML = `
  <main class="aa-maker-shell" aria-label="AA Maker">
    <header class="top-menu">
      <nav class="menu-list" aria-label="Main menu">
        <button type="button">File</button>
        <button type="button">Image</button>
      </nav>
      <div class="status-bar">
        <span>Canvas BGC: ${documentModel.canvasBGC}</span>
      </div>
    </header>

    <aside class="toolbox" aria-label="Tools">
      <div class="tool-list">
        ${toolButtons}
      </div>
      <div class="selected-char" aria-label="Selected character">
        ${toolState.selectedChar}
      </div>
    </aside>

    <section class="editor-panel" aria-label="Editor">
      <div class="editor-toolbar">
        <span>80 x 25</span>
        <span id="zoom-label">Zoom: 100%</span>
      </div>
      <div class="grid-wrap">
        <div class="aa-grid" role="grid" aria-label="80 by 25 ASCII art grid">
          ${gridCells}
        </div>
      </div>
    </section>

    <aside class="side-panel" aria-label="Sidebar">
      <section class="panel-section info-panel">
        <h2>Info</h2>
        <div class="info-grid">
          <span>X</span><strong>--</strong>
          <span>Y</span><strong>--</strong>
          <span>W</span><strong>--</strong>
          <span>H</span><strong>--</strong>
        </div>
        <div class="cell-info">
          <div class="empty-cell-preview" aria-label="Empty cell preview"></div>
          <div>
            <div>FC:------</div>
            <div>BC:ffffff</div>
          </div>
        </div>
      </section>

      <section class="panel-section">
        <h2>Character Palette</h2>
        <label class="palette-select-label">
          <span>Palette</span>
          <select class="palette-select" aria-label="Character palette set">
            <option value="${activePalette.id}">${activePalette.name}</option>
          </select>
        </label>
        <div class="char-palette" aria-label="Character palette" style="--palette-columns: ${activePalette.columns}">
          ${paletteItems}
        </div>
      </section>

      <section class="panel-section">
        <h2>Layer</h2>
        ${documentModel.layers
          .map(
            (layer) => `
              <div class="layer-item${layer.id === documentModel.activeLayerId ? " is-active" : ""}">
                <span>${layer.name}</span>
                <span>${layer.visible ? "表示" : "非表示"}</span>
              </div>
            `,
          )
          .join("")}
      </section>

      <section class="panel-section panel-section--grow">
        <h2>Stamp</h2>
        <div class="empty-note">MVP 対象外</div>
      </section>
    </aside>
  </main>
`;

document.querySelectorAll<HTMLButtonElement>(".palette-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelector(".palette-button.is-selected")?.classList.remove("is-selected");
    button.classList.add("is-selected");
    const index = Number(button.dataset.code) - activePalette.startCode;
    const nextChar = activePalette.chars[index];

    if (nextChar) {
      toolState.selectedChar = nextChar;
      renderSelectedChar();
    }
  });
});

const editorPanel = document.querySelector<HTMLElement>(".editor-panel");
const grid = document.querySelector<HTMLElement>(".aa-grid");
const zoomLabel = document.querySelector<HTMLElement>("#zoom-label");
const selectedCharElement = document.querySelector<HTMLElement>(".selected-char");
const infoValues = document.querySelectorAll<HTMLElement>(".info-grid strong");
const cellInfo = document.querySelector<HTMLElement>(".cell-info");
const activeLayer = getActiveLayer();

document.querySelectorAll<HTMLButtonElement>(".tool-button[data-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    const nextTool = button.dataset.tool as Tool | undefined;

    if (!nextTool) {
      return;
    }

    toolState.activeTool = nextTool;
    document.querySelector(".tool-button.is-selected")?.classList.remove("is-selected");
    button.classList.add("is-selected");
  });
});

document.querySelectorAll<HTMLElement>(".aa-cell").forEach((cellElement) => {
  cellElement.addEventListener("pointerenter", () => {
    const position = getCellPosition(cellElement);

    if (!position) {
      return;
    }

    renderInfo(position.x, position.y);

    if (isDrawing) {
      applyDragTool(position.x, position.y);
    }
  });

  cellElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }

    const position = getCellPosition(cellElement);

    if (!position) {
      return;
    }

    event.preventDefault();
    isDrawing = true;
    lastDrawnCellKey = null;
    applyDragTool(position.x, position.y);
  });

  cellElement.addEventListener("pointerup", () => {
    stopDrawing();
  });

  cellElement.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const position = getCellPosition(cellElement);

    if (position) {
      pickChar(position.x, position.y);
    }
  });
});

document.addEventListener("pointerup", () => {
  stopDrawing();
});

document.addEventListener("pointerleave", () => {
  stopDrawing();
});

editorPanel?.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    gridZoom = clamp(gridZoom + delta, 0.6, 2.4);
    updateGridZoom();
  },
  { passive: false },
);

function updateGridZoom() {
  grid?.style.setProperty("--cell-width", `${Math.round(10 * gridZoom)}px`);
  grid?.style.setProperty("--cell-height", `${Math.round(18 * gridZoom)}px`);

  if (zoomLabel) {
    zoomLabel.textContent = `Zoom: ${Math.round(gridZoom * 100)}%`;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function applyTool(x: number, y: number) {
  if (toolState.activeTool === "pen") {
    if (toolState.selectedChar === null) {
      eraseCell(activeLayer, x, y);
    } else {
      placeChar(activeLayer, x, y, toolState.selectedChar, toolState.selectedFGC, toolState.selectedBGC);
    }
  }

  if (toolState.activeTool === "eraser") {
    eraseCell(activeLayer, x, y);
  }

  if (toolState.activeTool === "eyedropper") {
    pickChar(x, y);
  }

  renderGrid();
  renderInfo(x, y);
}

function applyDragTool(x: number, y: number) {
  const cellKey = `${x},${y}`;

  if (cellKey === lastDrawnCellKey) {
    return;
  }

  lastDrawnCellKey = cellKey;

  if (toolState.activeTool !== "pen" && toolState.activeTool !== "eraser") {
    return;
  }

  const positions = lastDrawnPosition ? getLinePositions(lastDrawnPosition.x, lastDrawnPosition.y, x, y) : [{ x, y }];

  for (const position of positions) {
    applyTool(position.x, position.y);
  }

  lastDrawnPosition = { x, y };
}

function stopDrawing() {
  isDrawing = false;
  lastDrawnCellKey = null;
  lastDrawnPosition = null;
}

function getLinePositions(fromX: number, fromY: number, toX: number, toY: number) {
  const positions = [];
  const dx = Math.abs(toX - fromX);
  const dy = Math.abs(toY - fromY);
  const sx = fromX < toX ? 1 : -1;
  const sy = fromY < toY ? 1 : -1;
  let error = dx - dy;
  let x = fromX;
  let y = fromY;

  while (true) {
    positions.push({ x, y });

    if (x === toX && y === toY) {
      break;
    }

    const error2 = error * 2;

    if (error2 > -dy) {
      error -= dy;
      x += sx;
    }

    if (error2 < dx) {
      error += dx;
      y += sy;
    }
  }

  return positions;
}

function pickChar(x: number, y: number) {
  const cell = getHeadCell(activeLayer, x, y);

  if (!cell) {
    toolState.selectedChar = null;
    toolState.selectedBGC = null;
    renderSelectedChar();
    syncPaletteSelection(null);
    return;
  }

  toolState.selectedChar = cell.char;
  toolState.selectedFGC = cell.fgc;
  toolState.selectedBGC = cell.bgc;
  renderSelectedChar();
  syncPaletteSelection(cell.char);
}

function renderGrid() {
  const compositedGrid = composeDocument(documentModel);

  document.querySelectorAll<HTMLElement>(".aa-cell").forEach((cellElement) => {
    const position = getCellPosition(cellElement);

    if (!position) {
      return;
    }

    renderCell(cellElement, getCell(activeLayer, position.x, position.y), compositedGrid[position.y][position.x]);
  });
}

function renderCell(cellElement: HTMLElement, cell: Cell | null, compositedCell: CompositedCell) {
  cellElement.classList.remove("is-wide-tail");
  cellElement.style.color = "";
  cellElement.style.backgroundColor = "";

  if (!cell || cell.kind === "empty") {
    cellElement.textContent = compositedCell.char === " " ? "\u00a0" : compositedCell.char;
    cellElement.style.backgroundColor = `#${compositedCell.bgc}`;
    return;
  }

  if (cell.kind === "wide-tail") {
    cellElement.textContent = "\u00a0";
    cellElement.classList.add("is-wide-tail");
    return;
  }

  cellElement.textContent = cell.char;
  cellElement.style.color = `#${cell.fgc}`;
  cellElement.style.backgroundColor = `#${cell.bgc ?? documentModel.canvasBGC}`;
}

function renderSelectedChar() {
  if (selectedCharElement) {
    selectedCharElement.textContent = toolState.selectedChar ?? "";
  }
}

function syncPaletteSelection(char: string | null) {
  document.querySelector(".palette-button.is-selected")?.classList.remove("is-selected");

  if (char === null) {
    return;
  }

  const index = activePalette.chars.indexOf(char);

  if (index < 0) {
    return;
  }

  const code = activePalette.startCode + index;
  document.querySelector<HTMLButtonElement>(`.palette-button[data-code="${code}"]`)?.classList.add("is-selected");
}

function renderInfo(x: number, y: number) {
  const cell = getHeadCell(activeLayer, x, y);

  infoValues[0].textContent = String(x);
  infoValues[1].textContent = String(y);
  infoValues[2].textContent = toolState.selection.kind === "rect" ? String(toolState.selection.width) : "--";
  infoValues[3].textContent = toolState.selection.kind === "rect" ? String(toolState.selection.height) : "--";

  if (!cellInfo) {
    return;
  }

  if (!cell) {
    cellInfo.innerHTML = `
      <div class="empty-cell-preview" aria-label="Empty cell preview"></div>
      <div>
        <div>FC:------</div>
        <div>BC:${documentModel.canvasBGC}</div>
      </div>
    `;
    return;
  }

  cellInfo.innerHTML = `
    <div class="cell-preview" aria-label="Cell preview">${cell.char}</div>
    <div>
      <div>FC:${cell.fgc}</div>
      <div>BC:${cell.bgc ?? documentModel.canvasBGC}</div>
    </div>
  `;
}

function getCellPosition(cellElement: HTMLElement) {
  const x = Number(cellElement.dataset.x);
  const y = Number(cellElement.dataset.y);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }

  return { x, y };
}

function getActiveLayer(): Layer {
  const layer = documentModel.layers.find((candidate) => candidate.id === documentModel.activeLayerId);

  if (!layer) {
    throw new Error("Active layer was not found.");
  }

  return layer;
}
