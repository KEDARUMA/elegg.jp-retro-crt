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
import { DEFAULT_DOCUMENT_NAME, NBSP, createEmptyDocument, createInitialToolState, createLayer } from "../model/createDocument";
import { eraseCell, getCell, getCharWidth, getFirstGrapheme, getHeadCell, placeChar } from "../model/gridOperations";
import type { Cell, Color, ColorScheme, Document as AaDocument, Layer, Selection, Stamp, Tool } from "../model/types";

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

type ExportFormat = "plain" | "ansi" | "mds";
type ExportDestination = "download" | "clipboard";
type ColorPickerTarget = "selected" | "selection";
type PasteTextOptions = {
  transparentSpaces?: boolean;
};
type HistorySnapshot = {
  document: AaDocument;
  selection: Selection;
};
type RectSelection = {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
};

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const HISTORY_CELL_COUNT = 128;
const UNDO_HISTORY_LIMIT = 100;
const HISTORY_STORAGE_KEY = "aa-maker.char-palette.history.v1";
const stampSetNames: Record<string, string> = {
  gikoneko: "Giko Neko",
  monar: "Monar",
  "speech-bubble": "Speech Bubble",
};
const colorSchemes: ColorScheme[] = [
  {
    id: "basic",
    name: "Basic",
    colors: ["000000", "555555", "aaaaaa", "ffffff", "ff5555", "ffaa00", "ffff55", "55ff55", "55ffff", "5555ff", "aa55ff", "ff55ff"],
  },
];

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
  const selectedColorPickerMode = ref<"fgc" | "bgc" | null>(null);
  const colorPickerTarget = ref<ColorPickerTarget>("selected");
  const selectionContextMenu = ref<{ x: number; y: number } | null>(null);
  const undoStack = ref<HistorySnapshot[]>([]);
  const redoStack = ref<HistorySnapshot[]>([]);

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
  const colorPickerInitialColor = computed(() => {
    if (colorPickerTarget.value === "selection") {
      return selectedColorPickerMode.value === "fgc" ? getReadableCanvasColor() : documentModel.canvasBGC;
    }

    return selectedColorPickerMode.value === "fgc" ? toolState.selectedFGC : (toolState.selectedBGC ?? documentModel.canvasBGC);
  });
  const colorPickerAllowsNone = computed(() => colorPickerTarget.value === "selected" && selectedColorPickerMode.value === "bgc");
  const selectionContextMenuStyle = computed(() => {
    if (!selectionContextMenu.value) {
      return null;
    }

    return {
      left: `${selectionContextMenu.value.x}px`,
      top: `${selectionContextMenu.value.y}px`,
    };
  });
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
    document.addEventListener("keydown", handleDocumentKeyDown);
    document.addEventListener("pointerdown", closeSelectionContextMenu);
  });

  onUnmounted(() => {
    document.removeEventListener("pointerup", stopDrawing);
    document.removeEventListener("pointerleave", stopDrawing);
    document.removeEventListener("keydown", handleDocumentKeyDown);
    document.removeEventListener("pointerdown", closeSelectionContextMenu);
  });

  function selectTool(tool: Tool) {
    toolState.activeTool = tool;

    if (tool !== "select") {
      clearSelection();
    }
  }

  function openSelectedFGCColorPicker() {
    openColorPicker("fgc", "selected");
  }

  function openSelectedBGCColorPicker() {
    openColorPicker("bgc", "selected");
  }

  function closeSelectedColorPicker() {
    selectedColorPickerMode.value = null;
    colorPickerTarget.value = "selected";
  }

  function selectSelectedColor(mode: "fgc" | "bgc", color: Color | null) {
    if (colorPickerTarget.value === "selection") {
      applySelectionColor(mode, color);
      closeSelectedColorPicker();
      return;
    }

    if (mode === "fgc") {
      if (color !== null) {
        toolState.selectedFGC = color;
      }
    }

    if (mode === "bgc") {
      toolState.selectedBGC = color;
    }

    selectedColorPickerMode.value = null;
  }

  function openColorPicker(mode: "fgc" | "bgc", target: ColorPickerTarget) {
    const isSamePicker = selectedColorPickerMode.value === mode && colorPickerTarget.value === target;

    colorPickerTarget.value = target;
    selectedColorPickerMode.value = isSamePicker ? null : mode;
    closeSelectionContextMenu();
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
      undoStack.value = [];
      redoStack.value = [];
    } catch {
      window.alert("Load failed: invalid AA Maker JSON.");
    }
  }

  async function exportDocument(format: ExportFormat, destination: ExportDestination) {
    const content = createExportContent(format, compositedGrid.value);
    const filename = createExportFilename(documentModel.name, format);

    if (destination === "download") {
      downloadTextFile(filename, content, "text/plain");
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      window.alert("Export failed: could not write to clipboard.");
    }
  }

  function invertCanvasBackground() {
    recordDocumentHistory();
    documentModel.canvasBGC = documentModel.canvasBGC === "ffffff" ? "000000" : "ffffff";
  }

  function selectPaletteChar(char: string, width: 1 | 2, fillEmptyOnly = false) {
    setSelectedChar(char, width, true);

    if (fillEmptyOnly) {
      fillEmptySelectionWithChar(char, width);
      return;
    }

    fillSelectionWithChar(char, width);
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
    recordDocumentHistory();
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

    recordDocumentHistory();
    documentModel.layers.splice(layerIndex, 1);
    ensureActiveLayerSelectable();
  }

  function toggleLayerVisible(layerId: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);

    if (!layer) {
      return;
    }

    recordDocumentHistory();
    layer.visible = !layer.visible;
    ensureActiveLayerSelectable();
  }

  function toggleLayerLocked(layerId: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);

    if (!layer) {
      return;
    }

    recordDocumentHistory();
    layer.locked = !layer.locked;
    ensureActiveLayerSelectable();
  }

  function renameLayer(layerId: string, name: string) {
    const layer = documentModel.layers.find((candidate) => candidate.id === layerId);
    const trimmedName = name.trim();

    if (!layer || trimmedName === "") {
      return;
    }

    recordDocumentHistory();
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

    recordDocumentHistory();
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
      const width = getCharWidth(firstChar);

      setSelectedChar(firstChar, width, true);
      fillSelectionWithChar(firstChar, width);
    }
  }

  function handleDocumentKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || isTextEditingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();

    if (event.ctrlKey && key === "a") {
      event.preventDefault();
      selectAllGrid();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();

      if (event.shiftKey) {
        redoDocumentChange();
      } else {
        undoDocumentChange();
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();
      redoDocumentChange();
      return;
    }

    if (toolState.selection.kind !== "rect") {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      clearSelection();
      return;
    }

    if (event.key === "Delete") {
      event.preventDefault();
      deleteSelection();
      return;
    }

    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (key === "c") {
      event.preventDefault();
      void copySelectionToClipboard();
      return;
    }

    if (key === "v") {
      event.preventDefault();
      void pasteSelectionFromClipboard({ transparentSpaces: isTransparentPasteShortcut(event) });
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
      if (getEditableActiveLayer()) {
        recordDocumentHistory();
      }
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
    lastDrawnPosition.value = null;

    if ((toolState.activeTool === "pen" || toolState.activeTool === "eraser") && getEditableActiveLayer()) {
      recordDocumentHistory();
    }

    applyDragTool(x, y);
  }

  function handleCellContext(x: number, y: number, event: MouseEvent) {
    event.preventDefault();

    if (toolState.selection.kind === "rect") {
      cursorPosition.value = { x, y };
      openSelectionContextMenu(event.clientX, event.clientY);
      return;
    }

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
    closeSelectionContextMenu();

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

  function deleteSelection() {
    const selection = getRectSelection();
    const activeLayer = getEditableActiveLayer();

    if (!selection || !activeLayer) {
      return;
    }

    recordDocumentHistory();
    eraseSelectionCells(activeLayer, selection);
  }

  function clearSelection() {
    toolState.selection = { kind: "none" };
    closeSelectionContextMenu();
  }

  function selectAllGrid() {
    toolState.activeTool = "select";
    toolState.selection = {
      kind: "rect",
      x: 0,
      y: 0,
      width: GRID_COLUMNS,
      height: GRID_ROWS,
    };
    closeSelectionContextMenu();
  }

  function recordDocumentHistory() {
    undoStack.value.push(createHistorySnapshot());

    if (undoStack.value.length > UNDO_HISTORY_LIMIT) {
      undoStack.value.shift();
    }

    redoStack.value = [];
  }

  function undoDocumentChange() {
    const snapshot = undoStack.value.pop();

    if (!snapshot) {
      return;
    }

    redoStack.value.push(createHistorySnapshot());
    restoreHistorySnapshot(snapshot);
  }

  function redoDocumentChange() {
    const snapshot = redoStack.value.pop();

    if (!snapshot) {
      return;
    }

    undoStack.value.push(createHistorySnapshot());
    restoreHistorySnapshot(snapshot);
  }

  function createHistorySnapshot(): HistorySnapshot {
    return {
      document: cloneDocument(documentModel),
      selection: cloneSelection(toolState.selection),
    };
  }

  function restoreHistorySnapshot(snapshot: HistorySnapshot) {
    Object.assign(documentModel, cloneDocument(snapshot.document));
    toolState.selection = cloneSelection(snapshot.selection);
    closeSelectionContextMenu();
  }

  async function copySelectionToClipboard() {
    const selection = getRectSelection();

    if (!selection) {
      return;
    }

    if (!navigator.clipboard) {
      window.alert("Copy failed: clipboard API is unavailable.");
      return;
    }

    try {
      await navigator.clipboard.writeText(getSelectionText(selection));
    } catch {
      window.alert("Copy failed: could not write to clipboard.");
    }
  }

  async function pasteSelectionFromClipboard(options: PasteTextOptions = {}) {
    const selection = getRectSelection();
    const activeLayer = getEditableActiveLayer();

    if (!selection || !activeLayer) {
      return;
    }

    if (!navigator.clipboard) {
      window.alert("Paste failed: clipboard API is unavailable.");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      recordDocumentHistory();
      pasteTextAtSelection(activeLayer, selection, text, options);
    } catch {
      window.alert("Paste failed: could not read from clipboard.");
    }
  }

  function fillSelectionWithChar(char: string, width: 1 | 2) {
    const selection = getRectSelection();
    const activeLayer = getEditableActiveLayer();

    if (!selection || !activeLayer) {
      return;
    }

    recordDocumentHistory();
    eraseSelectionCells(activeLayer, selection);

    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      for (let x = selection.x; x < selection.x + selection.width; x += width) {
        if (x + width > selection.x + selection.width) {
          break;
        }

        placeChar(activeLayer, x, y, char, toolState.selectedFGC, toolState.selectedBGC, width);
      }
    }
  }

  function fillEmptySelectionWithChar(char: string, width: 1 | 2) {
    const selection = getRectSelection();
    const activeLayer = getEditableActiveLayer();

    if (!selection || !activeLayer) {
      return;
    }

    recordDocumentHistory();
    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      let x = selection.x;

      while (x < selection.x + selection.width) {
        if (canPlaceCharOnEmptyCells(activeLayer, selection, x, y, width)) {
          placeChar(activeLayer, x, y, char, toolState.selectedFGC, toolState.selectedBGC, width);
          x += width;
          continue;
        }

        x += 1;
      }
    }
  }

  function clearSelectionColors() {
    const selection = getRectSelection();
    const activeLayer = getEditableActiveLayer();

    closeSelectionContextMenu();

    if (!selection || !activeLayer) {
      return;
    }

    recordDocumentHistory();
    forEachCharCellInSelection(activeLayer, selection, (cell) => {
      cell.fgc = invertHexColor(documentModel.canvasBGC);
      cell.bgc = null;
    });
  }

  function openSelectionFGCColorPicker() {
    openColorPicker("fgc", "selection");
  }

  function openSelectionBGCColorPicker() {
    openColorPicker("bgc", "selection");
  }

  function applySelectionColor(mode: "fgc" | "bgc", color: Color | null) {
    const selection = getRectSelection();
    const activeLayer = getEditableActiveLayer();

    if (!selection || !activeLayer) {
      return;
    }

    recordDocumentHistory();
    forEachCharCellInSelection(activeLayer, selection, (cell) => {
      if (mode === "fgc") {
        if (color !== null) {
          cell.fgc = color;
        }
        return;
      }

      cell.bgc = color;
    });
  }

  function openSelectionContextMenu(x: number, y: number) {
    selectionContextMenu.value = getContextMenuPosition(x, y);
  }

  function closeSelectionContextMenu() {
    selectionContextMenu.value = null;
  }

  function eraseSelectionCells(layer: Layer, selection: RectSelection) {
    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      for (let x = selection.x; x < selection.x + selection.width; x += 1) {
        eraseCell(layer, x, y);
      }
    }
  }

  function getSelectionText(selection: RectSelection) {
    const lines: string[] = [];

    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      const chars: string[] = [];
      let x = selection.x;

      while (x < selection.x + selection.width) {
        const cell = compositedGrid.value[y][x];
        const char = cell.char === NBSP ? " " : cell.char;
        const width = char === " " ? 1 : getCharWidth(char);

        chars.push(char);
        x += width;
      }

      lines.push(chars.join(""));
    }

    return lines.join("\n");
  }

  function pasteTextAtSelection(layer: Layer, selection: RectSelection, text: string, options: PasteTextOptions = {}) {
    const lines = getClipboardLines(text);

    if (lines.length === 0) {
      return;
    }

    let pastedWidth = 0;
    let pastedHeight = 0;
    let hasPlacedCell = false;

    for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
      const y = selection.y + rowIndex;

      if (y >= GRID_ROWS) {
        break;
      }

      let x = selection.x;

      for (const grapheme of getGraphemes(lines[rowIndex].replace(/\t/g, "    "))) {
        const isBlank = isClipboardBlankGrapheme(grapheme);
        const char = grapheme === " " ? NBSP : grapheme;
        const width = isBlank ? getCharWidth(grapheme) : getCharWidth(char);

        if (x + width > GRID_COLUMNS) {
          break;
        }

        if (!options.transparentSpaces || !isBlank) {
          placeChar(layer, x, y, char, toolState.selectedFGC, toolState.selectedBGC, width);
          hasPlacedCell = true;
        }

        x += width;
      }

      pastedWidth = Math.max(pastedWidth, x - selection.x);
      pastedHeight = rowIndex + 1;
    }

    if (pastedWidth <= 0 || pastedHeight <= 0 || (options.transparentSpaces && !hasPlacedCell)) {
      return;
    }

    toolState.selection = {
      kind: "rect",
      x: selection.x,
      y: selection.y,
      width: pastedWidth,
      height: pastedHeight,
    };
  }

  function getRectSelection(): RectSelection | null {
    return toolState.selection.kind === "rect" ? toolState.selection : null;
  }

  function forEachCharCellInSelection(layer: Layer, selection: RectSelection, callback: (cell: Extract<Cell, { kind: "char" }>) => void) {
    for (let y = selection.y; y < selection.y + selection.height; y += 1) {
      for (let x = selection.x; x < selection.x + selection.width; x += 1) {
        const cell = getCell(layer, x, y);

        if (cell?.kind === "char") {
          callback(cell);
        }
      }
    }
  }

  function canPlaceCharOnEmptyCells(layer: Layer, selection: RectSelection, x: number, y: number, width: 1 | 2) {
    if (x + width > selection.x + selection.width) {
      return false;
    }

    for (let offset = 0; offset < width; offset += 1) {
      if (getCell(layer, x + offset, y)?.kind !== "empty") {
        return false;
      }
    }

    return true;
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

    if (cell?.kind === "char" && cell.width === 2) {
      return ["is-wide-head"];
    }

    if (cell?.kind === "wide-tail") {
      return ["is-wide-tail"];
    }

    return [];
  }

  function getCellStyle(x: number, y: number) {
    const compositedCell = compositedGrid.value[y][x];
    const style = { backgroundColor: `#${compositedCell.bgc}` } as Record<string, string>;
    const activeLayer = getEditableActiveLayer();
    const activeCell = activeLayer ? getCell(activeLayer, x, y) : null;

    if (activeLayer && activeCell?.kind === "wide-tail") {
      const head = getHeadCell(activeLayer, x, y);
      style.backgroundColor = `#${head?.bgc ?? documentModel.canvasBGC}`;
    }

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

  function getReadableCanvasColor() {
    return isDarkColor(documentModel.canvasBGC) ? "ffffff" : "000000";
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
    colorPickerAllowsNone,
    colorPickerInitialColor,
    colorSchemes,
    documentModel,
    gridCells,
    gridLineStyle,
    info,
    layerList,
    palettes,
    selectedPaletteCode,
    selectionStyle,
    selectionContextMenu,
    selectionContextMenuStyle,
    stampPreviewCells,
    stampSets,
    selectedColorPickerMode,
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
    invertCanvasBackground,
    assignHistoryChar,
    addLayer,
    clearSelectionColors,
    closeSelectionContextMenu,
    deleteActiveLayer,
    exportDocument,
    moveLayer,
    renameLayer,
    saveDocument,
    selectPalette,
    selectPaletteChar,
    closeSelectedColorPicker,
    openSelectionBGCColorPicker,
    openSelectionFGCColorPicker,
    selectStamp,
    selectStampSet,
    selectSelectedColor,
    selectLayer,
    selectTool,
    openSelectedBGCColorPicker,
    openSelectedFGCColorPicker,
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

function cloneDocument(documentValue: AaDocument): AaDocument {
  return JSON.parse(JSON.stringify(documentValue)) as AaDocument;
}

function cloneSelection(selection: Selection): Selection {
  return JSON.parse(JSON.stringify(selection)) as Selection;
}

function getContextMenuPosition(x: number, y: number) {
  const menuWidth = 172;
  const menuHeight = 102;

  return {
    x: clamp(x, 0, Math.max(0, window.innerWidth - menuWidth)),
    y: clamp(y, 0, Math.max(0, window.innerHeight - menuHeight)),
  };
}

function createExportContent(format: ExportFormat, grid: ReturnType<typeof composeDocument>) {
  if (format === "ansi") {
    return createAnsiExport(grid);
  }

  if (format === "mds") {
    return createMdsExport(grid);
  }

  return createPlainTextExport(grid);
}

function createPlainTextExport(grid: ReturnType<typeof composeDocument>) {
  return grid.map((row) => trimExportRow(row).map((cell) => cell.char).join("")).join("\n");
}

function createAnsiExport(grid: ReturnType<typeof composeDocument>) {
  return grid
    .map((row) => {
      let currentFGC: string | null = null;
      let currentBGC: string | null = null;

      const line = trimExportRow(row)
        .map((cell) => {
          let prefix = "";
          const nextFGC = cell.sourceLayerId === null ? currentFGC : cell.fgc;
          const nextBGC = cell.sourceLayerId === null ? currentBGC : cell.bgc;

          if (nextFGC !== currentFGC || nextBGC !== currentBGC) {
            prefix = nextFGC === null && nextBGC === null ? "\x1b[0m" : `\x1b[38;2;${hexToRgbTriplet(nextFGC ?? "ffffff")};48;2;${hexToRgbTriplet(nextBGC ?? "000000")}m`;
            currentFGC = nextFGC;
            currentBGC = nextBGC;
          }

          return `${prefix}${cell.char}`;
        })
        .join("");

      return line === "" ? line : `${line}\x1b[0m`;
    })
    .join("\n");
}

function createMdsExport(grid: ReturnType<typeof composeDocument>) {
  const lines = grid.map((row) => {
    let currentFGC: string | null = null;
    let currentBGC: string | null = null;
    let hasActiveFGC = false;
    let hasActiveBGC = false;

    const line = trimExportRow(row)
      .map((cell) => {
        let prefix = "";
        const nextFGC = cell.sourceLayerId === null ? currentFGC : cell.fgc;
        const nextBGC = cell.sourceLayerId === null ? currentBGC : cell.bgc;

        if (nextFGC !== currentFGC) {
          if (hasActiveFGC) {
            prefix += "<color>";
            hasActiveFGC = false;
          }

          if (nextFGC) {
            prefix += `<color="#${nextFGC}">`;
            hasActiveFGC = true;
          }

          currentFGC = nextFGC;
        }

        if (nextBGC !== currentBGC) {
          if (hasActiveBGC) {
            prefix += "<bgcolor>";
            hasActiveBGC = false;
          }

          if (nextBGC) {
            prefix += `<bgcolor="#${nextBGC}">`;
            hasActiveBGC = true;
          }

          currentBGC = nextBGC;
        }

        return `${prefix}${escapeMdsText(cell.char)}`;
      })
      .join("");

    return `${line}${hasActiveBGC ? "<bgcolor>" : ""}${hasActiveFGC ? "<color>" : ""}`;
  });

  return `<clear>\n${lines.join("\n")}`;
}

function trimExportRow<T extends { char: string }>(row: T[]) {
  let end = row.length;

  while (end > 0 && row[end - 1].char === " ") {
    end -= 1;
  }

  return row.slice(0, end);
}

function createExportFilename(name: string, format: ExportFormat) {
  const baseName = toSafeJsonFilename(name);

  if (format === "ansi") {
    return `${baseName}.ansi.txt`;
  }

  if (format === "mds") {
    return `${baseName}.mds`;
  }

  return `${baseName}.txt`;
}

function hexToRgbTriplet(hexColor: string) {
  return [hexColor.slice(0, 2), hexColor.slice(2, 4), hexColor.slice(4, 6)].map((value) => Number.parseInt(value, 16)).join(";");
}

function escapeMdsText(value: string) {
  return value;
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

function isTextEditingTarget(target: EventTarget | null) {
  if (document.querySelector('[role="dialog"]')) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

function isTransparentPasteShortcut(event: KeyboardEvent) {
  if (!event.ctrlKey) {
    return false;
  }

  return isMacPlatform() ? event.metaKey : event.altKey;
}

function isMacPlatform() {
  return /mac/i.test(navigator.platform);
}

function getClipboardLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutTrailingLineBreak = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;

  return withoutTrailingLineBreak === "" ? [] : withoutTrailingLineBreak.split("\n");
}

function getGraphemes(value: string) {
  const segmenter = new Intl.Segmenter();
  return Array.from(segmenter.segment(value), (segment) => segment.segment);
}

function isClipboardBlankGrapheme(value: string) {
  return value.trim() === "";
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

function invertHexColor(hexColor: string) {
  const normalized = hexColor.replace(/^#/, "");

  return [normalized.slice(0, 2), normalized.slice(2, 4), normalized.slice(4, 6)]
    .map((value) => (255 - Number.parseInt(value, 16)).toString(16).padStart(2, "0"))
    .join("");
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
