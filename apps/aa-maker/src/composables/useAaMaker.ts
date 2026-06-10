import { computed, onMounted, onUnmounted, reactive, ref } from "vue";
import eraserIcon from "../assets/icons/eraser.svg?raw";
import eyedropperIcon from "../assets/icons/eyedropper.svg?raw";
import penIcon from "../assets/icons/pen.svg?raw";
import selectIcon from "../assets/icons/select.svg?raw";
import stampIcon from "../assets/icons/stamp.svg?raw";
import textIcon from "../assets/icons/text.svg?raw";
import charPalettes from "../data/char-palettes.json";
import stamps from "../data/stamps.json";
import unicodeGlyphPages from "../data/unicode-glyph-pages.json";
import { composeDocument } from "../model/composeLayers";
import { DEFAULT_DOCUMENT_NAME, NBSP, createEmptyCell, createEmptyDocument, createInitialToolState, createLayer } from "../model/createDocument";
import { eraseCell, getCell, getCharWidth, getFirstGrapheme, getHeadCell, placeChar } from "../model/gridOperations";
import type { Cell, CellGrid, Color, ColorScheme, Document as AaDocument, Highlight, Layer, Stamp, Tool } from "../model/types";
import { startSimilarGlyphSearch } from "../search/similarGlyphSearch";
import type { SimilarGlyphSearchHandle, SimilarGlyphSearchResult, UnicodeGlyphPageData } from "../search/similarGlyphSearch";

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

type SimilarPalette = {
  kind: "similar";
  id: string;
  name: string;
  query: string;
  fontFamily: string;
  canvasSize: 16 | 32;
  threshold: number;
  widthMatch: boolean;
  maxResults: number;
  results: SimilarGlyphSearchResult[];
  isSearching: boolean;
  status: string;
  checkedPageCount: number;
  totalPageCount: number;
  checkedCodePointCount: number;
};

type Palette = NormalPalette | HistoryPalette | KeyboardInputPalette | UnicodePalette | SimilarPalette;

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

type ExportFormat = "plain" | "ansi" | "mds" | "html";
type ExportDestination = "download" | "clipboard";
type ExportGrid = ReturnType<typeof composeDocument>;
type HtmlRun = {
  x: number;
  width: number;
  fgc: string | null;
  bgc: string | null;
  text: string;
};
type ColorPickerTarget = "selected" | "selection";
type HistorySnapshot = {
  document: AaDocument;
  highlight: Highlight;
};
type TextDraft = {
  x: number;
  y: number;
  value: string;
};
type RectSelection = {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
};

