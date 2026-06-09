import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import eraserIcon from "../assets/icons/eraser.svg?raw";
import eyedropperIcon from "../assets/icons/eyedropper.svg?raw";
import moveIcon from "../assets/icons/move-alt.svg?raw";
import paletteIcon from "../assets/icons/palette.svg?raw";
import penIcon from "../assets/icons/pen.svg?raw";
import selectIcon from "../assets/icons/select.svg?raw";
import stampIcon from "../assets/icons/stamp.svg?raw";
import textIcon from "../assets/icons/text.svg?raw";
import charPalettes from "../data/char-palettes.json";
import stamps from "../data/stamps.json";
import { composeDocument } from "../model/composeLayers";
import { DEFAULT_DOCUMENT_NAME, createEmptyDocument, createInitialToolState, createLayer } from "../model/createDocument";
import { eraseCell, getCell, getCharWidth, getFirstGrapheme, getHeadCell, placeChar } from "../model/gridOperations";
import type { Cell, Document as AaDocument, Layer, Stamp, Tool } from "../model/types";

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

type StampSet = {
  id: string;
  name: string;
  stamps: Stamp[];
};

type StampPreviewCell = {
  x: number;
  y: number;
  text: string;
  style: Record<string, string>;
  className: string[];
};

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const HISTORY_CELL_COUNT = 128;
const HISTORY_STORAGE_KEY = "aa-maker.char-palette.history.v1";
const stampSetNames: Record<string, string> = {
  gikoneko: "Giko Neko",
  monar: "Monar",
  "speech-bubble": "Speech Bubble",
};

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
  const stampSets = createStampSets(stamps as Stamp[]);
  const activeStampSetId = ref(stampSets[0]?.id ?? "");
  const activeStampId = ref(stampSets[0]?.stamps[0]?.id ?? "");
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
      icon: moveIcon,
      implemented: false,
    },
    {
      id: "select",
      label: "範囲選択",
      icon: selectIcon,
      implemented: true,
    },
    {
      id: "eyedropper",
      label: "スポイト",
      icon: eyedropperIcon,
      implemented: true,
    },
    {
      id: "pen",
      label: "ペン",
      icon: penIcon,
      implemented: true,
    },
    {
      id: "eraser",
      label: "消しゴム",
      icon: eraserIcon,
      implemented: true,
    },
    {
      id: "text",
      label: "テキスト",
      icon: textIcon,
      implemented: false,
    },
    {
      id: "stamp",
      label: "スタンプ",
      icon: stampIcon,
      implemented: true,
    },
    {
      id: "range-color",
      label: "範囲カラー",
      icon: paletteIcon,
      implemented: false,
    },
  ] as const;

  const gridCells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => ({
    x: index % GRID_COLUMNS,
    y: Math.floor(index / GRID_COLUMNS),
  }));

  const activePalette = computed(() => palettes.find((palette) => palette.id === activePaletteId.value) ?? palettes[0]);
  const activeStampSet = computed(() => stampSets.find((stampSet) => stampSet.id === activeStampSetId.value) ?? stampSets[0] ?? null);
  const activeStamp = computed(() => activeStampSet.value?.stamps.find((stamp) => stamp.id === activeStampId.value) ?? activeStampSet.value?.stamps[0] ?? null);
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
  const stampPreviewCells = computed(() => {
    if (toolState.activeTool !== "stamp" || !activeStamp.value || !cursorPosition.value) {
      return [];
    }

    return getStampPreviewCells(activeStamp.value, cursorPosition.value.x, cursorPosition.value.y);
  });
  const layerList = computed(() => [...documentModel.layers].reverse());
  const info = computed(() => {
    const position = cursorPosition.value;

    if (!position) {
      return {
        x: "--",
        y: "--",
        w: "--",
        h: "--",
        char: null,
        code: "U+----",
        fgc: "------",
        bgc: documentModel.canvasBGC,
      };
    }

    const activeLayer = getEditableActiveLayer();
    const cell = activeLayer ? getHeadCell(activeLayer, position.x, position.y) : null;

    return {
      x: String(position.x),
      y: String(position.y),
      w: toolState.selection.kind === "rect" ? String(toolState.selection.width) : "--",
      h: toolState.selection.kind === "rect" ? String(toolState.selection.height) : "--",
      char: cell?.char ?? null,
      code: cell ? getUnicodeCodeLabel(cell.char) : "U+----",
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

  function saveDocument(name: string) {
    const trimmedName = name.trim() || DEFAULT_DOCUMENT_NAME;
    documentModel.name = trimmedName;
    downloadTextFile(`${toSafeJsonFilename(trimmedName)}.json`, JSON.stringify(documentModel, null, 2), "application/json");
  }

  async function loadDocument(file: File) {
    try {
      const rawText = await file.text();
      const parsedValue = JSON.parse(rawText) as unknown;
      const loadedDocument = normalizeLoadedDocument(parsedValue);

      if (!loadedDocument) {
        window.alert("Load failed: invalid AA Maker JSON.");
        return;
      }

      Object.assign(documentModel, loadedDocument);
      toolState.selection = { kind: "none" };
      cursorPosition.value = null;
    } catch {
      window.alert("Load failed: invalid AA Maker JSON.");
    }
  }

  function selectPaletteChar(char: string, width: 1 | 2) {
    setSelectedChar(char, width, true);
  }

  function selectPalette(paletteId: string) {
    activePaletteId.value = paletteId;
  }

  function selectStampSet(stampSetId: string) {
    const stampSet = stampSets.find((candidate) => candidate.id === stampSetId);

    if (!stampSet) {
      return;
    }

    activeStampSetId.value = stampSet.id;
    activeStampId.value = stampSet.stamps[0]?.id ?? "";
  }

  function selectStamp(stampId: string) {
    const stamp = activeStampSet.value?.stamps.find((candidate) => candidate.id === stampId);

    if (!stamp) {
      return;
    }

    activeStampId.value = stamp.id;
  }

  function selectLayer(layerId: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);

    if (!layer || !isSelectableLayer(layer)) {
      return;
    }

    documentModel.activeLayerId = layer.id;
  }

  function addLayer() {
    const layerNumber = documentModel.nextLayerNumber;
    const layer = createLayer(`layer-${layerNumber}`, `Layer ${layerNumber}`);

    documentModel.layers.push(layer);
    documentModel.activeLayerId = layer.id;
    documentModel.nextLayerNumber += 1;
  }

  function deleteActiveLayer() {
    if (documentModel.layers.length <= 1) {
      return;
    }

    const layerIndex = documentModel.layers.findIndex((layer) => layer.id === documentModel.activeLayerId);

    if (layerIndex < 0) {
      return;
    }

    documentModel.layers.splice(layerIndex, 1);
    ensureActiveLayerSelectable();
  }

  function toggleLayerVisible(layerId: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);

    if (!layer) {
      return;
    }

    layer.visible = !layer.visible;
    ensureActiveLayerSelectable();
  }

  function toggleLayerLocked(layerId: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);

    if (!layer) {
      return;
    }

    layer.locked = !layer.locked;
    ensureActiveLayerSelectable();
  }

  function renameLayer(layerId: string, name: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);
    const trimmedName = name.trim();

    if (!layer || trimmedName === "") {
      return;
    }

    layer.name = trimmedName;
  }

  function moveLayer(draggedLayerId: string, targetLayerId: string, placement: "before" | "after") {
    if (draggedLayerId === targetLayerId) {
      return;
    }

    const displayLayers = [...documentModel.layers].reverse();
    const draggedIndex = displayLayers.findIndex((layer) => layer.id === draggedLayerId);
    const targetIndex = displayLayers.findIndex((layer) => layer.id === targetLayerId);

    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const [draggedLayer] = displayLayers.splice(draggedIndex, 1);
    const newTargetIndex = displayLayers.findIndex((layer) => layer.id === targetLayerId);

    if (newTargetIndex < 0) {
      return;
    }

    displayLayers.splice(placement === "after" ? newTargetIndex + 1 : newTargetIndex, 0, draggedLayer);
    documentModel.layers.splice(0, documentModel.layers.length, ...displayLayers.reverse());
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

    if (toolState.activeTool === "stamp") {
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
    const activeLayer = getEditableActiveLayer();

    if (!activeLayer) {
      cursorPosition.value = { x, y };
      return;
    }

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

    if (toolState.activeTool === "stamp") {
      placeStamp(activeLayer, x, y);
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
    const activeLayer = getEditableActiveLayer();
    const cell = activeLayer ? getHeadCell(activeLayer, x, y) : null;

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
    const compositedCell = compositedGrid.value[y][x];
    return compositedCell.char === " " ? "\u00a0" : compositedCell.char;
  }

  function getCellClass(x: number, y: number) {
    const activeLayer = getEditableActiveLayer();
    const cell = activeLayer ? getCell(activeLayer, x, y) : null;
    return cell?.kind === "wide-tail" ? ["is-wide-tail"] : [];
  }

  function getCellStyle(x: number, y: number) {
    const compositedCell = compositedGrid.value[y][x];
    const style = { backgroundColor: `#${compositedCell.bgc}` } as Record<string, string>;

    if (compositedCell.fgc) {
      style.color = `#${compositedCell.fgc}`;
    }

    return style;
  }

  function getStampPreviewCells(stamp: Stamp, originX: number, originY: number): StampPreviewCell[] {
    const previewCells: StampPreviewCell[] = [];

    stamp.cells.forEach((row, rowIndex) => {
      const y = originY + rowIndex;

      if (y < 0 || y >= GRID_ROWS) {
        return;
      }

      row.forEach((cell, columnIndex) => {
        const x = originX + columnIndex;

        if (!cell || x < 0 || x >= GRID_COLUMNS) {
          return;
        }

        previewCells.push({
          x,
          y,
          text: cell.char === " " ? "\u00a0" : cell.char,
          style: {
            color: `#${resolveStampFGC(cell.fgc)}`,
            backgroundColor: cell.bgc ? `#${cell.bgc}` : "transparent",
          },
          className: cell.width === 2 ? ["is-wide-head"] : [],
        });
      });
    });

    return previewCells;
  }

  function placeStamp(layer: Layer, originX: number, originY: number) {
    const stamp = activeStamp.value;

    if (!stamp) {
      return;
    }

    const clippedWidth = clamp(stamp.width, 0, GRID_COLUMNS - originX);
    const clippedHeight = clamp(stamp.height, 0, GRID_ROWS - originY);

    if (clippedWidth <= 0 || clippedHeight <= 0) {
      return;
    }

    stamp.cells.forEach((row, rowIndex) => {
      const y = originY + rowIndex;

      if (y < 0 || y >= GRID_ROWS) {
        return;
      }

      row.forEach((cell, columnIndex) => {
        const x = originX + columnIndex;

        if (!cell || x < 0 || x >= GRID_COLUMNS) {
          return;
        }

        placeChar(layer, x, y, cell.char, resolveStampFGC(cell.fgc), cell.bgc, cell.width);
      });
    });

    toolState.selection = {
      kind: "rect",
      x: originX,
      y: originY,
      width: clippedWidth,
      height: clippedHeight,
    };
  }

  function resolveStampFGC(fgc: string | null) {
    return fgc ?? (isDarkColor(documentModel.canvasBGC) ? "ffffff" : "000000");
  }

  function getEditableActiveLayer(): Layer | null {
    const layer = documentModel.layers.find((candidate) => candidate.id === documentModel.activeLayerId);

    if (!layer || !isSelectableLayer(layer)) {
      return null;
    }

    return layer;
  }

  function ensureActiveLayerSelectable() {
    const activeLayer = documentModel.layers.find((layer) => layer.id === documentModel.activeLayerId);

    if (activeLayer && isSelectableLayer(activeLayer)) {
      return;
    }

    const selectableLayer = [...documentModel.layers].reverse().find(isSelectableLayer);

    if (selectableLayer) {
      documentModel.activeLayerId = selectableLayer.id;
      return;
    }

    documentModel.activeLayerId = documentModel.layers[documentModel.layers.length - 1]?.id ?? "";
  }

  function isSelectableLayer(layer: Layer) {
    return layer.visible && !layer.locked;
  }

  return {
    activePalette,
    activePaletteId,
    activeStamp,
    activeStampId,
    activeStampSet,
    activeStampSetId,
    documentModel,
    gridCells,
    gridLineStyle,
    info,
    layerList,
    palettes,
    selectedPaletteCode,
    selectionStyle,
    stampPreviewCells,
    stampSets,
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
    addLayer,
    deleteActiveLayer,
    moveLayer,
    renameLayer,
    saveDocument,
    selectPalette,
    selectPaletteChar,
    selectStamp,
    selectStampSet,
    selectLayer,
    selectTool,
    loadDocument,
    stopDrawing,
    toggleLayerLocked,
    toggleLayerVisible,
    updateUnicodeQuery,
    updateUnicodeScrollOffset,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function toSafeJsonFilename(name: string) {
  return (
    name
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\.+$/g, "")
      .replace(/^-+|-+$/g, "") || DEFAULT_DOCUMENT_NAME
  );
}

function normalizeLoadedDocument(value: unknown): AaDocument | null {
  if (!isRecord(value) || value.version !== 1 || value.width !== GRID_COLUMNS || value.height !== GRID_ROWS || !isColor(value.canvasBGC)) {
    return null;
  }

  if (!Array.isArray(value.layers) || value.layers.length === 0 || typeof value.activeLayerId !== "string" || !Number.isInteger(value.nextLayerNumber)) {
    return null;
  }

  const layers = value.layers.map(normalizeLoadedLayer);

  if (layers.some((layer) => layer === null)) {
    return null;
  }

  if (!layers.some((layer) => layer?.id === value.activeLayerId)) {
    return null;
  }

  return {
    version: 1,
    name: typeof value.name === "string" && value.name.trim() !== "" ? value.name.trim() : DEFAULT_DOCUMENT_NAME,
    width: GRID_COLUMNS,
    height: GRID_ROWS,
    canvasBGC: value.canvasBGC,
    layers: layers as Layer[],
    activeLayerId: value.activeLayerId,
    nextLayerNumber: value.nextLayerNumber,
  };
}

function normalizeLoadedLayer(value: unknown): Layer | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string" || typeof value.visible !== "boolean" || typeof value.locked !== "boolean") {
    return null;
  }

  if (!Array.isArray(value.cells) || value.cells.length !== GRID_ROWS) {
    return null;
  }

  const cells = value.cells.map((row) => (Array.isArray(row) && row.length === GRID_COLUMNS ? row.map(normalizeLoadedCell) : null));

  if (cells.some((row) => row === null || row.some((cell) => cell === null))) {
    return null;
  }

  return {
    id: value.id,
    name: value.name,
    visible: value.visible,
    locked: value.locked,
    cells: cells as Cell[][],
  };
}

