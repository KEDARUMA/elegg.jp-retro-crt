import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import eraserIcon from "../assets/icons/eraser.svg?raw";
import eyedropperIcon from "../assets/icons/eyedropper.svg?raw";
import penIcon from "../assets/icons/pen.svg?raw";
import selectIcon from "../assets/icons/select.svg?raw";
import stampIcon from "../assets/icons/stamp.svg?raw";
import textIcon from "../assets/icons/text.svg?raw";
import charPalettes from "../data/library/char-palettes.json";
import stampLibraryIndex from "../data/library/stamps/index.json";
import unicodeGlyphPages from "../data/static/unicode-glyph-pages.json";
import { loadStoredAppSettings, saveStoredAppSettings, type AppLanguage } from "../model/appSettings";
import { composeDocument } from "../model/composeLayers";
import { DEFAULT_DOCUMENT_NAME, NBSP, createEmptyCell, createEmptyDocument, createInitialToolState, createLayer } from "../model/createDocument";
import { eraseCell, getCell, getCharWidth, getFirstGrapheme, getHeadCell, placeChar, setCharWidthMode, shouldFitWideGlyphIntoNarrowCell } from "../model/gridOperations";
import { LIBRARY_ARCHIVE_FILENAME, createLibraryArchiveBlob, readLibraryArchiveFile, type LibraryCharPalette, type LibraryStampIndexItem, type LibraryStampSet } from "../model/libraryArchive";
import { reflowDocumentToWidthMode, reflowStampCollectionsToWidthMode } from "../model/reflow";
import { parseStampMdsSources } from "../model/parseStampMds";
import type { Cell, CellGrid, Color, ColorScheme, Document as AaDocument, Highlight, Layer, Stamp, StampCell, Tool } from "../model/types";
import type { WidthMode } from "../model/widthMode";
import type { ImageToAsciiApplyGrid } from "../search/imageToAsciiMatching";
import {
  createDefaultSimilarGlyphSearchMatchingParams,
  DEFAULT_SIMILAR_GLYPH_SEARCH_MATCHING_METHOD,
  startSimilarGlyphSearch,
} from "../search/similarGlyphSearch";
import type {
  SimilarGlyphSearchHandle,
  SimilarGlyphSearchMatchingMethod,
  SimilarGlyphSearchMatchingParams,
  SimilarGlyphSearchResult,
  UnicodeGlyphPageData,
} from "../search/similarGlyphSearch";
import { clamp } from "../utils/clamp";

type NormalPalette = {
  kind: "normal";
  id: string;
  name: string;
  columns?: number;
  startCode?: number;
  chars: (string | null)[];
};

type HistoryPalette = {
  kind: "history";
  id: string;
  name: string;
  columns: number;
  history: (string | null)[];
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
  targetBitmap: number[];
  fontFamily: string;
  canvasSize: 16 | 32;
  matchingMethod: SimilarGlyphSearchMatchingMethod;
  matchingParams: SimilarGlyphSearchMatchingParams;
  threshold: number;
  maxResults: number;
  results: SimilarGlyphSearchResult[];
  isSearching: boolean;
  status: string;
  checkedPageCount: number;
  totalPageCount: number;
  checkedCodePointCount: number;
};

type Palette = NormalPalette | HistoryPalette | KeyboardInputPalette | UnicodePalette | SimilarPalette;
type SimilarBitmapBrush = "hard" | "soft";

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
  glyphClassName: string[];
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
type CharPaletteHistorySnapshot = {
  normalPalettes: NormalPalette[];
  activePaletteId: string;
  selectedPaletteCellIndex: number | null;
};
type StampPaletteHistorySnapshot = {
  stampSets: StampSet[];
  activeStampSetId: string;
  activeStampId: string;
};
type SimilarBitmapHistorySnapshot = {
  targetBitmap: number[];
};
type UndoHistoryTarget = "document" | "charPalette" | "stampPalette" | "similarBitmap";
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
  kind: "icon" | "cell";
  style: Record<string, string>;
  icon?: string;
  text?: string;
  cellStyle?: Record<string, string>;
};
type SelectedAppearanceSnapshot = {
  char: string | null;
  width: 1 | 2;
  fgc: Color;
  bgc: Color;
};
type EditableListItem = {
  id: string;
  name: string;
  protected?: boolean;
};
type LibraryCharPaletteFileItem = Omit<NormalPalette, "kind" | "chars"> & {
  chars: string[];
};