type HighlightRect = Extract<Highlight, { kind: "rect" }>;
type ToolItem = {
  id: Tool;
  label: string;
  icon: string;
  implemented: boolean;
  shortcut?: string;
};
type ToolCursorOverlay = {
  icon: string;
  style: Record<string, string>;
};

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const HISTORY_CELL_COUNT = 128;
const UNDO_HISTORY_LIMIT = 100;
const HISTORY_STORAGE_KEY = "aa-maker.char-palette.history.v1";
const TOOL_CURSOR_OVERLAY_OFFSET_X = 11;
const TOOL_CURSOR_OVERLAY_OFFSET_Y = 25;
const TOOL_CURSOR_OVERLAY_SIZE = 24;
const TOOL_CURSOR_OVERLAY_PADDING = 3;
const TOOL_CURSOR_OVERLAY_RADIUS = 8;
const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: "select",
  i: "eyedropper",
  p: "pen",
  e: "eraser",
  t: "text",
  s: "stamp",
};
const UNICODE_GLYPH_SCAN_PAGE_SIZE = 256;
const UNICODE_GLYPH_SCAN_MIN_CODE_POINT = 0x20;
const UNICODE_GLYPH_SCAN_MAX_CODE_POINT = 0x10ffff;
const UNICODE_GLYPH_SCAN_ALL_FIRST_PAGE = 0;
const UNICODE_GLYPH_SCAN_ALL_PAGE_COUNT = Math.ceil((UNICODE_GLYPH_SCAN_MAX_CODE_POINT + 1) / UNICODE_GLYPH_SCAN_PAGE_SIZE);
const SIMILAR_GLYPH_DEFAULT_FONT_FAMILY = "\"MS Gothic\", monospace";
const SIMILAR_GLYPH_DEFAULT_THRESHOLD = 28;
const SIMILAR_GLYPH_DEFAULT_MAX_RESULTS = 256;
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
    {
      kind: "similar",
      id: "similar",
      name: "Similar",
      query: "",
      fontFamily: SIMILAR_GLYPH_DEFAULT_FONT_FAMILY,
      canvasSize: 16,
      threshold: SIMILAR_GLYPH_DEFAULT_THRESHOLD,
      widthMatch: false,
      maxResults: SIMILAR_GLYPH_DEFAULT_MAX_RESULTS,
      results: [],
      isSearching: false,
      status: "Idle",
      checkedPageCount: 0,
      totalPageCount: 0,
      checkedCodePointCount: 0,
    },
  ]);
  const activePaletteId = ref(palettes[0]?.id ?? "");
  const stampSets = createStampSets(stamps as Stamp[]);
  const activeStampSetId = ref(stampSets[0]?.id ?? "");
  const activeStampId = ref("");
  const documentModel = reactive(createEmptyDocument());
  const toolState = reactive(createInitialToolState());
  const gridZoom = ref(toolState.zoom);
  const isDrawing = ref(false);
  const selectionAnchor = ref<{ x: number; y: number } | null>(null);
  const draftSelection = ref<RectSelection | null>(null);
  const lastDrawnCellKey = ref<string | null>(null);
  const lastDrawnPosition = ref<{ x: number; y: number } | null>(null);
  const cursorPosition = ref<{ x: number; y: number } | null>(null);
  const selectedColorPickerMode = ref<"fgc" | "bgc" | null>(null);
  const colorPickerTarget = ref<ColorPickerTarget>("selected");
  const selectionContextMenu = ref<{ x: number; y: number } | null>(null);
  const undoStack = ref<HistorySnapshot[]>([]);
  const redoStack = ref<HistorySnapshot[]>([]);
  const textDraft = ref<TextDraft | null>(null);
  const isUnicodeGlyphPageScanRunning = ref(false);
  const hasUnsavedDocumentChange = ref(false);
  const toolCursorPosition = ref<{ x: number; y: number } | null>(null);
  let similarGlyphSearchHandle: SimilarGlyphSearchHandle | null = null;

  const tools = computed<ToolItem[]>(() => [
    {
      id: "select",
      label: "範囲選択",
      icon: selectIcon,
      implemented: true,
      shortcut: "V",
    },
    {
      id: "eyedropper",
      label: "スポイト",
      icon: eyedropperIcon,
      implemented: true,
      shortcut: "I",
    },
    {
      id: "pen",
      label: "ペン",
      icon: penIcon,
      implemented: true,
      shortcut: "P",
    },
    {
      id: "eraser",
      label: "消しゴム",
      icon: eraserIcon,
      implemented: true,
      shortcut: "E",
    },
    {
      id: "text",
      label: "テキスト",
      icon: textIcon,
      implemented: true,
      shortcut: "T",
    },
    {
      id: "stamp",
      label: "スタンプ",
      icon: stampIcon,
      implemented: true,
      shortcut: "S",
    },
  ]);
  const activeToolCursorIcon = computed(() => tools.value.find((tool) => tool.id === toolState.activeTool)?.icon ?? "");
  const toolCursorOverlay = computed<ToolCursorOverlay | null>(() => {
    const position = toolCursorPosition.value;
    const icon = activeToolCursorIcon.value;

    if (!position || !icon) {
      return null;
    }

    return {
      icon,
      style: {
        left: `${position.x + TOOL_CURSOR_OVERLAY_OFFSET_X}px`,
        top: `${position.y + TOOL_CURSOR_OVERLAY_OFFSET_Y}px`,
        width: `${TOOL_CURSOR_OVERLAY_SIZE}px`,
        height: `${TOOL_CURSOR_OVERLAY_SIZE}px`,
        padding: `${TOOL_CURSOR_OVERLAY_PADDING}px`,
        borderRadius: `${TOOL_CURSOR_OVERLAY_RADIUS}px`,
      },
    };
  });

  const gridCells = Array.from({ length: GRID_COLUMNS * GRID_ROWS }, (_, index) => ({
    x: index % GRID_COLUMNS,
    y: Math.floor(index / GRID_COLUMNS),
  }));

  const activePalette = computed(() => palettes.find((palette) => palette.id === activePaletteId.value) ?? palettes[0]);
  const activeStampSet = computed(() => stampSets.find((stampSet) => stampSet.id === activeStampSetId.value) ?? stampSets[0] ?? null);
  const activeStamp = computed(() => {
    if (!activeStampId.value) {
      return null;
    }

    return activeStampSet.value?.stamps.find((stamp) => stamp.id === activeStampId.value) ?? null;
  });
  const zoomLabel = computed(() => `Zoom: ${Math.round(gridZoom.value * 100)}%`);
  const foregroundDefaultColor = computed(() => getForegroundDefaultColor());
  const colorPickerInitialColor = computed(() => {
    if (colorPickerTarget.value === "selection") {
      return selectedColorPickerMode.value === "fgc" ? foregroundDefaultColor.value : documentModel.canvasBGC;
    }

    return selectedColorPickerMode.value === "fgc" ? toolState.selectedFGC : (toolState.selectedBGC ?? documentModel.canvasBGC);
  });
  const colorPickerAllowsNone = computed(() => selectedColorPickerMode.value === "bgc");
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
    const rect = draftSelection.value ?? getRectHighlight();

    if (!rect) {
      return null;
    }

    return {
      left: `calc(var(--cell-width) * ${rect.x})`,
      top: `calc(var(--cell-height) * ${rect.y})`,
      width: `calc(var(--cell-width) * ${rect.width})`,
      height: `calc(var(--cell-height) * ${rect.height})`,
      pointerEvents: draftSelection.value ? "none" : "auto",
      cursor: draftSelection.value ? "default" : "move",
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
    return [];
  });
  const highlightCells = computed(() => {
    const highlight = getRectHighlight();

    if (!highlight) {
      return [];
    }

    return getHighlightPreviewCells(highlight);
  });
  const textEditorStyle = computed(() => {
    if (!textDraft.value) {
      return null;
    }

    const widthCells = getTextEditorWidthCells(textDraft.value.value, textDraft.value.x);
    const heightCells = getTextEditorHeightCells(textDraft.value.value, textDraft.value.y);
    const panelWidthCells = widthCells;
    const panelHeightCells = heightCells + 2;

    return {
      left: `calc(var(--cell-width) * ${clamp(textDraft.value.x, 0, GRID_COLUMNS - panelWidthCells)})`,
      top: `calc(var(--cell-height) * ${clamp(textDraft.value.y, 0, GRID_ROWS - panelHeightCells)})`,
      width: `calc(var(--cell-width) * ${panelWidthCells})`,
      height: `calc(var(--cell-height) * ${panelHeightCells})`,
      "--editor-width-cells": String(widthCells),
      "--editor-height-cells": String(heightCells),
    };
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
      w: (draftSelection.value ?? getRectHighlight())?.width.toString() ?? "--",
      h: (draftSelection.value ?? getRectHighlight())?.height.toString() ?? "--",
      char: cell?.char ?? null,
      code: cell ? getUnicodeCodeLabel(cell.char) : "U+----",
      fgc: cell?.fgc ?? "------",
      bgc: cell?.bgc ?? documentModel.canvasBGC,
    };
  });

  onMounted(() => {
    document.addEventListener("pointerup", stopDrawing);
    document.addEventListener("pointerleave", stopDrawing);
    document.addEventListener("pointermove", handleDocumentPointerMove, { capture: true, passive: true });
    document.addEventListener("mouseout", handleDocumentMouseOut, { capture: true });
    document.addEventListener("keydown", handleDocumentKeyDown, { capture: true });
    document.addEventListener("pointerdown", closeSelectionContextMenu);
    window.addEventListener("blur", hideToolCursor);
    window.addEventListener("beforeunload", handleBeforeUnload);
  });

  onUnmounted(() => {
    document.removeEventListener("pointerup", stopDrawing);
    document.removeEventListener("pointerleave", stopDrawing);
    document.removeEventListener("pointermove", handleDocumentPointerMove, { capture: true });
    document.removeEventListener("mouseout", handleDocumentMouseOut, { capture: true });
    document.removeEventListener("keydown", handleDocumentKeyDown, { capture: true });
    document.removeEventListener("pointerdown", closeSelectionContextMenu);
    window.removeEventListener("blur", hideToolCursor);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    cancelSimilarSearch();
  });

  function selectTool(tool: Tool) {
    if (tool !== "text") {
      closeTextEditor();
    }

    toolState.activeTool = tool;
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
    hasUnsavedDocumentChange.value = false;
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
      toolState.highlight = { kind: "none" };
      draftSelection.value = null;
      cursorPosition.value = null;
      closeTextEditor();
      undoStack.value = [];
      redoStack.value = [];
      hasUnsavedDocumentChange.value = false;
    } catch {
      window.alert("Load failed: invalid AA Maker JSON.");
    }
  }

  async function exportDocument(format: ExportFormat, destination: ExportDestination) {
    const content = createExportContent(format, compositedGrid.value, documentModel.name, documentModel.canvasBGC);
    const filename = createExportFilename(documentModel.name, format);

    if (destination === "download") {
      downloadTextFile(filename, content, createExportMimeType(format));
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
    } catch {
      window.alert("Export failed: could not write to clipboard.");
    }
  }

  async function scanAllUnicodeGlyphPages() {
    if (!import.meta.env.DEV || isUnicodeGlyphPageScanRunning.value) {
      return;
    }

    isUnicodeGlyphPageScanRunning.value = true;

    try {
      const { scanUnicodeGlyphPages } = await import("../dev/unicodeGlyphPageScan");
      const result = await scanUnicodeGlyphPages({
        firstPage: UNICODE_GLYPH_SCAN_ALL_FIRST_PAGE,
        pageCount: UNICODE_GLYPH_SCAN_ALL_PAGE_COUNT,
        pageSize: UNICODE_GLYPH_SCAN_PAGE_SIZE,
        minCodePoint: UNICODE_GLYPH_SCAN_MIN_CODE_POINT,
        maxCodePoint: UNICODE_GLYPH_SCAN_MAX_CODE_POINT,
        canvasSize: 16,
        font: getUnicodeGlyphScanFont(),
        workerCount: getUnicodeGlyphScanWorkerCount(),
        notdefFilter: true,
      });

      downloadTextFile(createUnicodeGlyphScanFilename(result.firstPage, result.pageCount), JSON.stringify(result, null, 2), "application/json");
    } catch (error) {
      window.alert(`Unicode glyph page scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      isUnicodeGlyphPageScanRunning.value = false;
    }
  }

  function invertCanvasBackground() {
    const previousForegroundDefaultColor = getForegroundDefaultColor();

    recordDocumentHistory();
    documentModel.canvasBGC = invertHexColor(documentModel.canvasBGC);
    updateForegroundDefaultColor(previousForegroundDefaultColor, getForegroundDefaultColor());
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
    activeStampId.value = "";
  }

  function selectStamp(stampId: string) {
    const stamp = activeStampSet.value?.stamps.find((candidate) => candidate.id === stampId);

    if (!stamp) {
      return;
    }

    activeStampId.value = stamp.id;
    placeStampAtCenter(stamp);
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

  function handleDocumentPointerMove(event: PointerEvent) {
    if (event.pointerType !== "mouse") {
      hideToolCursor();
      return;
    }

    toolCursorPosition.value = {
      x: event.clientX,
      y: event.clientY,
    };
  }

  function handleDocumentMouseOut(event: MouseEvent) {
    if (!event.relatedTarget) {
      hideToolCursor();
    }
  }

  function hideToolCursor() {
    toolCursorPosition.value = null;
  }

  function handleDocumentKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || isTextEditingTarget(event.target)) {
      return;
    }

    const key = event.key.toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === "a") {
      event.preventDefault();
      event.stopPropagation();
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

    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === "c") {
        event.preventDefault();
        event.stopPropagation();

        if (event.shiftKey) {
          openSelectedBGCColorPicker();
        } else {
          openSelectedFGCColorPicker();
        }
        return;
      }

      const shortcutTool = !event.shiftKey ? TOOL_SHORTCUTS[key] : undefined;

      if (shortcutTool) {
        event.preventDefault();
        event.stopPropagation();
        selectTool(shortcutTool);
        return;
      }
    }

    if (event.key === "Enter" && toolState.highlight.kind === "rect") {
      event.preventDefault();
      commitHighlight({ transparent: isTransparentCommitEvent(event) });
      return;
    }

    if (event.key === "Escape" && toolState.highlight.kind === "rect") {
      event.preventDefault();
      cancelHighlight();
      return;
    }

    if (event.key === "Delete" && toolState.highlight.kind === "rect") {
      event.preventDefault();
      deleteSelection();
      return;
    }

    if (event.key.startsWith("Arrow") && toolState.highlight.kind === "rect") {
      event.preventDefault();
      moveHighlightByKey(event.key, event.shiftKey ? 10 : 1);
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "c" && toolState.highlight.kind === "rect") {
      event.preventDefault();
      void copySelectionToClipboard();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "v") {
      event.preventDefault();
      void pasteSelectionFromClipboard();
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

  function updateSimilarQuery(query: string) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.query = query;
    }
  }

  function updateSimilarFontFamily(fontFamily: string) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.fontFamily = fontFamily;
    }
  }

  function updateSimilarCanvasSize(canvasSize: number) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.canvasSize = canvasSize === 32 ? 32 : 16;
    }
  }

  function updateSimilarThreshold(threshold: number) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.threshold = clamp(threshold, 0, 100);
    }
  }

  function updateSimilarWidthMatch(widthMatch: boolean) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.widthMatch = widthMatch;
    }
  }

  function updateSimilarMaxResults(maxResults: number) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.maxResults = Math.max(1, Math.min(2048, Math.floor(maxResults)));
    }
  }

  function startSimilarSearch() {
    const palette = getSimilarPalette();

    if (!palette || palette.isSearching) {
      return;
    }

    const targetChar = getFirstGrapheme(palette.query) || toolState.selectedChar;

    palette.results = [];
    palette.checkedPageCount = 0;
    palette.totalPageCount = 0;
    palette.checkedCodePointCount = 0;

    if (!targetChar) {
      palette.status = "Input required";
      return;
    }

    palette.query = targetChar;
    palette.isSearching = true;
    palette.status = "Searching";

    similarGlyphSearchHandle = startSimilarGlyphSearch(
      {
        pageData: unicodeGlyphPages as UnicodeGlyphPageData,
        targetChar,
        targetWidth: getCharWidth(targetChar),
        fontFamily: palette.fontFamily.trim() || SIMILAR_GLYPH_DEFAULT_FONT_FAMILY,
        canvasSize: palette.canvasSize,
        threshold: palette.threshold,
        widthMatch: palette.widthMatch,
        maxResults: palette.maxResults,
        workerCount: getUnicodeGlyphScanWorkerCount(),
      },
      {
        onResults(results) {
          palette.results.push(...results);
        },
        onProgress(progress) {
          palette.checkedPageCount = progress.checkedPageCount;
          palette.totalPageCount = progress.totalPageCount;
          palette.checkedCodePointCount = progress.checkedCodePointCount;
          palette.status = "Searching";
        },
        onDone(progress, cancelled) {
          similarGlyphSearchHandle = null;
          palette.isSearching = false;
          palette.checkedPageCount = progress.checkedPageCount;
          palette.totalPageCount = progress.totalPageCount;
          palette.checkedCodePointCount = progress.checkedCodePointCount;
          palette.status = cancelled && palette.results.length < palette.maxResults ? "Stopped" : "Done";
        },
        onError(message) {
          similarGlyphSearchHandle = null;
          palette.isSearching = false;
          palette.status = message;
        },
      },
    );
  }

  function cancelSimilarSearch() {
    const palette = getSimilarPalette();

    similarGlyphSearchHandle?.cancel();
    similarGlyphSearchHandle = null;

    if (palette?.isSearching) {
      palette.isSearching = false;
      palette.status = "Stopped";
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
    blurTextEditingTarget();

    if (toolState.highlight.kind === "rect") {
      if (!isPointInHighlight(x, y)) {
        commitHighlight({ transparent: isTransparentCommitEvent(event) });
      }
      return;
    }

    if (toolState.activeTool === "eyedropper") {
      applyTool(x, y);
      return;
    }

    if (toolState.activeTool === "text") {
      cursorPosition.value = { x, y };
      openTextEditor(x, y);
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

    if (toolState.highlight.kind === "rect") {
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
    const shouldFinalizeSelection = isDrawing.value && toolState.activeTool === "select" && draftSelection.value !== null;
    isDrawing.value = false;
    selectionAnchor.value = null;
    lastDrawnCellKey.value = null;
    lastDrawnPosition.value = null;

    if (shouldFinalizeSelection) {
      finalizeDraftSelection();
    }
  }

  function updateSelection(x: number, y: number) {
    closeSelectionContextMenu();

    const anchor = selectionAnchor.value ?? { x, y };
    const left = Math.min(anchor.x, x);
    const top = Math.min(anchor.y, y);
    const right = Math.max(anchor.x, x);
    const bottom = Math.max(anchor.y, y);

    draftSelection.value = {
      kind: "rect",
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    };

    cursorPosition.value = { x, y };
  }

  function finalizeDraftSelection() {
    const draft = draftSelection.value;
    const activeLayer = getEditableActiveLayer();

    draftSelection.value = null;

    if (!draft || !activeLayer) {
      return;
    }

    if (toolState.highlight.kind === "rect") {
      cancelHighlight();
    }

    const selection = expandSelectionForWideCells(activeLayer, draft);
    const contents = copyLayerCells(activeLayer, selection);

    recordDocumentHistory();
    clearLayerRect(activeLayer, selection.x, selection.y, selection.width, selection.height);
    toolState.highlight = {
      ...selection,
      contents,
      origin: {
        layerId: activeLayer.id,
        x: selection.x,
        y: selection.y,
        width: selection.width,
        height: selection.height,
        cells: cloneCellGrid(contents),
      },
    };
  }

  function commitHighlight(options: { transparent?: boolean } = {}) {
    const highlight = getRectHighlight();
    const activeLayer = getEditableActiveLayer();

    if (!highlight || !activeLayer) {
      return;
    }

    recordDocumentHistory();
    writeHighlightToLayer(activeLayer, highlight, Boolean(options.transparent));
    clearHighlightOnly();
  }

  function isTransparentCommitEvent(event: Pick<KeyboardEvent | PointerEvent, "ctrlKey" | "metaKey">) {
    return event.ctrlKey || event.metaKey;
  }

  function cancelHighlight() {
    const highlight = getRectHighlight();

    if (highlight?.origin) {
      const originLayer = documentModel.layers.find((layer) => layer.id === highlight.origin?.layerId);

      if (originLayer) {
        writeCellGridToLayer(originLayer, highlight.origin.x, highlight.origin.y, highlight.origin.cells);
      }
    }

    clearHighlightOnly();
  }

  function moveHighlightByKey(key: string, amount: number) {
    switch (key) {
      case "ArrowLeft":
        moveHighlight(-amount, 0);
        break;
      case "ArrowRight":
        moveHighlight(amount, 0);
        break;
      case "ArrowUp":
        moveHighlight(0, -amount);
        break;
      case "ArrowDown":
        moveHighlight(0, amount);
        break;
    }
  }

  function moveHighlight(deltaX: number, deltaY: number) {
    const highlight = getRectHighlight();

    if (!highlight || (deltaX === 0 && deltaY === 0)) {
      return;
    }

    toolState.highlight = {
      ...highlight,
      x: highlight.x + deltaX,
      y: highlight.y + deltaY,
    };
  }

  function handleHighlightMove(deltaX: number, deltaY: number) {
    moveHighlight(deltaX, deltaY);
  }

  function isPointInHighlight(x: number, y: number) {
    const highlight = getRectHighlight();

    return Boolean(highlight && x >= highlight.x && x < highlight.x + highlight.width && y >= highlight.y && y < highlight.y + highlight.height);
  }

  function handleGridMeasureDown(event: PointerEvent) {
    if (event.button !== 0 || toolState.highlight.kind !== "rect") {
      return;
    }

    event.preventDefault();
    commitHighlight({ transparent: isTransparentCommitEvent(event) });
  }

  function handleHighlightContext(event: MouseEvent) {
    if (toolState.highlight.kind !== "rect") {
      return;
    }

    event.preventDefault();
    openSelectionContextMenu(event.clientX, event.clientY);
  }

  function deleteSelection() {
    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    recordDocumentHistory();
    replaceHighlightContents(createEmptyCellGrid(highlight.width, highlight.height));
  }

  function clearHighlightOnly() {
    toolState.highlight = { kind: "none" };
    draftSelection.value = null;
    closeSelectionContextMenu();
  }

  function selectAllGrid() {
    toolState.activeTool = "select";
    draftSelection.value = {
      kind: "rect",
      x: 0,
      y: 0,
      width: GRID_COLUMNS,
      height: GRID_ROWS,
    };
    finalizeDraftSelection();
    closeSelectionContextMenu();
  }

  function recordDocumentHistory() {
    undoStack.value.push(createHistorySnapshot());
    hasUnsavedDocumentChange.value = true;

    if (undoStack.value.length > UNDO_HISTORY_LIMIT) {
      undoStack.value.shift();
    }

    redoStack.value = [];
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!hasUnsavedDocumentChange.value) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
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
      highlight: cloneHighlight(toolState.highlight),
    };
  }

  function restoreHistorySnapshot(snapshot: HistorySnapshot) {
    Object.assign(documentModel, cloneDocument(snapshot.document));
    toolState.highlight = cloneHighlight(snapshot.highlight);
    draftSelection.value = null;
    closeSelectionContextMenu();
    closeTextEditor();
  }

  async function copySelectionToClipboard() {
    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    if (!navigator.clipboard) {
      window.alert("Copy failed: clipboard API is unavailable.");
      return;
    }

    try {
      await navigator.clipboard.writeText(getSelectionText(highlight));
    } catch {
      window.alert("Copy failed: could not write to clipboard.");
    }
  }

  async function pasteSelectionFromClipboard() {
    const selection = getPasteOriginSelection();

    if (!getEditableActiveLayer()) {
      return;
    }

    if (!navigator.clipboard) {
      window.alert("Paste failed: clipboard API is unavailable.");
      return;
    }

    try {
      const text = await navigator.clipboard.readText();
      if (toolState.highlight.kind === "rect") {
        cancelHighlight();
      }
      createPasteHighlight(selection, text);
      toolState.activeTool = "select";
    } catch {
      window.alert("Paste failed: could not read from clipboard.");
    }
  }

  function fillSelectionWithChar(char: string, width: 1 | 2) {
    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    recordDocumentHistory();
    const layer = createHighlightLayer(highlight.width, highlight.height);

    for (let y = 0; y < highlight.height; y += 1) {
      for (let x = 0; x < highlight.width; x += width) {
        if (x + width > highlight.width) {
          break;
        }

        placeChar(layer, x, y, char, toolState.selectedFGC, toolState.selectedBGC, width);
      }
    }

    replaceHighlightContents(layer.cells);
  }

  function fillEmptySelectionWithChar(char: string, width: 1 | 2) {
    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    recordDocumentHistory();
    const layer = createHighlightLayer(highlight.width, highlight.height, highlight.contents);

    for (let y = 0; y < highlight.height; y += 1) {
      let x = 0;

      while (x < highlight.width) {
        if (canPlaceCharOnEmptyCells(layer, x, y, width)) {
          placeChar(layer, x, y, char, toolState.selectedFGC, toolState.selectedBGC, width);
          x += width;
          continue;
        }

        x += 1;
      }
    }

    replaceHighlightContents(layer.cells);
  }

  function clearSelectionColors() {
    const highlight = getRectHighlight();

    closeSelectionContextMenu();

    if (!highlight) {
      return;
    }

    recordDocumentHistory();
    forEachCharCellInHighlight(highlight, (cell) => {
      cell.fgc = getForegroundDefaultColor();
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
    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    recordDocumentHistory();
    forEachCharCellInHighlight(highlight, (cell) => {
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

  function getSelectionText(highlight: HighlightRect) {
    const lines: string[] = [];

    for (let y = 0; y < highlight.height; y += 1) {
      const chars: string[] = [];
      let x = 0;

      while (x < highlight.width) {
        const cell = highlight.contents[y]?.[x] ?? createEmptyCell();

        if (cell.kind === "wide-tail") {
          x += 1;
          continue;
        }

        const char = cell.kind === "char" ? (cell.char === NBSP ? " " : cell.char) : " ";
        const width = cell.kind === "char" ? cell.width : 1;

        chars.push(char);
        x += width;
      }

      lines.push(chars.join(""));
    }

    return lines.join("\n");
  }

  function createPasteHighlight(selection: RectSelection, text: string) {
    const lines = getClipboardLines(text);

    if (lines.length === 0) {
      return;
    }

    let pastedWidth = 0;
    let pastedHeight = 0;
    const rows: Cell[][] = [];

    for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
      let x = 0;
      const rowCells: Cell[] = [];

      for (const grapheme of getGraphemes(lines[rowIndex].replace(/\t/g, "    "))) {
        const isBlank = isClipboardBlankGrapheme(grapheme);
        const char = grapheme === " " ? NBSP : grapheme;
        const width = isBlank ? getCharWidth(grapheme) : getCharWidth(char);

        while (rowCells.length < x) {
          rowCells.push(createEmptyCell());
        }

        if (isBlank) {
          rowCells.push(createEmptyCell());

          if (width === 2) {
            rowCells.push(createEmptyCell());
          }
        } else {
          rowCells.push({
            kind: "char",
            char,
            width,
            fgc: toolState.selectedFGC,
            bgc: toolState.selectedBGC,
          });

          if (width === 2) {
            rowCells.push({
              kind: "wide-tail",
              headX: x,
            });
          }
        }

        x += width;
      }

      pastedWidth = Math.max(pastedWidth, rowCells.length);
      pastedHeight = rowIndex + 1;
      rows.push(rowCells);
    }

    if (pastedWidth <= 0 || pastedHeight <= 0) {
      return;
    }

    const contents = createEmptyCellGrid(pastedWidth, pastedHeight);

    rows.forEach((row, y) => {
      row.forEach((cell, x) => {
        contents[y][x] = cloneCell(cell);
      });
    });

    toolState.highlight = {
      kind: "rect",
      x: selection.x,
      y: selection.y,
      width: pastedWidth,
      height: pastedHeight,
      contents,
      origin: null,
    };
  }

  function getRectHighlight(): HighlightRect | null {
    return toolState.highlight.kind === "rect" ? toolState.highlight : null;
  }

  function getPasteOriginSelection(): RectSelection {
    const selection = getRectHighlight();

    if (selection) {
      return selection;
    }

    const position = cursorPosition.value ?? { x: 0, y: 0 };

    return {
      kind: "rect",
      x: clamp(position.x, 0, GRID_COLUMNS - 1),
      y: clamp(position.y, 0, GRID_ROWS - 1),
      width: 1,
      height: 1,
    };
  }

  function updateForegroundDefaultColor(previousColor: Color, nextColor: Color) {
    for (const layer of documentModel.layers) {
      for (const row of layer.cells) {
        for (const cell of row) {
          if (cell.kind === "char" && cell.fgc === previousColor) {
            cell.fgc = nextColor;
          }
        }
      }
    }

    if (toolState.selectedFGC === previousColor) {
      toolState.selectedFGC = nextColor;
    }

    const highlight = getRectHighlight();

    if (highlight) {
      forEachCharCellInHighlight(highlight, (cell) => {
        if (cell.fgc === previousColor) {
          cell.fgc = nextColor;
        }
      });
    }
  }

  function forEachCharCellInHighlight(highlight: HighlightRect, callback: (cell: Extract<Cell, { kind: "char" }>) => void) {
    for (const row of highlight.contents) {
      for (const cell of row) {
        if (cell.kind === "char") {
          callback(cell);
        }
      }
    }
  }

  function canPlaceCharOnEmptyCells(layer: Layer, x: number, y: number, width: 1 | 2) {
    if (x + width > layer.cells[y].length) {
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

  function getSimilarPalette() {
    return palettes.find((palette): palette is SimilarPalette => palette.kind === "similar");
  }

  function getCellText(x: number, y: number) {
    const compositedCell = compositedGrid.value[y][x];
    if (compositedCell.kind === "wide-tail") {
      return "\u00a0";
    }

    return compositedCell.char === " " ? "\u00a0" : compositedCell.char;
  }

  function getCellClass(x: number, y: number) {
    const compositedCell = compositedGrid.value[y][x];

    if (compositedCell.kind === "char" && compositedCell.width === 2) {
      return ["is-wide-head"];
    }

    if (compositedCell.kind === "wide-tail") {
      return ["is-wide-tail"];
    }

    return [];
  }

  function getCellStyle(x: number, y: number) {
    const compositedCell = compositedGrid.value[y][x];
    const style = { backgroundColor: `#${compositedCell.bgc}` } as Record<string, string>;

    if (compositedCell.fgc) {
      style.color = `#${compositedCell.fgc}`;
    }

    return style;
  }

  function getHighlightPreviewCells(highlight: HighlightRect): StampPreviewCell[] {
    const previewCells: StampPreviewCell[] = [];

    highlight.contents.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (cell.kind !== "char") {
          return;
        }

        previewCells.push({
          x: highlight.x + columnIndex,
          y: highlight.y + rowIndex,
          text: cell.char === " " ? "\u00a0" : cell.char,
          style: {
            color: `#${cell.fgc}`,
            backgroundColor: `#${cell.bgc ?? documentModel.canvasBGC}`,
          },
          className: cell.width === 2 ? ["is-wide-head"] : [],
        });
      });
    });

    return previewCells;
  }

  function placeStampAtCenter(stamp: Stamp) {
    const originX = Math.floor((GRID_COLUMNS - stamp.width) / 2);
    const originY = Math.floor((GRID_ROWS - stamp.height) / 2);

    const contents = createEmptyCellGrid(stamp.width, stamp.height);

    stamp.cells.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (!cell) {
          return;
        }

        contents[rowIndex][columnIndex] = {
          kind: "char",
          char: cell.char,
          width: cell.width,
          fgc: resolveStampFGC(cell.fgc),
          bgc: cell.bgc,
        };

        if (cell.width === 2 && columnIndex + 1 < stamp.width) {
          contents[rowIndex][columnIndex + 1] = {
            kind: "wide-tail",
            headX: columnIndex,
          };
        }
      });
    });

    toolState.highlight = {
      kind: "rect",
      x: originX,
      y: originY,
      width: stamp.width,
      height: stamp.height,
      contents,
      origin: null,
    };
  }

  function openTextEditor(x: number, y: number) {
    closeSelectionContextMenu();
    textDraft.value = {
      x: clamp(x, 0, GRID_COLUMNS - 1),
      y: clamp(y, 0, GRID_ROWS - 1),
      value: "",
    };
  }

  function updateTextEditorValue(value: string) {
    if (!textDraft.value) {
      return;
    }

    textDraft.value.value = value;
  }

  function confirmTextEditor() {
    const draft = textDraft.value;

    if (!draft) {
      return;
    }

    if (!getEditableActiveLayer()) {
      closeTextEditor();
      return;
    }

    const placement = getTextPlacement(draft.x, draft.y, draft.value);

    if (placement.width <= 0 || placement.height <= 0) {
      closeTextEditor();
      return;
    }

    toolState.highlight = {
      kind: "rect",
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      contents: placement.contents,
      origin: null,
    };
    closeTextEditor();
  }

  function closeTextEditor() {
    textDraft.value = null;
  }

  function getTextEditorWidthCells(value: string, x: number) {
    const lines = getClipboardLines(value.replace(/\t/g, "    "));
    const maxLineWidth = Math.max(1, ...lines.map((line) => getTextLineWidth(line)));
    const remainingWidth = GRID_COLUMNS - clamp(x, 0, GRID_COLUMNS - 1);
    return clamp(Math.max(6, maxLineWidth + 1), 1, Math.max(1, remainingWidth));
  }

  function getTextEditorHeightCells(value: string, y: number) {
    const lineCount = Math.max(1, countEditorLines(value));
    const remainingHeight = GRID_ROWS - clamp(y, 0, GRID_ROWS - 1);
    return clamp(Math.max(1, lineCount), 1, Math.max(1, remainingHeight));
  }

  function getTextLineWidth(line: string) {
    let width = 0;

    for (const grapheme of getGraphemes(line)) {
      width += grapheme === " " ? 1 : getCharWidth(grapheme);
    }

    return width;
  }

  function getTextPlacement(originX: number, originY: number, value: string) {
    const lines = getClipboardLines(value);
    const rows: Cell[][] = [];
    let maxWidth = 0;

    for (let rowIndex = 0; rowIndex < lines.length; rowIndex += 1) {
      let x = 0;
      const rowCells: Cell[] = [];

      for (const grapheme of getGraphemes(lines[rowIndex].replace(/\t/g, "    "))) {
        const char = grapheme === " " ? NBSP : grapheme;
        const width = getCharWidth(char);

        rowCells[x] = {
          kind: "char",
          char,
          width,
          fgc: toolState.selectedFGC,
          bgc: toolState.selectedBGC,
        };

        if (width === 2) {
          rowCells[x + 1] = {
            kind: "wide-tail",
            headX: x,
          };
        }

        x += width;
      }

      maxWidth = Math.max(maxWidth, rowCells.length);
      rows.push(rowCells);
    }

    if (maxWidth <= 0 || rows.length === 0) {
      return {
        x: originX,
        y: originY,
        width: 0,
        height: 0,
        contents: createEmptyCellGrid(0, 0),
      };
    }

    const contents = createEmptyCellGrid(maxWidth, rows.length);

    rows.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (cell) {
          contents[y][x] = cloneCell(cell);
        }
      });
    });

    return {
      x: originX,
      y: originY,
      width: maxWidth,
      height: rows.length,
      contents,
    };
  }

  function expandSelectionForWideCells(layer: Layer, selection: RectSelection): RectSelection {
    let left = selection.x;
    let top = selection.y;
    let right = selection.x + selection.width - 1;
    let bottom = selection.y + selection.height - 1;
    let didExpand = true;

    while (didExpand) {
      didExpand = false;

      for (let y = top; y <= bottom; y += 1) {
        for (let x = left; x <= right; x += 1) {
          const cell = getCell(layer, x, y);

          if (cell?.kind === "wide-tail" && cell.headX < left) {
            left = cell.headX;
            didExpand = true;
          }

          if (cell?.kind === "char" && cell.width === 2 && x + 1 > right) {
            right = x + 1;
            didExpand = true;
          }
        }
      }
    }

    left = clamp(left, 0, GRID_COLUMNS - 1);
    top = clamp(top, 0, GRID_ROWS - 1);
    right = clamp(right, left, GRID_COLUMNS - 1);
    bottom = clamp(bottom, top, GRID_ROWS - 1);

    return {
      kind: "rect",
      x: left,
      y: top,
      width: right - left + 1,
      height: bottom - top + 1,
    };
  }

  function copyLayerCells(layer: Layer, selection: RectSelection) {
    const contents = createEmptyCellGrid(selection.width, selection.height);

    for (let y = 0; y < selection.height; y += 1) {
      for (let x = 0; x < selection.width; x += 1) {
        const cell = getCell(layer, selection.x + x, selection.y + y);

        if (!cell) {
          continue;
        }

        contents[y][x] = cloneCellWithRelativeHead(cell, selection.x);
      }
    }

    return contents;
  }

  function createHighlightLayer(width: number, height: number, contents?: CellGrid): Layer {
    return {
      id: "highlight",
      name: "Highlight",
      visible: true,
      locked: false,
      cells: contents ? cloneCellGrid(contents) : createEmptyCellGrid(width, height),
    };
  }

  function createEmptyCellGrid(width: number, height: number): CellGrid {
    return Array.from({ length: height }, () => Array.from({ length: width }, createEmptyCell));
  }

  function replaceHighlightContents(contents: CellGrid) {
    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    toolState.highlight = {
      ...highlight,
      contents: cloneCellGrid(contents),
    };
  }

  function writeHighlightToLayer(layer: Layer, highlight: HighlightRect, transparent: boolean) {
    if (!transparent) {
      clearLayerRect(layer, highlight.x, highlight.y, highlight.width, highlight.height);
    }

    for (let y = 0; y < highlight.height; y += 1) {
      for (let x = 0; x < highlight.width; x += 1) {
        const targetX = highlight.x + x;
        const targetY = highlight.y + y;
        const cell = highlight.contents[y]?.[x];

        if (!cell || targetX < 0 || targetX >= GRID_COLUMNS || targetY < 0 || targetY >= GRID_ROWS) {
          continue;
        }

        if (cell.kind === "empty") {
          if (!transparent) {
            eraseCell(layer, targetX, targetY);
          }
          continue;
        }

        if (cell.kind === "char") {
          placeChar(layer, targetX, targetY, cell.char, cell.fgc, cell.bgc, cell.width);
        }
      }
    }
  }

  function writeCellGridToLayer(layer: Layer, originX: number, originY: number, contents: CellGrid) {
    clearLayerRect(layer, originX, originY, contents[0]?.length ?? 0, contents.length);

    contents.forEach((row, y) => {
      row.forEach((cell, x) => {
        const targetX = originX + x;
        const targetY = originY + y;

        if (cell.kind === "char" && targetX >= 0 && targetX < GRID_COLUMNS && targetY >= 0 && targetY < GRID_ROWS) {
          placeChar(layer, targetX, targetY, cell.char, cell.fgc, cell.bgc, cell.width);
        }
      });
    });
  }

  function clearLayerRect(layer: Layer, originX: number, originY: number, width: number, height: number) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const targetX = originX + x;
        const targetY = originY + y;

        if (targetX >= 0 && targetX < GRID_COLUMNS && targetY >= 0 && targetY < GRID_ROWS) {
          eraseCell(layer, targetX, targetY);
        }
      }
    }
  }

  function cloneCellGrid(contents: CellGrid): CellGrid {
    return contents.map((row) => row.map(cloneCell));
  }

  function cloneCell(cell: Cell): Cell {
    if (cell.kind === "char") {
      return { ...cell };
    }

    if (cell.kind === "wide-tail") {
      return { ...cell };
    }

    return createEmptyCell();
  }

  function cloneCellWithRelativeHead(cell: Cell, originX: number): Cell {
    if (cell.kind === "wide-tail") {
      return {
        kind: "wide-tail",
        headX: cell.headX - originX,
      };
    }

    return cloneCell(cell);
  }

  function resolveStampFGC(fgc: string | null) {
    return fgc ?? getForegroundDefaultColor();
  }

  function getForegroundDefaultColor() {
    return invertHexColor(documentModel.canvasBGC);
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
    foregroundDefaultColor,
    colorSchemes,
    documentModel,
    gridCells,
    gridLineStyle,
    info,
    isUnicodeGlyphPageScanRunning,
    layerList,
    palettes,
    selectedPaletteCode,
    selectionStyle,
    selectionContextMenu,
    selectionContextMenuStyle,
    highlightCells,
    textDraft,
    textEditorStyle,
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
    handleGridMeasureDown,
    handleGridWheel,
    handleHighlightContext,
    handleHighlightMove,
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
    scanAllUnicodeGlyphPages,
    selectPalette,
    selectPaletteChar,
    closeSelectedColorPicker,
    closeTextEditor,
    openSelectionBGCColorPicker,
    openSelectionFGCColorPicker,
    confirmTextEditor,
    selectStamp,
    selectStampSet,
    selectSelectedColor,
    selectLayer,
    selectTool,
    openSelectedBGCColorPicker,
    openSelectedFGCColorPicker,
    openTextEditor,
    loadDocument,
    stopDrawing,
    updateTextEditorValue,
    toggleLayerLocked,
    toggleLayerVisible,
    cancelSimilarSearch,
    startSimilarSearch,
    updateSimilarCanvasSize,
    updateSimilarFontFamily,
    updateSimilarMaxResults,
    updateSimilarQuery,
    updateSimilarThreshold,
    updateSimilarWidthMatch,
    updateUnicodeQuery,
    updateUnicodeScrollOffset,
    toolCursorOverlay,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function cloneDocument(documentValue: AaDocument): AaDocument {
  return JSON.parse(JSON.stringify(documentValue)) as AaDocument;
}

function cloneHighlight(highlight: Highlight): Highlight {
  return JSON.parse(JSON.stringify(highlight)) as Highlight;
}

function getContextMenuPosition(x: number, y: number) {
  const menuWidth = 172;
  const menuHeight = 102;

  return {
    x: clamp(x, 0, Math.max(0, window.innerWidth - menuWidth)),
    y: clamp(y, 0, Math.max(0, window.innerHeight - menuHeight)),
  };
}

function createExportContent(format: ExportFormat, grid: ExportGrid, name: string, canvasBGC: Color) {
  if (format === "ansi") {
    return createAnsiExport(grid);
  }

  if (format === "mds") {
    return createMdsExport(grid);
  }

  if (format === "html") {
    return createHtmlExport(grid, name, canvasBGC);
  }

  return createPlainTextExport(grid);
}

function createPlainTextExport(grid: ExportGrid) {
  return grid.map((row) => trimExportRow(row).filter(isExportContentCell).map((cell) => cell.char).join("")).join("\n");
}

function createAnsiExport(grid: ExportGrid) {
  let currentFGC: string | null = null;
  let currentBGC: string | null = null;
  let hasActiveStyle = false;

  const lines = grid.map((row) =>
    trimExportRow(row)
      .filter(isExportContentCell)
      .map((cell) => {
        let prefix = "";
        const nextFGC = cell.sourceLayerId === null ? currentFGC : cell.fgc;
        const nextBGC = cell.sourceLayerId === null ? currentBGC : cell.bgc;

        if (nextFGC !== currentFGC || nextBGC !== currentBGC) {
          prefix = nextFGC === null && nextBGC === null ? "\x1b[0m" : `\x1b[38;2;${hexToRgbTriplet(nextFGC ?? "ffffff")};48;2;${hexToRgbTriplet(nextBGC ?? "000000")}m`;
          currentFGC = nextFGC;
          currentBGC = nextBGC;
          hasActiveStyle = nextFGC !== null || nextBGC !== null;
        }

        return `${prefix}${cell.char}`;
      })
      .join(""),
  );

  const content = lines.join("\n");
  return hasActiveStyle ? `${content}\x1b[0m` : content;
}

function createMdsExport(grid: ExportGrid) {
  let currentFGC: string | null = null;
  let currentBGC: string | null = null;
  let hasActiveFGC = false;
  let hasActiveBGC = false;

  const lines = grid.map((row) =>
    trimExportRow(row)
      .filter(isExportContentCell)
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
      .join(""),
  );

  return `<clear>\n${lines.join("\n")}${hasActiveBGC ? "<bgcolor>" : ""}${hasActiveFGC ? "<color>" : ""}`;
}

function createHtmlExport(grid: ExportGrid, name: string, canvasBGC: Color) {
  const rows = grid.map(createHtmlRowMarkup).join("\n");
  const escapedTitle = escapeHtmlText(name.trim() || DEFAULT_DOCUMENT_NAME);

  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapedTitle}</title>`,
    "<style>",
    ":root{--cell-width:8px;--cell-height:16px;--cell-font-size:16px;--aa-font-family:\"MS Gothic\",\"ＭＳ ゴシック\",\"Courier New\",monospace;}",
    "html,body{margin:0;min-height:100%;font-synthesis:none;}",
    `body{background:#${canvasBGC};}`,
    `.aa-art{display:grid;grid-template-rows:repeat(${GRID_ROWS},var(--cell-height));width:calc(var(--cell-width) * ${GRID_COLUMNS});min-height:calc(var(--cell-height) * ${GRID_ROWS});margin:0;padding:16px;background:#${canvasBGC};}`,
    `.aa-row{display:grid;grid-template-columns:repeat(${GRID_COLUMNS},var(--cell-width));height:var(--cell-height);}`,
    ".aa-run{display:block;height:var(--cell-height);overflow:visible;font-family:var(--aa-font-family);font-size:var(--cell-font-size);line-height:var(--cell-height);white-space:pre;}",
    "</style>",
    "</head>",
    "<body>",
    `<div class="aa-art">${rows}</div>`,
    "</body>",
    "</html>",
  ].join("\n");
}

