import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import charPalettes from "../data/char-palettes.json";
import { composeDocument } from "../model/composeLayers";
import { createEmptyDocument, createInitialToolState } from "../model/createDocument";
import { eraseCell, getCell, getCharWidth, getFirstGrapheme, getHeadCell, placeChar } from "../model/gridOperations";
import type { Cell, CompositedCell, Layer, Tool } from "../model/types";

type NormalPalette = {
  kind: "normal";
  id: string;
  name: string;
  columns?: number;
  startCode?: number;
  chars: string[];
};

type HistoryPalette = {
  kind: "history";
  id: string;
  name: string;
  columns: number;
  history: (string | null)[];
  editableChars: (string | null)[];
};

type KeyboardInputPalette = {
  kind: "keyboard-input";
  id: string;
  name: string;
  value: string;
};

type UnicodePalette = {
  kind: "unicode";
  id: string;
  name: string;
  query: string;
  scrollOffset: number;
};

type Palette = NormalPalette | HistoryPalette | KeyboardInputPalette | UnicodePalette;

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const HISTORY_CELL_COUNT = 128;
const HISTORY_STORAGE_KEY = "aa-maker.char-palette.history.v1";

type StoredHistoryPalette = {
  history?: unknown;
  editableChars?: unknown;
};

export function useAaMaker() {
  const normalPalettes = (charPalettes as Omit<NormalPalette, "kind">[]).map((palette) => ({ ...palette, kind: "normal" as const }));
  const storedHistory = loadStoredHistoryPalette();
  const palettes = reactive<Palette[]>([
    ...normalPalettes,
    {
      kind: "history",
      id: "history",
      name: "History",
      columns: 16,
      history: storedHistory.history,
      editableChars: storedHistory.editableChars,
    },
    {
      kind: "keyboard-input",
      id: "keyboard-input",
      name: "Keyboard Input",
      value: "",
    },
    {
      kind: "unicode",
      id: "unicode",
      name: "Unicode",
      query: "",
      scrollOffset: 0,
    },
  ]);
  const activePaletteId = ref(palettes[0]?.id ?? "");
  const documentModel = reactive(createEmptyDocument());
  const toolState = reactive(createInitialToolState());
  const gridZoom = ref(toolState.zoom);
  const isDrawing = ref(false);
  const selectionAnchor = ref<{ x: number; y: number } | null>(null);
  const lastDrawnCellKey = ref<string | null>(null);
  const lastDrawnPosition = ref<{ x: number; y: number } | null>(null);
  const cursorPosition = ref<{ x: number; y: number } | null>(null);

  const tools = [
    {
      id: "move",
      label: "移動",
      icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
      implemented: false,
    },
    {
      id: "select",
      label: "範囲選択",
      icon: '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M8 5v14M16 5v14M5 8h14M5 16h14"/>',
      implemented: true,
    },
    {
      id: "eyedropper",
      label: "スポイト",
      icon: '<path d="M14 4l6 6M13 5l7 7-9 9H5v-6zM7 17l3 3"/>',
      implemented: true,
    },
    {
      id: "pen",
      label: "ペン",
      icon: '<path d="M16 4l4 4-11 11H5v-4zM13 7l4 4"/>',
      implemented: true,
    },
    {
      id: "eraser",
      label: "消しゴム",
      icon: '<path d="M5 15l8-8 6 6-6 6H8zM11 19h9M9 12l6 6"/>',
      implemented: true,
    },
    {
      id: "text",
      label: "テキスト",
      icon: '<path d="M5 5h14M12 5v16M8 21h8"/>',
      implemented: false,
    },
    {
      id: "stamp",
      label: "スタンプ",
      icon: '<path d="M9 4h6v7l3 3v6H6v-6l3-3zM7 17h10"/>',
      implemented: false,
    },
    {
      id: "range-color",
      label: "範囲カラー",
      icon: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 14h16M14 4v16"/>',
      implemented: false,
    },
  ] as const;

  const gridCells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => ({
    x: index % GRID_COLUMNS,
    y: Math.floor(index / GRID_COLUMNS),
  }));

  const activePalette = computed(() => palettes.find((palette) => palette.id === activePaletteId.value) ?? palettes[0]);
  const zoomLabel = computed(() => `Zoom: ${Math.round(gridZoom.value * 100)}%`);
  const selectionStyle = computed(() => {
    if (toolState.selection.kind !== "rect") {
      return null;
    }

    return {
      left: `calc(var(--cell-width) * ${toolState.selection.x})`,
      top: `calc(var(--cell-height) * ${toolState.selection.y})`,
      width: `calc(var(--cell-width) * ${toolState.selection.width})`,
      height: `calc(var(--cell-height) * ${toolState.selection.height})`,
    };
  });
  const gridLineStyle = computed(() => {
    const color = isDarkColor(documentModel.canvasBGC) ? "255, 255, 255" : "0, 0, 0";

    return {
      "--grid-line-color": `rgba(${color}, 0.12)`,
      "--grid-line-major-color": `rgba(${color}, 0.24)`,
    };
  });
  const selectedPaletteCode = computed(() => {
    if (toolState.selectedChar === null) {
      return null;
    }

    if (activePalette.value.kind !== "normal") {
      return toolState.selectedChar.codePointAt(0) ?? null;
    }

    const index = activePalette.value.chars.indexOf(toolState.selectedChar);

    if (index < 0) {
      return null;
    }

    if (typeof activePalette.value.startCode === "number") {
      return activePalette.value.startCode + index;
    }

    return toolState.selectedChar.codePointAt(0) ?? null;
  });

  const compositedGrid = computed(() => composeDocument(documentModel));
  const info = computed(() => {
    const position = cursorPosition.value;

    if (!position) {
      return {
        x: "--",
        y: "--",
        w: "--",
        h: "--",
        char: null,
        fgc: "------",
        bgc: documentModel.canvasBGC,
      };
    }

    const cell = getHeadCell(getActiveLayer(), position.x, position.y);

    return {
      x: String(position.x),
      y: String(position.y),
      w: toolState.selection.kind === "rect" ? String(toolState.selection.width) : "--",
      h: toolState.selection.kind === "rect" ? String(toolState.selection.height) : "--",
      char: cell?.char ?? null,
      fgc: cell?.fgc ?? "------",
      bgc: cell?.bgc ?? documentModel.canvasBGC,
    };
  });

  onMounted(() => {
    document.addEventListener("pointerup", stopDrawing);
    document.addEventListener("pointerleave", stopDrawing);
  });

  onUnmounted(() => {
    document.removeEventListener("pointerup", stopDrawing);
    document.removeEventListener("pointerleave", stopDrawing);
  });

  function selectTool(tool: Tool) {
    toolState.activeTool = tool;
  }

  function selectPaletteChar(char: string, width: 1 | 2) {
    setSelectedChar(char, width, true);
  }

  function selectPalette(paletteId: string) {
    activePaletteId.value = paletteId;
  }

  function handleKeyboardInput(value: string) {
    const palette = palettes.find((candidate) => candidate.kind === "keyboard-input");
    const firstChar = getFirstGrapheme(value);

    if (palette?.kind === "keyboard-input") {
      palette.value = value;
    }

    if (firstChar) {
      setSelectedChar(firstChar, getCharWidth(firstChar), true);
    }
  }

  function updateUnicodeQuery(query: string) {
    const palette = palettes.find((candidate) => candidate.kind === "unicode");

    if (palette?.kind === "unicode") {
      palette.query = query;
    }
  }

  function updateUnicodeScrollOffset(scrollOffset: number) {
    const palette = palettes.find((candidate) => candidate.kind === "unicode");

    if (palette?.kind === "unicode") {
      palette.scrollOffset = scrollOffset;
    }
  }

  function assignHistoryChar(index: number) {
    const palette = getHistoryPalette();

    if (!palette || index < 0 || index >= palette.editableChars.length || toolState.selectedChar === null) {
      return;
    }

    palette.editableChars[index] = toolState.selectedChar;
    saveHistoryPalette(palette);
  }

  function handleCellEnter(x: number, y: number) {
    cursorPosition.value = { x, y };

    if (isDrawing.value) {
      applyDragTool(x, y);
    }
  }

  function handleCellDown(x: number, y: number, event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (toolState.activeTool === "eyedropper") {
      applyTool(x, y);
      return;
    }

    if (toolState.activeTool === "select") {
      isDrawing.value = true;
      selectionAnchor.value = { x, y };
      updateSelection(x, y);
      return;
    }

    isDrawing.value = true;
    lastDrawnCellKey.value = null;
    applyDragTool(x, y);
  }

  function handleCellContext(x: number, y: number, event: MouseEvent) {
    event.preventDefault();
    pickChar(x, y);
  }

  function handleCellUp(x: number, y: number) {
    if (isDrawing.value) {
      applyDragTool(x, y);
    }

    stopDrawing();
  }

  function handleGridWheel(event: WheelEvent) {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.1 : -0.1;
    gridZoom.value = clamp(gridZoom.value + delta, 0.6, 2.4);
    document.documentElement.style.setProperty("--cell-width", `${Math.round(8 * gridZoom.value)}px`);
    document.documentElement.style.setProperty("--cell-height", `${Math.round(16 * gridZoom.value)}px`);
    document.documentElement.style.setProperty("--cell-font-size", `${Math.round(16 * gridZoom.value)}px`);
  }

  function applyTool(x: number, y: number) {
    const activeLayer = getActiveLayer();

    if (toolState.activeTool === "pen") {
      if (toolState.selectedChar === null) {
        eraseCell(activeLayer, x, y);
      } else {
        placeChar(activeLayer, x, y, toolState.selectedChar, toolState.selectedFGC, toolState.selectedBGC, toolState.selectedCharWidth);
      }
    }

    if (toolState.activeTool === "eraser") {
      eraseCell(activeLayer, x, y);
    }

    if (toolState.activeTool === "eyedropper") {
      pickChar(x, y);
    }

    cursorPosition.value = { x, y };
  }

  function applyDragTool(x: number, y: number) {
    if (toolState.activeTool === "select") {
      updateSelection(x, y);
      return;
    }

    const cellKey = `${x},${y}`;

    if (cellKey === lastDrawnCellKey.value) {
      return;
    }

    lastDrawnCellKey.value = cellKey;

    if (toolState.activeTool !== "pen" && toolState.activeTool !== "eraser") {
      return;
    }

    const positions = lastDrawnPosition.value ? getLinePositions(lastDrawnPosition.value.x, lastDrawnPosition.value.y, x, y) : [{ x, y }];

    for (const position of positions) {
      applyTool(position.x, position.y);
    }

    lastDrawnPosition.value = { x, y };
  }

  function stopDrawing() {
    isDrawing.value = false;
    selectionAnchor.value = null;
    lastDrawnCellKey.value = null;
    lastDrawnPosition.value = null;
  }

  function updateSelection(x: number, y: number) {
    const anchor = selectionAnchor.value ?? { x, y };
    const left = Math.min(anchor.x, x);
    const top = Math.min(anchor.y, y);
    const right = Math.max(anchor.x, x);
    const bottom = Math.max(anchor.y, y);

    toolState.selection = {
      kind: "rect",
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    };

    cursorPosition.value = { x, y };
  }

  function pickChar(x: number, y: number) {
    const cell = getHeadCell(getActiveLayer(), x, y);

    if (!cell) {
      setSelectedChar(null, 1, false);
      toolState.selectedBGC = null;
      return;
    }

    setSelectedChar(cell.char, cell.width, true);
    toolState.selectedFGC = cell.fgc;
    toolState.selectedBGC = cell.bgc;
  }

  function setSelectedChar(char: string | null, width: 1 | 2, shouldUpdateHistory: boolean) {
    toolState.selectedChar = char;
    toolState.selectedCharWidth = width;

    if (shouldUpdateHistory && char !== null) {
      pushHistoryChar(char);
    }
  }

  function pushHistoryChar(char: string) {
    const palette = getHistoryPalette();

    if (!palette || palette.history[0] === char) {
      return;
    }

    palette.history = [char, ...palette.history.filter((item) => item !== null)].slice(0, HISTORY_CELL_COUNT);

    while (palette.history.length < HISTORY_CELL_COUNT) {
      palette.history.push(null);
    }

    saveHistoryPalette(palette);
  }

  function getHistoryPalette() {
    return palettes.find((palette): palette is HistoryPalette => palette.kind === "history");
  }

  function getCellText(x: number, y: number) {
    const cell = getCell(getActiveLayer(), x, y);
    const compositedCell = compositedGrid.value[y][x];

    if (!cell || cell.kind === "empty") {
      return compositedCell.char === " " ? "\u00a0" : compositedCell.char;
    }

    if (cell.kind === "wide-tail") {
      return "\u00a0";
    }

    return cell.char;
  }

  function getCellClass(x: number, y: number) {
    const cell = getCell(getActiveLayer(), x, y);
    return cell?.kind === "wide-tail" ? ["is-wide-tail"] : [];
  }

  function getCellStyle(x: number, y: number) {
    const cell = getCell(getActiveLayer(), x, y);
    const compositedCell = compositedGrid.value[y][x];

    if (!cell || cell.kind === "empty") {
      return { backgroundColor: `#${compositedCell.bgc}` };
    }

    if (cell.kind === "wide-tail") {
      return {};
    }

    return {
      color: `#${cell.fgc}`,
      backgroundColor: `#${cell.bgc ?? documentModel.canvasBGC}`,
    };
  }

  function getActiveLayer(): Layer {
    const layer = documentModel.layers.find((candidate) => candidate.id === documentModel.activeLayerId);

    if (!layer) {
      throw new Error("Active layer was not found.");
    }

    return layer;
  }

  return {
    activePalette,
    activePaletteId,
    documentModel,
    gridCells,
    gridLineStyle,
    info,
    palettes,
    selectedPaletteCode,
    selectionStyle,
    toolState,
    tools,
    zoomLabel,
    getCellClass,
    getCellStyle,
    getCellText,
    handleCellContext,
    handleCellDown,
    handleCellEnter,
    handleCellUp,
    handleGridWheel,
    handleKeyboardInput,
    assignHistoryChar,
    selectPalette,
    selectPaletteChar,
    selectTool,
    stopDrawing,
    updateUnicodeQuery,
    updateUnicodeScrollOffset,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function loadStoredHistoryPalette() {
  const fallbackEditableChars = getInitialEditableHistoryChars();

  if (typeof localStorage === "undefined") {
    return {
      history: createEmptyHistoryChars(),
      editableChars: fallbackEditableChars,
    };
  }

  try {
    const rawValue = localStorage.getItem(HISTORY_STORAGE_KEY);

    if (!rawValue) {
      return {
        history: createEmptyHistoryChars(),
        editableChars: fallbackEditableChars,
      };
    }

    const parsedValue = JSON.parse(rawValue) as StoredHistoryPalette;

    return {
      history: normalizeHistoryChars(parsedValue.history, createEmptyHistoryChars()),
      editableChars: normalizeHistoryChars(parsedValue.editableChars, fallbackEditableChars),
    };
  } catch {
    return {
      history: createEmptyHistoryChars(),
      editableChars: fallbackEditableChars,
    };
  }
}

function saveHistoryPalette(palette: HistoryPalette) {
  if (typeof localStorage === "undefined") {
    return;
  }

  localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify({
      history: palette.history,
      editableChars: palette.editableChars,
    }),
  );
}

function createEmptyHistoryChars() {
  return Array.from({ length: HISTORY_CELL_COUNT }, () => null);
}

function getInitialEditableHistoryChars() {
  const firstPalette = charPalettes[0] as { chars?: string[] } | undefined;
  return normalizeHistoryChars(firstPalette?.chars, createEmptyHistoryChars());
}

function normalizeHistoryChars(value: unknown, fallback: (string | null)[]) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return Array.from({ length: HISTORY_CELL_COUNT }, (_, index) => (typeof value[index] === "string" ? value[index] : null));
}

function isDarkColor(hexColor: string) {
  const normalized = hexColor.replace(/^#/, "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (red * 299 + green * 587 + blue * 114) / 1000;

  return luminance < 128;
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