const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const HISTORY_CELL_COUNT = 128;
const EMPTY_NORMAL_PALETTE_CELL_COUNT = 256;
const UNDO_HISTORY_LIMIT = 100;
const HISTORY_STORAGE_KEY = "aa-maker.char-palette.history.v1";
const PROTECTED_PALETTE_IDS = new Set(["cp437", "history", "keyboard-input", "unicode", "similar"]);
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
const SIMILAR_BITMAP_HARD_BRUSH = [{ dx: 0, dy: 0, alpha: 255 }];
const SIMILAR_BITMAP_SOFT_BRUSH = [
  { dx: -1, dy: -1, alpha: 96 },
  { dx: 0, dy: -1, alpha: 160 },
  { dx: 1, dy: -1, alpha: 96 },
  { dx: -1, dy: 0, alpha: 160 },
  { dx: 0, dy: 0, alpha: 255 },
  { dx: 1, dy: 0, alpha: 160 },
  { dx: -1, dy: 1, alpha: 96 },
  { dx: 0, dy: 1, alpha: 160 },
  { dx: 1, dy: 1, alpha: 96 },
];
const stampMdsModules = import.meta.glob("../data/library/stamps/*.mds", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const stampLibraryItems = stampLibraryIndex as StampLibraryIndexItem[];
const stampSources = stampLibraryItems.flatMap((item) => {
  const content = stampMdsModules[`../data/library/stamps/${item.file}`];

  if (typeof content !== "string") {
    return [];
  }

  return [{ id: item.id, name: item.name, content }];
});
const colorSchemes: ColorScheme[] = [
  {
    id: "basic",
    name: "Basic",
    colors: ["000000", "555555", "aaaaaa", "ffffff", "ff5555", "ffaa00", "ffff55", "55ff55", "55ffff", "5555ff", "aa55ff", "ff55ff"],
  },
];

type StoredHistoryPalette = {
  history?: unknown;
};

export function useAaMaker() {
  const storedSettings = loadStoredAppSettings();
  const language = ref<AppLanguage>(storedSettings.language);
  const widthMode = ref<WidthMode>(storedSettings.widthMode);

  setCharWidthMode(widthMode.value);

  const normalPalettes = (charPalettes as LibraryCharPaletteFileItem[]).map((palette) => ({
    ...palette,
    kind: "normal" as const,
    chars: expandLibraryPaletteChars(palette.chars),
  }));
  const defaultNormalPaletteById = new Map(normalPalettes.map((palette) => [palette.id, { ...palette, chars: [...palette.chars] }]));
  const initialStampSets = createStampSets(parseStampMdsSources(stampSources));
  const defaultStampSetById = new Map(initialStampSets.map((stampSet) => [stampSet.id, { ...stampSet, stamps: [...stampSet.stamps] }]));
  const stampLibraryFileById = new Map(stampLibraryItems.map((item) => [item.id, item.file]));
  const storedHistory = loadStoredHistoryPalette();
  const palettes = reactive<Palette[]>([
    ...normalPalettes,
    {
      kind: "history",
      id: "history",
      name: "History",
      columns: 16,
      history: storedHistory.history,
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
      targetBitmap: createBlankSimilarBitmap(16),
      fontFamily: SIMILAR_GLYPH_DEFAULT_FONT_FAMILY,
      canvasSize: 16,
      matchingMethod: DEFAULT_SIMILAR_GLYPH_SEARCH_MATCHING_METHOD,
      matchingParams: createDefaultSimilarGlyphSearchMatchingParams(),
      threshold: SIMILAR_GLYPH_DEFAULT_THRESHOLD,
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
  const selectedPaletteCellIndex = ref<number | null>(null);
  const stampSets = reactive<StampSet[]>(initialStampSets.map((stampSet) => ({ ...stampSet, stamps: [...stampSet.stamps] })));
  const activeStampSetId = ref(stampSets[0]?.id ?? "");
  const activeStampId = ref("");
  const documentModel = reactive(createEmptyDocument(storedSettings.canvasBGC));
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
  const charPaletteUndoStack = ref<CharPaletteHistorySnapshot[]>([]);
  const charPaletteRedoStack = ref<CharPaletteHistorySnapshot[]>([]);
  const stampPaletteUndoStack = ref<StampPaletteHistorySnapshot[]>([]);
  const stampPaletteRedoStack = ref<StampPaletteHistorySnapshot[]>([]);
  const similarBitmapUndoStack = ref<SimilarBitmapHistorySnapshot[]>([]);
  const similarBitmapRedoStack = ref<SimilarBitmapHistorySnapshot[]>([]);
  const undoHistoryOrderStack = ref<UndoHistoryTarget[]>([]);
  const redoHistoryOrderStack = ref<UndoHistoryTarget[]>([]);
  const textDraft = ref<TextDraft | null>(null);
  const isUnicodeGlyphPageScanRunning = ref(false);
  const hasUnsavedDocumentChange = ref(false);
  const isImageToAsciiArtModalDirty = ref(false);
  const toolCursorPosition = ref<{ x: number; y: number } | null>(null);
  const toolCursorCellPreview = ref<{ char: string; fgc: Color; bgc: Color } | null>(null);
  const selectedCharAttentionKey = ref(0);
  let similarGlyphSearchHandle: SimilarGlyphSearchHandle | null = null;
  let toolCursorCellPreviewTimer: number | null = null;

  watch(
    [language, widthMode, () => documentModel.canvasBGC],
    () => {
      saveStoredAppSettings({
        language: language.value,
        canvasBGC: documentModel.canvasBGC,
        widthMode: widthMode.value,
      });
    },
    { immediate: true },
  );

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

    if (!position) {
      return null;
    }

    const cellPreview = toolCursorCellPreview.value;

    if (cellPreview) {
      return {
        kind: "cell",
        text: cellPreview.char,
        style: {
          left: `${position.x + TOOL_CURSOR_OVERLAY_OFFSET_X}px`,
          top: `${position.y + TOOL_CURSOR_OVERLAY_OFFSET_Y}px`,
          width: `${TOOL_CURSOR_OVERLAY_SIZE}px`,
          height: `${TOOL_CURSOR_OVERLAY_SIZE}px`,
          padding: `${TOOL_CURSOR_OVERLAY_PADDING}px`,
          borderRadius: `${TOOL_CURSOR_OVERLAY_RADIUS}px`,
          color: `#${cellPreview.fgc}`,
          backgroundColor: `#${cellPreview.bgc}`,
        },
        cellStyle: {
          color: `#${cellPreview.fgc}`,
          backgroundColor: `#${cellPreview.bgc}`,
        },
      };
    }

    const icon = activeToolCursorIcon.value;

    if (!icon) {
      return null;
    }

    const isPenTool = toolState.activeTool === "pen";
    const iconForeground = isPenTool ? toolState.selectedFGC : "111111";
    const iconBackground = isPenTool ? (toolState.selectedBGC ?? documentModel.canvasBGC) : "f2f2f2";

    return {
      kind: "icon",
      icon,
      style: {
        left: `${position.x + TOOL_CURSOR_OVERLAY_OFFSET_X}px`,
        top: `${position.y + TOOL_CURSOR_OVERLAY_OFFSET_Y}px`,
        width: `${TOOL_CURSOR_OVERLAY_SIZE}px`,
        height: `${TOOL_CURSOR_OVERLAY_SIZE}px`,
        padding: `${TOOL_CURSOR_OVERLAY_PADDING}px`,
        borderRadius: `${TOOL_CURSOR_OVERLAY_RADIUS}px`,
        color: `#${iconForeground}`,
        backgroundColor: `#${iconBackground}`,
        borderColor: `#${iconForeground}`,
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
  const initialPaletteCellIndex =
    activePalette.value.kind === "normal" && toolState.selectedChar !== null ? activePalette.value.chars.indexOf(toolState.selectedChar) : -1;
  if (initialPaletteCellIndex >= 0) {
    selectedPaletteCellIndex.value = initialPaletteCellIndex;
  }
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
  const cursorStyle = computed(() => {
    const position = cursorPosition.value;

    if (!position) {
      return null;
    }

    return {
      left: `calc(var(--cell-width) * ${position.x})`,
      top: `calc(var(--cell-height) * ${position.y})`,
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

    if (typeof activePalette.value.startCode === "number") {
      if (index < 0) {
        return toolState.selectedChar.codePointAt(0) ?? null;
      }

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
    document.addEventListener("contextmenu", handleDocumentContextMenu, { capture: true });
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
    document.removeEventListener("contextmenu", handleDocumentContextMenu, { capture: true });
    document.removeEventListener("keydown", handleDocumentKeyDown, { capture: true });
    document.removeEventListener("pointerdown", closeSelectionContextMenu);
    window.removeEventListener("blur", hideToolCursor);
    window.removeEventListener("beforeunload", handleBeforeUnload);
    clearToolCursorCellPreview();
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
    const previousAppearance = getSelectedAppearanceSnapshot();

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
    notifySelectedAppearanceChange(previousAppearance);

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
    downloadTextFile(`${toSafeJsonFilename(trimmedName)}.json`, JSON.stringify(createSavedDocumentState(), null, 2), "application/json");
    hasUnsavedDocumentChange.value = false;
  }

  function saveLibrary() {
    downloadBlob(LIBRARY_ARCHIVE_FILENAME, createLibraryArchiveBlob(createSavedLibrary()));
  }

  async function loadLibrary(file: File) {
    try {
      const library = await readLibraryArchiveFile(file);

      if (!library) {
        window.alert("Load library failed: invalid AA Maker library ZIP.");
        return;
      }

      applyLoadedLibrary(library);
    } catch {
      window.alert("Load library failed: invalid AA Maker library ZIP.");
    }
  }

  async function loadDocument(file: File) {
    try {
      const rawText = await file.text();
      const parsedValue = JSON.parse(rawText) as unknown;
      const loadedDocument = normalizeLoadedAaMakerState(parsedValue);

      if (!loadedDocument) {
        window.alert("Load failed: invalid AA Maker JSON.");
        return;
      }

      Object.assign(documentModel, loadedDocument);
      reflowDocumentToWidthMode(documentModel, widthMode.value);
      toolState.highlight = { kind: "none" };
      draftSelection.value = null;
      cursorPosition.value = null;
      closeTextEditor();
      clearDocumentHistory();
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
    setCanvasColor(invertHexColor(documentModel.canvasBGC));
  }

  function setCanvasColor(color: Color) {
    if (documentModel.canvasBGC === color) {
      return;
    }

    const previousForegroundDefaultColor = getForegroundDefaultColor();
    const previousAppearance = getSelectedAppearanceSnapshot();

    recordDocumentHistory();
    documentModel.canvasBGC = color;
    updateForegroundDefaultColor(previousForegroundDefaultColor, getForegroundDefaultColor());
    notifySelectedAppearanceChange(previousAppearance);
  }

  function setLanguage(nextLanguage: AppLanguage) {
    language.value = nextLanguage;
  }

  function setWidthMode(nextWidthMode: WidthMode) {
    if (widthMode.value === nextWidthMode) {
      return;
    }

    const previousAppearance = getSelectedAppearanceSnapshot();

    closeSelectionContextMenu();

    if (textDraft.value) {
      confirmTextEditor();
    }

    stopDrawing();

    if (toolState.highlight.kind === "rect") {
      commitHighlight();
    }

    const similarPalette = getSimilarPalette();
    cancelSimilarSearch();

    if (similarPalette) {
      similarPalette.results = [];
      similarPalette.checkedPageCount = 0;
      similarPalette.totalPageCount = 0;
      similarPalette.checkedCodePointCount = 0;
      similarPalette.status = "Idle";
    }

    recordDocumentHistory();
    widthMode.value = nextWidthMode;
    setCharWidthMode(nextWidthMode);
    reflowDocumentToWidthMode(documentModel, nextWidthMode);
    reflowStampCollectionsToWidthMode(stampSets, nextWidthMode);
    reflowStampCollectionsToWidthMode([...defaultStampSetById.values()], nextWidthMode);
    toolState.selectedCharWidth = toolState.selectedChar === null ? 1 : getCharWidth(toolState.selectedChar, nextWidthMode);
    notifySelectedAppearanceChange(previousAppearance);
  }

  function selectPaletteChar(char: string, width: 1 | 2, fillEmptyOnly = false) {
    const previousAppearance = getSelectedAppearanceSnapshot();

    if (toolState.activeTool !== "pen" && toolState.activeTool !== "select") {
      selectTool("pen");
    }

    setSelectedChar(char, width, true);

    if (fillEmptyOnly) {
      fillEmptySelectionWithChar(char, width);
    } else {
      fillSelectionWithChar(char, width);
    }

    if (activePalette.value.kind !== "normal") {
      selectedPaletteCellIndex.value = null;
    }

    notifySelectedAppearanceChange(previousAppearance);
  }

  function selectPalette(paletteId: string) {
    activePaletteId.value = paletteId;
    selectedPaletteCellIndex.value = null;
  }

  function selectPaletteCell(index: number) {
    const palette = activePalette.value;

    if (palette.kind !== "normal" || index < 0 || index >= palette.chars.length) {
      return;
    }

    selectedPaletteCellIndex.value = index;
  }

  function createSavedDocumentState() {
    return cloneDocument(documentModel);
  }

  function createSavedLibrary() {
    const stampFileById = createStampFileById(stampSets, stampLibraryFileById);

    return {
      palettes: palettes.filter((palette): palette is NormalPalette => palette.kind === "normal").map(createLibraryPaletteSnapshot),
      stampSets: stampSets.map((stampSet): LibraryStampSet => ({
        id: stampSet.id,
        name: stampSet.name,
        file: stampFileById.get(stampSet.id) ?? createUniqueStampFilename(stampSet.id, new Set()),
        stamps: cloneStamps(stampSet.stamps),
      })),
    };
  }

  function applyLoadedLibrary(library: { palettes: LibraryCharPalette[]; stampSets: LibraryStampSet[] }) {
    clearLibraryHistory();
    const specialPalettes = palettes.filter((palette) => palette.kind !== "normal");
    const nextNormalPalettes = library.palettes.map(createNormalPaletteFromLibrary);

    palettes.splice(0, palettes.length, ...nextNormalPalettes, ...specialPalettes);
    selectedPaletteCellIndex.value = null;

    if (!palettes.some((palette) => palette.id === activePaletteId.value)) {
      activePaletteId.value = palettes[0]?.id ?? "";
    }

    replaceDefaultNormalPalettes(nextNormalPalettes);

    const nextStampSets = library.stampSets.map((stampSet) => ({
      id: stampSet.id,
      name: stampSet.name,
      stamps: cloneStamps(stampSet.stamps),
    }));

    stampSets.splice(0, stampSets.length, ...nextStampSets);
    stampLibraryFileById.clear();

    for (const stampSet of library.stampSets) {
      stampLibraryFileById.set(stampSet.id, stampSet.file);
    }

    reflowStampCollectionsToWidthMode(stampSets, widthMode.value);
    replaceDefaultStampSets(stampSets);

    if (!stampSets.some((stampSet) => stampSet.id === activeStampSetId.value)) {
      activeStampSetId.value = stampSets[0]?.id ?? "";
    }

    activeStampId.value = "";
    hasUnsavedDocumentChange.value = true;
  }

  function replaceDefaultNormalPalettes(nextPalettes: NormalPalette[]) {
    defaultNormalPaletteById.clear();

    for (const palette of nextPalettes) {
      defaultNormalPaletteById.set(palette.id, cloneNormalPalette(palette));
    }
  }

  function replaceDefaultStampSets(nextStampSets: StampSet[]) {
    defaultStampSetById.clear();

    for (const stampSet of nextStampSets) {
      defaultStampSetById.set(stampSet.id, cloneStampSet(stampSet));
    }
  }

  function getEditableNormalPalette() {
    const palette = activePalette.value;

    if (palette.kind !== "normal" || palette.id === "cp437") {
      return null;
    }

    return palette;
  }

  function insertPaletteCell() {
    const palette = getEditableNormalPalette();

    if (!palette) {
      return;
    }

    const insertIndex = selectedPaletteCellIndex.value === null ? palette.chars.length : clamp(selectedPaletteCellIndex.value + 1, 0, palette.chars.length);

    recordCharPaletteHistory();
    palette.chars.splice(insertIndex, 0, "\u00a0");
    selectedPaletteCellIndex.value = insertIndex;

    hasUnsavedDocumentChange.value = true;
  }

  function deletePaletteCell() {
    const palette = getEditableNormalPalette();
    const selectedIndex = selectedPaletteCellIndex.value;

    if (!palette || selectedIndex === null || selectedIndex < 0 || selectedIndex >= palette.chars.length) {
      return;
    }

    recordCharPaletteHistory();
    palette.chars.splice(selectedIndex, 1);
    selectedPaletteCellIndex.value = findNearestPaletteCellIndex(palette.chars, Math.min(selectedIndex, palette.chars.length - 1));
    hasUnsavedDocumentChange.value = true;
  }

  function overwritePaletteCell(index: number) {
    const palette = getEditableNormalPalette();

    if (!palette || index < 0 || index >= palette.chars.length || toolState.selectedChar === null) {
      return;
    }

    selectedPaletteCellIndex.value = index;

    if (palette.chars[index] === toolState.selectedChar) {
      return;
    }

    recordCharPaletteHistory();
    palette.chars[index] = toolState.selectedChar;
    hasUnsavedDocumentChange.value = true;
  }

  function findNearestPaletteCellIndex(chars: (string | null)[], startIndex: number) {
    if (chars.length === 0) {
      return null;
    }

    for (let index = clamp(startIndex, 0, chars.length - 1); index < chars.length; index += 1) {
      if (chars[index] !== null) {
        return index;
      }
    }

    for (let index = clamp(startIndex, 0, chars.length - 1) - 1; index >= 0; index -= 1) {
      if (chars[index] !== null) {
        return index;
      }
    }

    return null;
  }

  function ensureProtectedPaletteItems(items: EditableListItem[]) {
    const nextItems = [...items];
    const itemIds = new Set(nextItems.map((item) => item.id));

    for (const palette of palettes) {
      if (PROTECTED_PALETTE_IDS.has(palette.id) && !itemIds.has(palette.id)) {
        nextItems.push({
          id: palette.id,
          name: palette.name,
          protected: true,
        });
      }
    }

    return nextItems;
  }

  function applyPaletteList(items: EditableListItem[]) {
    clearCharPaletteHistory();
    const nextItems = ensureProtectedPaletteItems(getUniqueEditableListItems(items));
    const existingPalettes = new Map(palettes.map((palette) => [palette.id, palette]));
    const previousActivePaletteId = activePaletteId.value;
    const nextPalettes = nextItems.map((item) => {
      const existingPalette = existingPalettes.get(item.id);

      if (existingPalette) {
        existingPalette.name = getEditableListItemName(item.name, existingPalette.name);
        return existingPalette;
      }

      const defaultNormalPalette = defaultNormalPaletteById.get(item.id);

      if (defaultNormalPalette) {
        return {
          ...defaultNormalPalette,
          name: getEditableListItemName(item.name, defaultNormalPalette.name),
          chars: [...defaultNormalPalette.chars],
        };
      }

      return createEmptyNormalPalette(item.id, item.name);
    });

    palettes.splice(0, palettes.length, ...nextPalettes);

    if (!palettes.some((palette) => palette.id === activePaletteId.value)) {
      activePaletteId.value = palettes[0]?.id ?? "";
    }

    if (activePaletteId.value !== previousActivePaletteId) {
      selectedPaletteCellIndex.value = null;
    }

    hasUnsavedDocumentChange.value = true;
  }

  function selectStampSet(stampSetId: string) {
    const stampSet = stampSets.find((candidate) => candidate.id === stampSetId);

    if (!stampSet) {
      return;
    }

    activeStampSetId.value = stampSet.id;
    activeStampId.value = "";
  }

  function applyStampSetList(items: EditableListItem[]) {
    clearStampPaletteHistory();
    const nextItems = getUniqueEditableListItems(items);
    const existingStampSets = new Map(stampSets.map((stampSet) => [stampSet.id, stampSet]));
    const nextStampSets = nextItems.map((item) => {
      const existingStampSet = existingStampSets.get(item.id);

      if (existingStampSet) {
        existingStampSet.name = getEditableListItemName(item.name, existingStampSet.name);
        return existingStampSet;
      }

      const defaultStampSet = defaultStampSetById.get(item.id);

      if (defaultStampSet) {
        return {
          ...defaultStampSet,
          name: getEditableListItemName(item.name, defaultStampSet.name),
          stamps: [...defaultStampSet.stamps],
        };
      }

      return {
        id: item.id,
        name: getEditableListItemName(item.name, "Stamp Set"),
        stamps: [],
      };
    });

    stampSets.splice(0, stampSets.length, ...nextStampSets);

    if (!stampSets.some((stampSet) => stampSet.id === activeStampSetId.value)) {
      activeStampSetId.value = stampSets[0]?.id ?? "";
      activeStampId.value = "";
      hasUnsavedDocumentChange.value = true;
      return;
    }

    if (!activeStampSet.value?.stamps.some((stamp) => stamp.id === activeStampId.value)) {
      activeStampId.value = "";
    }

    hasUnsavedDocumentChange.value = true;
  }

  function selectStamp(stampId: string) {
    const stamp = activeStampSet.value?.stamps.find((candidate) => candidate.id === stampId);

    if (!stamp) {
      return;
    }

    activeStampId.value = stamp.id;
    placeStampAtCenter(stamp);
  }

  function insertStamp() {
    const stampSet = activeStampSet.value;

    if (!stampSet) {
      return;
    }

    const selectedIndex = stampSet.stamps.findIndex((stamp) => stamp.id === activeStampId.value);
    const insertIndex = selectedIndex < 0 ? stampSet.stamps.length : selectedIndex + 1;
    const stampNumber = getNextStampNumber(stampSet);
    const stampId = `${stampSet.id}-${String(stampNumber).padStart(3, "0")}`;
    const stampName = getNextStampName(stampSet, stampNumber);
    const stampKind = activeStamp.value?.kind ?? stampSet.stamps[0]?.kind ?? "mono";
    const highlight = getRectHighlight();
    const stamp = highlight ? createStampFromHighlight(stampKind, stampId, stampName, highlight) : createBlankStamp(stampKind, stampId, stampName);

    recordStampPaletteHistory();
    stampSet.stamps.splice(insertIndex, 0, stamp);
    activeStampSetId.value = stampSet.id;
    activeStampId.value = stamp.id;
    hasUnsavedDocumentChange.value = true;
  }

  function deleteStamp() {
    const stampSet = activeStampSet.value;

    if (!stampSet) {
      return;
    }

    const selectedIndex = stampSet.stamps.findIndex((stamp) => stamp.id === activeStampId.value);

    if (selectedIndex < 0) {
      return;
    }

    recordStampPaletteHistory();
    stampSet.stamps.splice(selectedIndex, 1);
    activeStampId.value = stampSet.stamps[Math.min(selectedIndex, stampSet.stamps.length - 1)]?.id ?? "";
    hasUnsavedDocumentChange.value = true;
  }

  function overwriteStamp(stampId: string) {
    const stampSet = activeStampSet.value;
    const highlight = getRectHighlight();

    if (!stampSet || !highlight) {
      return;
    }

    const stamp = stampSet.stamps.find((candidate) => candidate.id === stampId);

    if (!stamp) {
      return;
    }

    const nextStamp = createStampFromHighlight(stamp.kind, stamp.id, stamp.name, highlight);

    if (areSameStamp(stamp, nextStamp)) {
      activeStampId.value = stamp.id;
      return;
    }

    recordStampPaletteHistory();
    Object.assign(stamp, nextStamp);
    activeStampId.value = stamp.id;
    hasUnsavedDocumentChange.value = true;
  }

  function renameStamp(stampId: string, name: string) {
    const stamp = stampSets.flatMap((stampSet) => stampSet.stamps).find((candidate) => candidate.id === stampId);
    const trimmedName = name.trim();

    if (!stamp || trimmedName === "" || stamp.name === trimmedName) {
      return;
    }

    recordStampPaletteHistory();
    stamp.name = trimmedName;
    hasUnsavedDocumentChange.value = true;
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
      const previousAppearance = getSelectedAppearanceSnapshot();
      const width = getCharWidth(firstChar, widthMode.value);

      setSelectedChar(firstChar, width, true);
      fillSelectionWithChar(firstChar, width);
      notifySelectedAppearanceChange(previousAppearance);
    }
  }

  function handleDocumentContextMenu(event: MouseEvent) {
    if (isBrowserTextFieldTarget(event.target)) {
      return;
    }

    event.preventDefault();
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
    if (event.defaultPrevented) {
      return;
    }

    const key = event.key.toLowerCase();

    if ((event.ctrlKey || event.metaKey) && key === "v") {
      if (isClipboardPasteEditingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void pasteSelectionFromClipboard();
      return;
    }

    if (isTextEditingTarget(event.target)) {
      return;
    }

    if (isDialogTarget(event.target)) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "a") {
      event.preventDefault();
      event.stopPropagation();
      selectAllGrid();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "z") {
      event.preventDefault();

      if (event.shiftKey) {
        if (activePalette.value.kind === "similar") {
          redoSimilarOrDocumentChange();
        } else {
          redoChange();
        }
      } else {
        if (activePalette.value.kind === "similar") {
          undoSimilarOrDocumentChange();
        } else {
          undoChange();
        }
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && key === "y") {
      event.preventDefault();

      if (activePalette.value.kind === "similar") {
        redoSimilarOrDocumentChange();
      } else {
        redoChange();
      }
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
      clearSimilarBitmapHistory();
      palette.query = query;
      updateSimilarBitmapFromQuery(palette);
    }
  }

  function updateSimilarFontFamily(fontFamily: string) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.fontFamily = fontFamily;

      if (getFirstGrapheme(palette.query)) {
        clearSimilarBitmapHistory();
        updateSimilarBitmapFromQuery(palette);
      }
    }
  }

  function updateSimilarCanvasSize(canvasSize: number) {
    const palette = getSimilarPalette();

    if (palette) {
      clearSimilarBitmapHistory();
      palette.canvasSize = canvasSize === 32 ? 32 : 16;
      updateSimilarBitmapFromQuery(palette);
    }
  }

  function updateSimilarThreshold(threshold: number) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.threshold = clamp(threshold, 0, 100);
    }
  }

  function beginSimilarBitmapStroke() {
    const palette = getSimilarPalette();

    if (palette?.isSearching) {
      return;
    }

    recordSimilarBitmapHistory();
  }

  function updateSimilarMaxResults(maxResults: number) {
    const palette = getSimilarPalette();

    if (palette) {
      palette.maxResults = Math.max(1, Math.min(2048, Math.floor(maxResults)));
    }
  }

  function updateSimilarBitmapPixel(index: number, alpha: number) {
    const palette = getSimilarPalette();

    if (!palette || palette.isSearching || index < 0 || index >= palette.targetBitmap.length) {
      return;
    }

    const nextBitmap = [...palette.targetBitmap];
    nextBitmap[index] = clamp(alpha, 0, 255);
    palette.targetBitmap = nextBitmap;
  }

  function paintSimilarBitmapPixel(index: number, brush: SimilarBitmapBrush, erase: boolean) {
    const palette = getSimilarPalette();

    if (!palette || palette.isSearching || index < 0 || index >= palette.targetBitmap.length) {
      return;
    }

    const size = palette.canvasSize;
    const x = index % size;
    const y = Math.floor(index / size);
    const weights = brush === "soft" ? SIMILAR_BITMAP_SOFT_BRUSH : SIMILAR_BITMAP_HARD_BRUSH;
    const nextBitmap = [...palette.targetBitmap];

    weights.forEach((weight) => {
      const targetX = x + weight.dx;
      const targetY = y + weight.dy;

      if (targetX < 0 || targetY < 0 || targetX >= size || targetY >= size) {
        return;
      }

      const targetIndex = targetY * size + targetX;
      const current = nextBitmap[targetIndex] ?? 0;
      nextBitmap[targetIndex] = erase ? clamp(current - weight.alpha, 0, 255) : Math.max(current, weight.alpha);
    });

    palette.targetBitmap = nextBitmap;
  }

  function clearSimilarBitmap() {
    const palette = getSimilarPalette();

    if (!palette || palette.isSearching) {
      return;
    }

    const nextBitmap = createBlankSimilarBitmap(palette.canvasSize);

    if (areSimilarBitmapsEqual(getSimilarBitmapSnapshot(palette), nextBitmap)) {
      return;
    }

    recordSimilarBitmapHistory();
    palette.targetBitmap = nextBitmap;
  }

  function updateSimilarBitmapFromQuery(palette: SimilarPalette) {
    const char = getFirstGrapheme(palette.query);

    palette.targetBitmap = char ? createSimilarGlyphBitmap(char, palette.canvasSize, palette.fontFamily.trim() || SIMILAR_GLYPH_DEFAULT_FONT_FAMILY) : createBlankSimilarBitmap(palette.canvasSize);
  }

  function startSimilarSearch() {
    const palette = getSimilarPalette();

    if (!palette || palette.isSearching) {
      return;
    }

    const queryChar = getFirstGrapheme(palette.query);
    const targetBitmap = getSimilarBitmapSnapshot(palette);
    const hasTargetBitmap = hasSimilarBitmapInk(targetBitmap);
    const shouldUseTargetBitmap = !queryChar && hasTargetBitmap;
    const targetChar = queryChar || (!shouldUseTargetBitmap ? toolState.selectedChar : null);

    palette.results = [];
    palette.checkedPageCount = 0;
    palette.totalPageCount = 0;
    palette.checkedCodePointCount = 0;

    if (!targetChar && !shouldUseTargetBitmap) {
      palette.status = "Input required";
      return;
    }

    if (queryChar) {
      palette.query = queryChar;
    } else if (targetChar) {
      palette.query = targetChar;
    }

    palette.isSearching = true;
    palette.status = "Searching";

    try {
      const handle = startSimilarGlyphSearch(
        {
          pageData: unicodeGlyphPages as UnicodeGlyphPageData,
          targetChar: targetChar ?? "",
          targetBitmap: shouldUseTargetBitmap ? targetBitmap : undefined,
          fontFamily: palette.fontFamily.trim() || SIMILAR_GLYPH_DEFAULT_FONT_FAMILY,
          canvasSize: palette.canvasSize,
          threshold: palette.threshold,
          maxResults: palette.maxResults,
          matchingMethod: palette.matchingMethod,
          matchingParams: cloneSimilarMatchingParams(palette.matchingParams),
          workerCount: getUnicodeGlyphScanWorkerCount(),
          widthMode: widthMode.value,
        },
        {
          onResults(results) {
            palette.results.push(...results);
          },
          onProgress(progress) {
            palette.checkedPageCount = progress.checkedPageCount;
            palette.totalPageCount = progress.totalPageCount;
            palette.checkedCodePointCount = progress.checkedCodePointCount;
            palette.status = progress.phase === "preparing" && progress.checkedPageCount === 0 ? "Preparing" : "Searching";
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

      similarGlyphSearchHandle = handle;
    } catch (error) {
      similarGlyphSearchHandle = null;
      palette.isSearching = false;
      palette.status = error instanceof Error ? error.message : String(error);
    }
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

  function handleCellEnter(x: number, y: number) {
    cursorPosition.value = { x, y };

    if (isDrawing.value) {
      applyDragTool(x, y);
    }
  }

  function handleCellLeave() {
    if (!isDrawing.value) {
      cursorPosition.value = null;
    }
  }

  function handleCellDown(x: number, y: number, event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const textDraftBeforeBlur = textDraft.value;
    blurTextEditingTarget();

    if (textDraftBeforeBlur?.value.length) {
      return;
    }

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
    handleGridContextPickAndFill(x, y, event);
  }

  function handleHighlightContext(x: number, y: number, event: MouseEvent) {
    if (toolState.highlight.kind !== "rect") {
      return;
    }

    event.preventDefault();
    cursorPosition.value = { x, y };
    openSelectionContextMenu(event.clientX, event.clientY);
  }

  function handleGridContextPickAndFill(x: number, y: number, event: MouseEvent) {
    event.preventDefault();
    closeSelectionContextMenu();
    ensurePenToolForGridContextAction();
    toolCursorPosition.value = {
      x: event.clientX,
      y: event.clientY,
    };

    const pickedCell = pickContextChar(x, y);

    if (!pickedCell) {
      return;
    }

    if (toolState.activeTool === "pen") {
      void copyPickedCharToClipboard(pickedCell.char);
    }

    const highlight = getRectHighlight();

    if (!highlight) {
      return;
    }

    if (event.shiftKey) {
      fillEmptySelectionWithChar(pickedCell.char, pickedCell.width);
      return;
    }

    fillSelectionWithChar(pickedCell.char, pickedCell.width);
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

    appendUndoHistoryTarget("document");
    clearRedoHistory();
  }

  function recordCharPaletteHistory() {
    charPaletteUndoStack.value.push(createCharPaletteHistorySnapshot());
    hasUnsavedDocumentChange.value = true;

    if (charPaletteUndoStack.value.length > UNDO_HISTORY_LIMIT) {
      charPaletteUndoStack.value.shift();
    }

    appendUndoHistoryTarget("charPalette");
    clearRedoHistory();
  }

  function recordStampPaletteHistory() {
    stampPaletteUndoStack.value.push(createStampPaletteHistorySnapshot());
    hasUnsavedDocumentChange.value = true;

    if (stampPaletteUndoStack.value.length > UNDO_HISTORY_LIMIT) {
      stampPaletteUndoStack.value.shift();
    }

    appendUndoHistoryTarget("stampPalette");
    clearRedoHistory();
  }

  function recordSimilarBitmapHistory() {
    const palette = getSimilarPalette();

    if (!palette) {
      return;
    }

    similarBitmapUndoStack.value.push(createSimilarBitmapHistorySnapshot(palette));

    if (similarBitmapUndoStack.value.length > UNDO_HISTORY_LIMIT) {
      similarBitmapUndoStack.value.shift();
    }

    appendUndoHistoryTarget("similarBitmap");
    clearRedoHistory();
  }

  function appendUndoHistoryTarget(target: UndoHistoryTarget) {
    undoHistoryOrderStack.value.push(target);

    if (undoHistoryOrderStack.value.length > UNDO_HISTORY_LIMIT) {
      undoHistoryOrderStack.value.shift();
    }
  }

  function appendRedoHistoryTarget(target: UndoHistoryTarget) {
    redoHistoryOrderStack.value.push(target);

    if (redoHistoryOrderStack.value.length > UNDO_HISTORY_LIMIT) {
      redoHistoryOrderStack.value.shift();
    }
  }

  function clearRedoHistory() {
    redoStack.value = [];
    charPaletteRedoStack.value = [];
    stampPaletteRedoStack.value = [];
    similarBitmapRedoStack.value = [];
    redoHistoryOrderStack.value = [];
  }

  function clearDocumentHistory() {
    undoStack.value = [];
    redoStack.value = [];
    removeHistoryOrderTarget("document");
  }

  function removeHistoryOrderTarget(target: UndoHistoryTarget) {
    undoHistoryOrderStack.value = undoHistoryOrderStack.value.filter((entry) => entry !== target);
    redoHistoryOrderStack.value = redoHistoryOrderStack.value.filter((entry) => entry !== target);
  }

  function clearCharPaletteHistory() {
    charPaletteUndoStack.value = [];
    charPaletteRedoStack.value = [];
    removeHistoryOrderTarget("charPalette");
  }

  function clearStampPaletteHistory() {
    stampPaletteUndoStack.value = [];
    stampPaletteRedoStack.value = [];
    removeHistoryOrderTarget("stampPalette");
  }

  function clearSimilarBitmapHistory() {
    similarBitmapUndoStack.value = [];
    similarBitmapRedoStack.value = [];
    removeHistoryOrderTarget("similarBitmap");
  }

  function clearLibraryHistory() {
    clearCharPaletteHistory();
    clearStampPaletteHistory();
  }

  function handleBeforeUnload(event: BeforeUnloadEvent) {
    if (!hasUnsavedDocumentChange.value && !isImageToAsciiArtModalDirty.value) {
      return;
    }

    event.preventDefault();
    event.returnValue = "";
  }

  function setImageToAsciiArtModalDirty(value: boolean) {
    isImageToAsciiArtModalDirty.value = value;
  }

  function undoDocumentChange() {
    const snapshot = undoStack.value.pop();

    if (!snapshot) {
      return false;
    }

    redoStack.value.push(createHistorySnapshot());
    restoreHistorySnapshot(snapshot);
    return true;
  }

  function redoDocumentChange() {
    const snapshot = redoStack.value.pop();

    if (!snapshot) {
      return false;
    }

    undoStack.value.push(createHistorySnapshot());
    restoreHistorySnapshot(snapshot);
    return true;
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

  function undoCharPaletteChange() {
    const snapshot = charPaletteUndoStack.value.pop();

    if (!snapshot) {
      return false;
    }

    charPaletteRedoStack.value.push(createCharPaletteHistorySnapshot());
    restoreCharPaletteHistorySnapshot(snapshot);
    hasUnsavedDocumentChange.value = true;
    return true;
  }

  function redoCharPaletteChange() {
    const snapshot = charPaletteRedoStack.value.pop();

    if (!snapshot) {
      return false;
    }

    charPaletteUndoStack.value.push(createCharPaletteHistorySnapshot());
    restoreCharPaletteHistorySnapshot(snapshot);
    hasUnsavedDocumentChange.value = true;
    return true;
  }

  function undoStampPaletteChange() {
    const snapshot = stampPaletteUndoStack.value.pop();

    if (!snapshot) {
      return false;
    }

    stampPaletteRedoStack.value.push(createStampPaletteHistorySnapshot());
    restoreStampPaletteHistorySnapshot(snapshot);
    hasUnsavedDocumentChange.value = true;
    return true;
  }

  function redoStampPaletteChange() {
    const snapshot = stampPaletteRedoStack.value.pop();

    if (!snapshot) {
      return false;
    }

    stampPaletteUndoStack.value.push(createStampPaletteHistorySnapshot());
    restoreStampPaletteHistorySnapshot(snapshot);
    hasUnsavedDocumentChange.value = true;
    return true;
  }

  function undoSimilarBitmapChange() {
    const palette = getSimilarPalette();
    const snapshot = similarBitmapUndoStack.value.pop();

    if (!palette || !snapshot) {
      return false;
    }

    similarBitmapRedoStack.value.push(createSimilarBitmapHistorySnapshot(palette));
    restoreSimilarBitmapHistorySnapshot(palette, snapshot);
    return true;
  }

  function redoSimilarBitmapChange() {
    const palette = getSimilarPalette();
    const snapshot = similarBitmapRedoStack.value.pop();

    if (!palette || !snapshot) {
      return false;
    }

    similarBitmapUndoStack.value.push(createSimilarBitmapHistorySnapshot(palette));
    restoreSimilarBitmapHistorySnapshot(palette, snapshot);
    return true;
  }

  function undoSimilarOrDocumentChange() {
    undoChange();
  }

  function redoSimilarOrDocumentChange() {
    redoChange();
  }

  function undoChange() {
    while (undoHistoryOrderStack.value.length > 0) {
      const target = undoHistoryOrderStack.value.pop();

      if (target && undoHistoryTargetChange(target)) {
        appendRedoHistoryTarget(target);
        return;
      }
    }
  }

  function redoChange() {
    while (redoHistoryOrderStack.value.length > 0) {
      const target = redoHistoryOrderStack.value.pop();

      if (target && redoHistoryTargetChange(target)) {
        appendUndoHistoryTarget(target);
        return;
      }
    }
  }

  function undoHistoryTargetChange(target: UndoHistoryTarget) {
    switch (target) {
      case "document":
        return undoDocumentChange();
      case "charPalette":
        return undoCharPaletteChange();
      case "stampPalette":
        return undoStampPaletteChange();
      case "similarBitmap":
        return undoSimilarBitmapChange();
    }
  }

  function redoHistoryTargetChange(target: UndoHistoryTarget) {
    switch (target) {
      case "document":
        return redoDocumentChange();
      case "charPalette":
        return redoCharPaletteChange();
      case "stampPalette":
        return redoStampPaletteChange();
      case "similarBitmap":
        return redoSimilarBitmapChange();
    }
  }

  function createCharPaletteHistorySnapshot(): CharPaletteHistorySnapshot {
    return {
      normalPalettes: palettes.filter((palette): palette is NormalPalette => palette.kind === "normal").map(cloneNormalPalette),
      activePaletteId: activePaletteId.value,
      selectedPaletteCellIndex: selectedPaletteCellIndex.value,
    };
  }

  function restoreCharPaletteHistorySnapshot(snapshot: CharPaletteHistorySnapshot) {
    const specialPalettes = palettes.filter((palette) => palette.kind !== "normal");
    palettes.splice(0, palettes.length, ...snapshot.normalPalettes.map(cloneNormalPalette), ...specialPalettes);

    activePaletteId.value = palettes.some((palette) => palette.id === snapshot.activePaletteId) ? snapshot.activePaletteId : (palettes[0]?.id ?? "");

    const palette = activePalette.value;
    selectedPaletteCellIndex.value =
      palette.kind === "normal" && snapshot.selectedPaletteCellIndex !== null && snapshot.selectedPaletteCellIndex >= 0 && snapshot.selectedPaletteCellIndex < palette.chars.length
        ? snapshot.selectedPaletteCellIndex
        : null;
  }

  function createStampPaletteHistorySnapshot(): StampPaletteHistorySnapshot {
    return {
      stampSets: stampSets.map(cloneStampSet),
      activeStampSetId: activeStampSetId.value,
      activeStampId: activeStampId.value,
    };
  }

  function restoreStampPaletteHistorySnapshot(snapshot: StampPaletteHistorySnapshot) {
    stampSets.splice(0, stampSets.length, ...snapshot.stampSets.map(cloneStampSet));
    activeStampSetId.value = stampSets.some((stampSet) => stampSet.id === snapshot.activeStampSetId) ? snapshot.activeStampSetId : (stampSets[0]?.id ?? "");

    const stampSet = activeStampSet.value;
    activeStampId.value = stampSet?.stamps.some((stamp) => stamp.id === snapshot.activeStampId) ? snapshot.activeStampId : "";
  }

  function createSimilarBitmapHistorySnapshot(palette: SimilarPalette): SimilarBitmapHistorySnapshot {
    return {
      targetBitmap: getSimilarBitmapSnapshot(palette),
    };
  }

  function restoreSimilarBitmapHistorySnapshot(palette: SimilarPalette, snapshot: SimilarBitmapHistorySnapshot) {
    const expectedLength = palette.canvasSize * palette.canvasSize;

    if (snapshot.targetBitmap.length !== expectedLength) {
      return;
    }

    palette.targetBitmap = snapshot.targetBitmap.map((alpha) => clamp(alpha, 0, 255));
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
        const width = isBlank ? getCharWidth(grapheme, widthMode.value) : getCharWidth(char, widthMode.value);

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

  function pickChar(x: number, y: number, clearOnEmpty = false) {
    return pickCharAt(x, y, clearOnEmpty);
  }

  function pickCharAt(x: number, y: number, clearOnEmpty = false) {
    const activeLayer = getEditableActiveLayer();
    const cell = activeLayer ? getHeadCell(activeLayer, x, y) : null;

    if (!cell) {
      if (clearOnEmpty) {
        setSelectedChar(null, 1, false);
        toolState.selectedBGC = null;
      }
      return null;
    }

    return applyPickedCell(cell);
  }

  function pickContextChar(x: number, y: number) {
    const highlight = getRectHighlight();

    if (highlight && isPointInHighlight(x, y)) {
      const highlightedCell = getHeadCell({ cells: highlight.contents } as Layer, x - highlight.x, y - highlight.y);

      if (highlightedCell) {
        return applyPickedCell(highlightedCell);
      }

      return applyPickedBlankCell();
    }

    return pickCharAt(x, y, false) ?? applyPickedBlankCell();
  }

  function applyPickedCell(cell: Extract<Cell, { kind: "char" }>) {
    const previousAppearance = getSelectedAppearanceSnapshot();

    setSelectedChar(cell.char, cell.width, true);
    toolState.selectedFGC = cell.fgc;
    toolState.selectedBGC = cell.bgc;

    notifySelectedAppearanceChange(previousAppearance);
    return cell;
  }

  function applyPickedBlankCell() {
    return applyPickedCell({
      kind: "char",
      char: NBSP,
      width: 1,
      fgc: getForegroundDefaultColor(),
      bgc: null,
    });
  }

  function ensurePenToolForGridContextAction() {
    if (toolState.activeTool !== "pen" && toolState.activeTool !== "select") {
      selectTool("pen");
    }
  }

  async function copyPickedCharToClipboard(char: string) {
    if (!navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(char);
    } catch {
      // 右クリックの選択動作自体は成功させる。
    }
  }

  function getSelectedAppearanceSnapshot(): SelectedAppearanceSnapshot {
    return {
      char: toolState.selectedChar,
      width: toolState.selectedCharWidth,
      fgc: toolState.selectedFGC,
      bgc: toolState.selectedBGC ?? documentModel.canvasBGC,
    };
  }

  function hasSelectedAppearanceChanged(previous: SelectedAppearanceSnapshot) {
    return (
      previous.char !== toolState.selectedChar ||
      previous.width !== toolState.selectedCharWidth ||
      previous.fgc !== toolState.selectedFGC ||
      previous.bgc !== (toolState.selectedBGC ?? documentModel.canvasBGC)
    );
  }

  function notifySelectedAppearanceChange(previousAppearance: SelectedAppearanceSnapshot) {
    if (!hasSelectedAppearanceChanged(previousAppearance)) {
      return;
    }

    triggerSelectedCharAttention();
    showToolCursorSelectedAppearancePreview();
  }

  function triggerSelectedCharAttention() {
    selectedCharAttentionKey.value += 1;
  }

  function showToolCursorSelectedAppearancePreview() {
    if (!toolCursorPosition.value || toolState.selectedChar === null) {
      return;
    }

    clearToolCursorCellPreview();
    toolCursorCellPreview.value = {
      char: toolState.selectedChar,
      fgc: toolState.selectedFGC,
      bgc: toolState.selectedBGC ?? documentModel.canvasBGC,
    };
    toolCursorCellPreviewTimer = window.setTimeout(clearToolCursorCellPreview, 1000);
  }

  function clearToolCursorCellPreview() {
    if (toolCursorCellPreviewTimer !== null) {
      window.clearTimeout(toolCursorCellPreviewTimer);
      toolCursorCellPreviewTimer = null;
    }

    toolCursorCellPreview.value = null;
  }

  function setSelectedChar(char: string | null, width: 1 | 2, shouldUpdateHistory: boolean) {
    toolState.selectedChar = char;
    toolState.selectedCharWidth = width;

    if (shouldUpdateHistory && char !== null && char !== NBSP) {
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

  function getCellGlyphClass(x: number, y: number) {
    const compositedCell = compositedGrid.value[y][x];

    if (compositedCell.kind !== "char") {
      return [];
    }

    return getGlyphClass(compositedCell.char, compositedCell.width);
  }

  function getGlyphClass(char: string, width: 1 | 2) {
    if (width !== 1 || !shouldFitWideGlyphIntoNarrowCell(char, widthMode.value)) {
      return [];
    }

    return ["is-terminal-narrow-wide-glyph"];
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
          glyphClassName: getGlyphClass(cell.char, cell.width),
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
      width += grapheme === " " ? 1 : getCharWidth(grapheme, widthMode.value);
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
        const width = getCharWidth(char, widthMode.value);

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

  function applyImageToAsciiGrid(cells: ImageToAsciiApplyGrid) {
    const layer = getEditableActiveLayer();

    if (!layer) {
      return false;
    }

    recordDocumentHistory();
    clearLayerRect(layer, 0, 0, GRID_COLUMNS, GRID_ROWS);

    cells.forEach((row, y) => {
      row.forEach((cell, x) => {
        if (!cell || cell.char === " " || x >= GRID_COLUMNS || y >= GRID_ROWS) {
          return;
        }

        placeChar(layer, x, y, cell.char, toolState.selectedFGC, null, cell.width);
      });
    });

    return true;
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

  function createBlankStamp(kind: Stamp["kind"], id: string, name: string): Stamp {
    return {
      kind,
      id,
      name,
      width: 1,
      height: 1,
      cells: [[null]],
    };
  }

  function createStampFromHighlight(kind: Stamp["kind"], id: string, name: string, highlight: HighlightRect): Stamp {
    const cells = createEmptyStampCells(highlight.width, highlight.height);

    highlight.contents.forEach((row, rowIndex) => {
      row.forEach((cell, columnIndex) => {
        if (cell.kind !== "char") {
          return;
        }

        cells[rowIndex][columnIndex] = {
          char: cell.char,
          width: cell.width,
          fgc: cell.fgc,
          bgc: cell.bgc,
        };
      });
    });

    return {
      kind,
      id,
      name,
      width: highlight.width,
      height: highlight.height,
      cells,
    };
  }

  function createEmptyStampCells(width: number, height: number): (StampCell | null)[][] {
    return Array.from({ length: height }, () => Array.from({ length: width }, () => null as StampCell | null));
  }

  function areSameStamp(previousStamp: Stamp, nextStamp: Stamp) {
    return JSON.stringify(previousStamp) === JSON.stringify(nextStamp);
  }

  function getNextStampNumber(stampSet: StampSet) {
    const numbers = stampSet.stamps
      .map((stamp) => {
        const match = stamp.id.match(/-(\d+)$/);

        return match ? Number.parseInt(match[1], 10) : null;
      })
      .filter((value): value is number => value !== null && Number.isFinite(value));

    return (numbers.length ? Math.max(...numbers) : 0) + 1;
  }

  function getNextStampName(stampSet: StampSet, number: number) {
    const baseName = stampSet.name.trim() || "Stamp";
    return `${baseName} ${String(number).padStart(3, "0")}`;
  }

  return {
    activePalette,
    activePaletteId,
    language,
    selectedPaletteCellIndex,
    activeStamp,
    activeStampId,
    activeStampSet,
    activeStampSetId,
    colorPickerAllowsNone,
    colorPickerInitialColor,
    cursorStyle,
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
    selectedCharAttentionKey,
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
    widthMode,
    getCellClass,
    getCellGlyphClass,
    getCellStyle,
    getCellText,
    handleCellContext,
    handleCellDown,
    handleCellEnter,
    handleCellLeave,
    handleCellUp,
    handleGridMeasureDown,
    handleGridWheel,
    handleHighlightContext,
    handleHighlightMove,
    handleKeyboardInput,
    invertCanvasBackground,
    setCanvasColor,
    setLanguage,
    setWidthMode,
    addLayer,
    clearSelectionColors,
    closeSelectionContextMenu,
    deleteActiveLayer,
    exportDocument,
    moveLayer,
    renameLayer,
    saveDocument,
    saveLibrary,
    scanAllUnicodeGlyphPages,
    selectPalette,
    selectPaletteChar,
    selectPaletteCell,
    insertPaletteCell,
    deletePaletteCell,
    overwritePaletteCell,
    insertStamp,
    deleteStamp,
    overwriteStamp,
    renameStamp,
    applyPaletteList,
    applyStampSetList,
    applyImageToAsciiGrid,
    setImageToAsciiArtModalDirty,
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
    loadLibrary,
    stopDrawing,
    updateTextEditorValue,
    toggleLayerLocked,
    toggleLayerVisible,
    cancelSimilarSearch,
    startSimilarSearch,
    beginSimilarBitmapStroke,
    clearSimilarBitmap,
    paintSimilarBitmapPixel,
    updateSimilarBitmapPixel,
    updateSimilarCanvasSize,
    updateSimilarFontFamily,
    updateSimilarMaxResults,
    updateSimilarQuery,
    updateSimilarThreshold,
    updateUnicodeQuery,
    updateUnicodeScrollOffset,
    toolCursorOverlay,
  };
}

function createBlankSimilarBitmap(canvasSize: 16 | 32) {
  return Array.from({ length: canvasSize * canvasSize }, () => 0);
}

function cloneSimilarMatchingParams(params: SimilarGlyphSearchMatchingParams) {
  return JSON.parse(JSON.stringify(params)) as SimilarGlyphSearchMatchingParams;
}

function getSimilarBitmapSnapshot(palette: SimilarPalette) {
  const expectedLength = palette.canvasSize * palette.canvasSize;

  if (!Array.isArray(palette.targetBitmap) || palette.targetBitmap.length !== expectedLength) {
    return createBlankSimilarBitmap(palette.canvasSize);
  }

  return palette.targetBitmap.map((alpha) => {
    const value = Number(alpha);
    return Number.isFinite(value) ? clamp(value, 0, 255) : 0;
  });
}

function hasSimilarBitmapInk(bitmap: number[] | undefined) {
  return Array.isArray(bitmap) && bitmap.some((alpha) => alpha > 12);
}

function areSimilarBitmapsEqual(left: number[], right: number[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function createSimilarGlyphBitmap(char: string, canvasSize: 16 | 32, fontFamily: string) {
  if (typeof document === "undefined") {
    return createBlankSimilarBitmap(canvasSize);
  }

  const sourceSize = canvasSize * 3;
  const sourceCanvas = document.createElement("canvas");
  const normalizedCanvas = document.createElement("canvas");

  sourceCanvas.width = sourceSize;
  sourceCanvas.height = sourceSize;
  normalizedCanvas.width = canvasSize;
  normalizedCanvas.height = canvasSize;

  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const normalizedContext = normalizedCanvas.getContext("2d", { willReadFrequently: true });

  if (!sourceContext || !normalizedContext) {
    return createBlankSimilarBitmap(canvasSize);
  }

  const fontSize = Math.floor(sourceSize * 0.58);
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  sourceContext.fillStyle = "#000000";
  sourceContext.font = `${fontSize}px ${fontFamily}`;
  sourceContext.clearRect(0, 0, sourceSize, sourceSize);
  sourceContext.fillText(char, sourceSize / 2, sourceSize / 2);

  const sourceImage = sourceContext.getImageData(0, 0, sourceSize, sourceSize);
  const bounds = getSimilarBitmapInkBounds(sourceImage.data, sourceSize);

  if (!bounds) {
    return createBlankSimilarBitmap(canvasSize);
  }

  normalizedContext.clearRect(0, 0, canvasSize, canvasSize);
  normalizedContext.imageSmoothingEnabled = true;
  normalizedContext.imageSmoothingQuality = "high";
  const targetRect = getAspectFitRect(bounds.width, bounds.height, canvasSize);
  normalizedContext.drawImage(
    sourceCanvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height,
  );

  const normalizedData = normalizedContext.getImageData(0, 0, canvasSize, canvasSize).data;
  return Array.from({ length: canvasSize * canvasSize }, (_, index) => normalizedData[index * 4 + 3]);
}

function getSimilarBitmapInkBounds(data: Uint8ClampedArray, size: number) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = data[(y * size + x) * 4 + 3];

      if (alpha <= 12) {
        continue;
      }

      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function getAspectFitRect(sourceWidth: number, sourceHeight: number, canvasSize: number) {
  const maxSize = Math.max(1, canvasSize - 2);
  const scale = Math.min(maxSize / Math.max(1, sourceWidth), maxSize / Math.max(1, sourceHeight));
  const width = Math.max(1, sourceWidth * scale);
  const height = Math.max(1, sourceHeight * scale);

  return {
    x: (canvasSize - width) / 2,
    y: (canvasSize - height) / 2,
    width,
    height,
  };
}

function cloneDocument(documentValue: AaDocument): AaDocument {
  return JSON.parse(JSON.stringify(documentValue)) as AaDocument;
}

function cloneHighlight(highlight: Highlight): Highlight {
  return JSON.parse(JSON.stringify(highlight)) as Highlight;
}

function createEditableListSnapshot(items: { id: string; name: string }[]): EditableListItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
  }));
}

function getUniqueEditableListItems(items: EditableListItem[]) {
  const seenIds = new Set<string>();
  const uniqueItems: EditableListItem[] = [];

  for (const item of items) {
    const id = item.id.trim();

    if (!id || seenIds.has(id)) {
      continue;
    }

    uniqueItems.push({
      id,
      name: item.name.trim(),
      protected: item.protected,
    });
    seenIds.add(id);
  }

  return uniqueItems;
}

function getEditableListItemName(name: string, fallback: string) {
  return name.trim() || fallback;
}

function createEmptyNormalPalette(id: string, name: string): NormalPalette {
  return {
    kind: "normal",
    id,
    name: getEditableListItemName(name, "Palette"),
    columns: 16,
    chars: Array.from({ length: EMPTY_NORMAL_PALETTE_CELL_COUNT }, () => null),
  };
}

function expandLibraryPaletteChars(rows: string[]) {
  const chars: (string | null)[] = [];

  for (const row of rows) {
    chars.push(...Array.from(row));
  }

  return chars;
}

function createLibraryPaletteSnapshot(palette: NormalPalette): LibraryCharPalette {
  return {
    id: palette.id,
    name: palette.name,
    ...(palette.columns === undefined ? {} : { columns: palette.columns }),
    ...(palette.startCode === undefined ? {} : { startCode: palette.startCode }),
    chars: [...palette.chars],
  };
}

function createNormalPaletteFromLibrary(palette: LibraryCharPalette): NormalPalette {
  return {
    kind: "normal",
    id: palette.id,
    name: getEditableListItemName(palette.name, "Palette"),
    ...(palette.columns === undefined ? {} : { columns: palette.columns }),
    ...(palette.startCode === undefined ? {} : { startCode: palette.startCode }),
    chars: [...palette.chars],
  };
}

function createStampFileById(stampSets: StampSet[], currentFileById: Map<string, string>) {
  const usedFiles = new Set<string>();
  const fileById = new Map<string, string>();

  for (const stampSet of stampSets) {
    const preferredFile = currentFileById.get(stampSet.id) ?? stampSet.name;
    const file = createUniqueStampFilename(preferredFile, usedFiles);

    fileById.set(stampSet.id, file);
  }

  return fileById;
}

function createUniqueStampFilename(value: string, usedFiles: Set<string>) {
  const baseName = toSafeLibraryBaseName(value.replace(/\.mds$/i, ""));
  let file = `${baseName}.mds`;
  let index = 2;

  while (usedFiles.has(file)) {
    file = `${baseName}-${index}.mds`;
    index += 1;
  }

  usedFiles.add(file);
  return file;
}

function toSafeLibraryBaseName(value: string) {
  return (
    value
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\.+$/g, "")
      .replace(/^-+|-+$/g, "") || "stamp-set"
  );
}

function cloneNormalPalette(palette: NormalPalette): NormalPalette {
  return {
    ...palette,
    chars: [...palette.chars],
  };
}

function cloneStampSet(stampSet: StampSet): StampSet {
  return {
    id: stampSet.id,
    name: stampSet.name,
    stamps: cloneStamps(stampSet.stamps),
  };
}

function cloneStamps(stamps: Stamp[]): Stamp[] {
  return JSON.parse(JSON.stringify(stamps)) as Stamp[];
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
  return grid.map((row) => trimExportRow(row).filter(isExportContentCell).map((cell) => normalizeExportText(cell.char)).join("")).join("\n");
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

        return `${prefix}${normalizeExportText(cell.char)}`;
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
        const isEmptyCanvasCell = cell.sourceLayerId === null && cell.char === " ";
        const nextFGC = isEmptyCanvasCell ? null : cell.sourceLayerId === null ? currentFGC : cell.fgc;
        const nextBGC = isEmptyCanvasCell ? null : cell.sourceLayerId === null ? currentBGC : cell.bgc;

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

        return `${prefix}${escapeMdsText(normalizeExportText(cell.char))}`;
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
    const text = escapeHtmlText(normalizeExportText(cell.char));

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

function normalizeExportText(value: string) {
  return value.replaceAll(NBSP, " ");
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
  downloadBlob(filename, new Blob([content], { type: `${mimeType};charset=utf-8` }));
}

function downloadBlob(filename: string, blob: Blob) {
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

function normalizeLoadedAaMakerState(value: unknown): AaDocument | null {
  const legacyDocument = normalizeLoadedDocument(value);

  if (legacyDocument) {
    return legacyDocument;
  }

  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) {
    return null;
  }

  if (!isRecord(value.document)) {
    return null;
  }

  return normalizeLoadedDocument(value.document);
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

function isClipboardPasteEditingTarget(target: EventTarget | null) {
  if (document.querySelector('[role="dialog"]')) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

function isBrowserTextFieldTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

function isDialogTarget(target: EventTarget | null) {
  return document.querySelector('[role="dialog"]') !== null || (target instanceof HTMLElement && target.closest('[role="dialog"]') !== null);
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
  if (typeof localStorage === "undefined") {
    return {
      history: createEmptyHistoryChars(),
    };
  }

  try {
    const rawValue = localStorage.getItem(HISTORY_STORAGE_KEY);

    if (!rawValue) {
      return {
        history: createEmptyHistoryChars(),
      };
    }

    const parsedValue = JSON.parse(rawValue) as StoredHistoryPalette;

    return {
      history: normalizeHistoryChars(parsedValue.history, createEmptyHistoryChars()),
    };
  } catch {
    return {
      history: createEmptyHistoryChars(),
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
    }),
  );
}

function createEmptyHistoryChars() {
  return Array.from({ length: HISTORY_CELL_COUNT }, () => null);
}

function normalizeHistoryChars(value: unknown, fallback: (string | null)[]) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return Array.from({ length: HISTORY_CELL_COUNT }, (_, index) => (typeof value[index] === "string" ? value[index] : null));
}

function createStampSets(sourceStamps: Stamp[]): StampSet[] {
  const groupedStamps = new Map<string, Stamp[]>();
  const stampSetNameById = new Map(stampLibraryItems.map((item) => [item.id, item.name]));

  for (const stamp of sourceStamps) {
    const stampSetId = stamp.id.replace(/-\d+$/, "");
    const stampSet = groupedStamps.get(stampSetId) ?? [];
    stampSet.push(stamp);
    groupedStamps.set(stampSetId, stampSet);
  }

  return Array.from(groupedStamps, ([id, items]) => ({
    id,
    name: stampSetNameById.get(id) ?? id,
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