function createHtmlRowMarkup(row: ExportGrid[number]) {
  const runs = createHtmlRuns(row);
  const content = runs.map(createHtmlRunMarkup).join("");

  return `<div class="aa-row">${content}</div>`;
}

function createHtmlRuns(row: ExportGrid[number]) {
  const runs: HtmlRun[] = [];
  let currentRun: HtmlRun | null = null;

  trimExportRow(row).forEach((cell, x) => {
    if (cell.kind === "wide-tail") {
      return;
    }

    const fgc = cell.sourceLayerId === null ? null : cell.fgc;
    const bgc = cell.sourceLayerId === null ? null : cell.bgc;

    if (cell.sourceLayerId === null && cell.char === " ") {
      currentRun = null;
      return;
    }

    const width = cell.width;
    const text = escapeHtmlText(cell.char);

    if (currentRun && currentRun.x + currentRun.width === x && currentRun.fgc === fgc && currentRun.bgc === bgc) {
      currentRun.width += width;
      currentRun.text += text;
      return;
    }

    currentRun = { x, width, fgc, bgc, text };
    runs.push(currentRun);
  });

  return runs;
}

function createHtmlRunMarkup(run: HtmlRun) {
  const style = [`grid-column:${run.x + 1} / span ${run.width}`, createHtmlColorStyle(run.fgc, run.bgc)].filter(Boolean).join(";");

  return `<span class="aa-run" style="${style}">${run.text}</span>`;
}