function normalizeLoadedCell(value: unknown): Cell | null {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return null;
  }

  if (value.kind === "empty") {
    return { kind: "empty" };
  }

  if (value.kind === "wide-tail" && Number.isInteger(value.headX) && value.headX >= 0 && value.headX < GRID_COLUMNS) {
    return {
      kind: "wide-tail",
      headX: value.headX,
    };
  }

  if (value.kind !== "char" || typeof value.char !== "string" || (value.width !== 1 && value.width !== 2) || !isColor(value.fgc)) {
    return null;
  }

  if (value.bgc !== null && !isColor(value.bgc)) {
    return null;
  }

  return {
    kind: "char",
    char: value.char,
    width: value.width,
    fgc: value.fgc,
    bgc: value.bgc,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isColor(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{6}$/.test(value);
}

function getUnicodeCodeLabel(char: string) {
  const code = char.codePointAt(0) ?? 0;
  return `U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
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

function createStampSets(sourceStamps: Stamp[]): StampSet[] {
  const groupedStamps = new Map<string, Stamp[]>();

  for (const stamp of sourceStamps) {
    const stampSetId = stamp.id.replace(/-\d+$/, "");
    const stampSet = groupedStamps.get(stampSetId) ?? [];
    stampSet.push(stamp);
    groupedStamps.set(stampSetId, stampSet);
  }

  return Array.from(groupedStamps, ([id, items]) => ({
    id,
    name: stampSetNames[id] ?? id,
    stamps: items,
  }));
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