function trimExportRow<T extends { char: string }>(row: T[]) {
  let end = row.length;

  while (end > 0 && row[end - 1].char === " ") {
    end -= 1;
  }

  return row.slice(0, end);
}

function isExportContentCell<T extends { kind?: string }>(cell: T) {
  return cell.kind !== "wide-tail";
}

function createExportFilename(name: string, format: ExportFormat) {
  const baseName = toSafeJsonFilename(name);

  if (format === "ansi") {
    return `${baseName}.ansi.txt`;
  }

  if (format === "mds") {
    return `${baseName}.mds`;
  }

  if (format === "html") {
    return `${baseName}.html`;
  }

  return `${baseName}.txt`;
}

function createExportMimeType(format: ExportFormat) {
  return format === "html" ? "text/html" : "text/plain";
}

function hexToRgbTriplet(hexColor: string) {
  return [hexColor.slice(0, 2), hexColor.slice(2, 4), hexColor.slice(4, 6)].map((value) => Number.parseInt(value, 16)).join(";");
}

function escapeMdsText(value: string) {
  return value;
}

function createHtmlColorStyle(fgc: string | null, bgc: string | null) {
  return [fgc ? `color:#${fgc}` : "", bgc ? `background-color:#${bgc}` : ""].filter(Boolean).join(";");
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00a0/g, "&nbsp;");
}

function getUnicodeGlyphScanFont() {
  const fontFamily = getComputedStyle(document.documentElement).getPropertyValue("--aa-font-family").trim() || "\"MS Gothic\", monospace";

  return `16px ${fontFamily}`;
}

function getUnicodeGlyphScanWorkerCount() {
  return navigator.hardwareConcurrency || 2;
}

function createUnicodeGlyphScanFilename(firstPage: number, pageCount: number) {
  const lastPage = firstPage + pageCount - 1;

  return `aa-maker-unicode-glyph-pages-${firstPage.toString(16).padStart(4, "0")}-${lastPage.toString(16).padStart(4, "0")}.json`;
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

function blurTextEditingTarget() {
  const activeElement = document.activeElement;

  if (activeElement instanceof HTMLElement && isEditableElement(activeElement)) {
    activeElement.blur();
  }
}

function isEditableElement(element: HTMLElement) {
  return element.isContentEditable || element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}

function getClipboardLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const withoutTrailingLineBreak = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;

  return withoutTrailingLineBreak === "" ? [] : withoutTrailingLineBreak.split("\n");
}

function countEditorLines(text: string) {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return normalized === "" ? 1 : normalized.split("\n").length;
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
