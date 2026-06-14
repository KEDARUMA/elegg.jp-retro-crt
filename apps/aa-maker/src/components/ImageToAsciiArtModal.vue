<script setup lang="ts">
import ConfirmModal from "./ConfirmModal.vue";
import { computed, onBeforeUnmount, onMounted, reactive, ref, toRaw, watch } from "vue";
import settingsIcon from "../assets/icons/settings.svg?raw";
import unicodeGlyphPages from "../data/static/unicode-glyph-pages.json";
import type { WidthMode } from "../model/widthMode";
import { clamp } from "../utils/clamp";
import {
  DEFAULT_IMAGE_TO_ASCII_MATCHING_PARAMS,
  preloadImageToAsciiMatchingLibrary,
  startImageToAsciiGlyphCacheBuild,
  startImageToAsciiMatching,
} from "../search/imageToAsciiMatching";
import type {
  ImageToAsciiApplyGrid,
  ImageToAsciiCellUpdate,
  ImageToAsciiGlyphCacheSummary,
  ImageToAsciiGlyphPolarity,
  ImageToAsciiMatchingLibraryName,
  ImageToAsciiMatchingMethod,
  ImageToAsciiMatchingParams,
  ImageToAsciiMatchHandle,
  ImageToAsciiMatchProgress,
  ImageToAsciiMatchResult,
  ImageToAsciiProcessingCell,
} from "../search/imageToAsciiMatching";
import type { UnicodeGlyphPageData } from "../search/similarGlyphSearch";

const props = defineProps<{
  widthMode: WidthMode;
}>();

const emit = defineEmits<{
  close: [];
  apply: [cells: ImageToAsciiApplyGrid];
  "dirty-change": [isDirty: boolean];
  toast: [toast: { kind: "success" | "error"; message: string }];
}>();

const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 400;
const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const SCALE_MIN = 0.1;
const SCALE_MAX = 4;
const ROTATION_MIN = -180;
const ROTATION_MAX = 180;
const DEFAULT_GLYPH_POLARITY: ImageToAsciiGlyphPolarity = "white-on-black";
const DEFAULT_MATCHING_METHOD: ImageToAsciiMatchingMethod = "pixel";
const PROCESSING_CELL_SWATCHES = [
  {
    borderColor: "rgba(102, 226, 255, 0.96)",
    backgroundColor: "rgba(102, 226, 255, 0.08)",
    shadowColor: "rgba(102, 226, 255, 0.72)",
  },
  {
    borderColor: "rgba(130, 231, 156, 0.96)",
    backgroundColor: "rgba(130, 231, 156, 0.08)",
    shadowColor: "rgba(130, 231, 156, 0.72)",
  },
  {
    borderColor: "rgba(255, 199, 102, 0.96)",
    backgroundColor: "rgba(255, 199, 102, 0.08)",
    shadowColor: "rgba(255, 199, 102, 0.72)",
  },
  {
    borderColor: "rgba(255, 138, 138, 0.96)",
    backgroundColor: "rgba(255, 138, 138, 0.08)",
    shadowColor: "rgba(255, 138, 138, 0.72)",
  },
  {
    borderColor: "rgba(134, 176, 255, 0.96)",
    backgroundColor: "rgba(134, 176, 255, 0.08)",
    shadowColor: "rgba(134, 176, 255, 0.72)",
  },
  {
    borderColor: "rgba(130, 226, 202, 0.96)",
    backgroundColor: "rgba(130, 226, 202, 0.08)",
    shadowColor: "rgba(130, 226, 202, 0.72)",
  },
] as const;

type EdgeMode = "Off" | "Sobel" | "Canny-like" | "Laplacian";
type GlyphPolaritySetting = ImageToAsciiGlyphPolarity | "auto";
type WidthModeSetting = WidthMode | "auto";
type StageMatchCell = {
  x: number;
  y: number;
  char: string;
  width: 1 | 2;
  score: number;
};
type ProcessingCellState = ImageToAsciiProcessingCell & {
  workerIndex: number;
};
type ImageToAsciiModalSnapshot = {
  hasSourceImage: boolean;
  transform: {
    scale: number;
    rotation: number;
    x: number;
    y: number;
  };
  contrast: number;
  isMonochromeEnabled: boolean;
  isInverted: boolean;
  edgeMode: EdgeMode;
  sobelThreshold: number;
  laplacianThreshold: number;
  cannyBlur: number;
  cannyLowThreshold: number;
  cannyHighThreshold: number;
  differenceThreshold: number;
  isFullWidthMatchingEnabled: boolean;
  matchingMethod: ImageToAsciiMatchingMethod;
  matchingParams: ImageToAsciiMatchingParams;
  matchingWidthMode: WidthModeSetting;
  glyphPolarity: GlyphPolaritySetting;
  isColorEmojiExcluded: boolean;
  matchFontFamily: string;
};

const fileInputRef = ref<HTMLInputElement | null>(null);
const stageRef = ref<HTMLDivElement | null>(null);
const sourceImageUrl = ref<string | null>(null);
const processedImageUrl = ref<string | null>(null);
const sourceFileName = ref("");
const sourceNaturalWidth = ref(0);
const sourceNaturalHeight = ref(0);
const loadError = ref("");
const isDragOver = ref(false);
const activeDrag = ref<{
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
} | null>(null);

const transform = reactive({
  scale: 1,
  rotation: 0,
  x: 0,
  y: 0,
});

const contrast = ref(100);
const isMonochromeEnabled = ref(true);
const isInverted = ref(false);
const isGridVisible = ref(true);
const isFullWidthMatchingEnabled = ref(true);
const isMatchingSettingsOpen = ref(false);
const edgeMode = ref<EdgeMode>("Off");
const sobelThreshold = ref(48);
const laplacianThreshold = ref(32);
const cannyBlur = ref(1);
const cannyLowThreshold = ref(32);
const cannyHighThreshold = ref(96);
const differenceThreshold = ref(18);
const workerSetting = ref("Auto");
const matchingMethod = ref<ImageToAsciiMatchingMethod>(DEFAULT_MATCHING_METHOD);
const matchingParams = reactive<ImageToAsciiMatchingParams>(cloneMatchingParams(DEFAULT_IMAGE_TO_ASCII_MATCHING_PARAMS));
const matchResult = ref<ImageToAsciiMatchResult | null>(null);
const matchProgress = ref<ImageToAsciiMatchProgress | null>(null);
const matchStatus = ref("Load image to match");
const isMatching = ref(false);
const isBuildingGlyphCache = ref(false);
const glyphCacheProgress = ref<ImageToAsciiMatchProgress | null>(null);
const glyphCacheStatus = ref("Glyph cache not built");
const glyphCacheSummary = ref<ImageToAsciiGlyphCacheSummary | null>(null);
const matchFontFamily = ref("");
const matchingWidthMode = ref<WidthModeSetting>("auto");
const glyphPolarity = ref<GlyphPolaritySetting>("auto");
const isColorEmojiExcluded = ref(true);
const resolvedGlyphPolarity = ref<ImageToAsciiGlyphPolarity>(DEFAULT_GLYPH_POLARITY);
const autoDetectedGlyphPolarity = ref<ImageToAsciiGlyphPolarity | null>(null);
const detectedPreviewPolarity = ref<ImageToAsciiGlyphPolarity>(DEFAULT_GLYPH_POLARITY);
const isCloseConfirmOpen = ref(false);
const isApplyingImageMutation = ref(false);
const halfMatchCells = ref<(StageMatchCell | null)[]>(createEmptyStageCells());
const fullMatchCells = ref<(StageMatchCell | null)[]>(createEmptyStageCells());
const processingCells = ref<ProcessingCellState[]>([]);
let matchHandle: ImageToAsciiMatchHandle | null = null;
let glyphCacheBuildHandle: ImageToAsciiMatchHandle | null = null;
let matchingLibraryPreloadHandle: ImageToAsciiMatchHandle | null = null;
let matchRequestToken = 0;
let glyphCacheBuildToken = 0;
let matchingLibraryPreloadToken = 0;
let detectedPreviewToken = 0;
const processingCellDrafts = new Map<number, ImageToAsciiProcessingCell>();
let processingCellFrameHandle: number | null = null;

const statusText = computed(() => {
  if (loadError.value) {
    return loadError.value;
  }

  if (isMatching.value) {
    return `Matching: ${matchStatus.value}`;
  }

  if (sourceImageUrl.value) {
    return matchStatus.value
      ? `Loaded: ${sourceFileName.value} (${sourceNaturalWidth.value}x${sourceNaturalHeight.value}). ${matchStatus.value}`
      : `Loaded: ${sourceFileName.value} (${sourceNaturalWidth.value}x${sourceNaturalHeight.value})`;
  }

  return "Drop image anywhere in this modal.";
});

const scaleText = computed(() => formatScale(transform.scale));
const rotationText = computed(() => String(Math.round(transform.rotation)));
const positionXText = computed(() => String(Math.round(transform.x)));
const positionYText = computed(() => String(Math.round(transform.y)));

const sourceImageStyle = computed<Record<string, string>>(() => ({
  "--source-image-x": `${(transform.x / TARGET_WIDTH) * 100}%`,
  "--source-image-y": `${(transform.y / TARGET_HEIGHT) * 100}%`,
  "--source-image-width": `${sourceNaturalWidth.value > 0 ? (sourceNaturalWidth.value / TARGET_WIDTH) * 100 : 100}%`,
  "--source-image-scale": String(transform.scale),
  "--source-image-rotation": `${transform.rotation}deg`,
  "--source-image-filter": [
    isMonochromeEnabled.value ? "grayscale(1)" : "",
    `contrast(${contrast.value}%)`,
    isInverted.value ? "invert(1)" : "",
  ]
    .filter(Boolean)
    .join(" "),
}));
const gridOverlayStyle = computed<Record<string, string>>(() => {
  if (detectedPreviewPolarity.value === "black-on-white") {
    return {
      "--image-grid-minor-color": "rgba(0, 0, 0, 0.2)",
      "--image-grid-major-color": "rgba(0, 0, 0, 0.42)",
    };
  }

  return {
    "--image-grid-minor-color": "rgba(255, 255, 255, 0.34)",
    "--image-grid-major-color": "rgba(255, 255, 255, 0.78)",
  };
});

const edgeStatusText = computed(() => {
  if (processedImageUrl.value) {
    return `${edgeMode.value} edge applied`;
  }

  return "";
});
const visibleHalfMatchCells = computed(() => halfMatchCells.value.filter(isStageMatchCell));
const visibleFullMatchCells = computed(() => fullMatchCells.value.filter(isStageMatchCell));
const effectiveMatchFontFamily = computed(() => matchFontFamily.value.trim() || getMatchFontFamilyFromCss());
const effectiveMatchingWidthMode = computed<WidthMode>(() => (matchingWidthMode.value === "auto" ? props.widthMode : matchingWidthMode.value));
const displayGlyphPolarity = computed<ImageToAsciiGlyphPolarity>(() =>
  glyphPolarity.value === "auto" ? resolvedGlyphPolarity.value : glyphPolarity.value,
);
const autoDetectionText = computed(() => {
  if (glyphPolarity.value !== "auto") {
    return `Manual selected: ${getGlyphPolarityLabel(glyphPolarity.value)}`;
  }

  if (!autoDetectedGlyphPolarity.value) {
    return "Auto detected: Not available";
  }

  return `Auto detected: ${getGlyphPolarityLabel(autoDetectedGlyphPolarity.value)}`;
});
const glyphProgress = computed(() => {
  if (isBuildingGlyphCache.value) {
    return glyphCacheProgress.value;
  }

  if (isMatching.value && matchProgress.value && isGlyphPreparationPhase(matchProgress.value.phase)) {
    return matchProgress.value;
  }

  return null;
});
const glyphProgressPercent = computed(() => {
  const progress = glyphProgress.value;

  if (!progress || progress.totalCodePointCount <= 0) {
    return 0;
  }

  return Math.round((progress.checkedCodePointCount / progress.totalCodePointCount) * 100);
});
const glyphProgressTitle = computed(() => (isBuildingGlyphCache.value ? "Building Glyph Cache" : "Preparing Glyph Cache"));
const glyphProgressDetail = computed(() => {
  const progress = glyphProgress.value;

  if (!progress) {
    return "";
  }

  if (progress.phase === "load-library") {
    return "Loading matching library";
  }

  if (progress.phase === "load-cache") {
    return "Loading persisted glyph cache";
  }

  if (progress.phase === "save-cache") {
    return "Saving glyph cache";
  }

  return `Indexing glyphs ${progress.checkedCodePointCount}/${progress.totalCodePointCount}`;
});
const matchProgressText = computed(() => {
  if (isMatching.value && matchProgress.value) {
    const progress = matchProgress.value;

    if (progress.phase === "load-library") {
      return "Loading matching library";
    }

    if (progress.phase === "load-cache") {
      return "Loading glyph cache";
    }

    if (progress.phase === "save-cache") {
      return "Saving glyph cache";
    }

    if (isGlyphPreparationPhase(progress.phase)) {
      return `Indexing glyphs ${progress.checkedCodePointCount}/${progress.totalCodePointCount}`;
    }

    return `${progress.phase === "match-half" ? "Half" : "Full"} matching ${progress.matchedCellCount}/${progress.totalCellCount}`;
  }

  if (matchResult.value) {
    return `Done. Half ${matchResult.value.matchedHalfCount}, Full ${matchResult.value.matchedFullCount}, Avg ${matchResult.value.averageScore}`;
  }

  return matchStatus.value;
});
const canApplyMatch = computed(() => Boolean(matchResult.value) && !isMatching.value);
const canBuildGlyphCache = computed(() => !isBuildingGlyphCache.value && !isMatching.value);
const resolvedWorkerCount = computed(() => resolveWorkerCount(workerSetting.value));
const canRunMatching = computed(() => Boolean(sourceImageUrl.value) && !isBuildingGlyphCache.value);
const isImageMutationLocked = computed(() => isMatching.value || isApplyingImageMutation.value);
const canSaveProcessedImage = computed(() => Boolean(sourceImageUrl.value) && !isImageMutationLocked.value);
const hasMatchOverlay = computed(
  () => isMatching.value || matchResult.value !== null || processingCells.value.length > 0 || hasPlacedMatchCells(),
);
const initialImageToAsciiModalSnapshotSignature = JSON.stringify(captureImageToAsciiModalSnapshot());
const isImageToAsciiModalDirty = computed(
  () =>
    JSON.stringify(captureImageToAsciiModalSnapshot()) !== initialImageToAsciiModalSnapshotSignature ||
    isMatching.value ||
    isBuildingGlyphCache.value ||
    isApplyingImageMutation.value,
);

watch(
  isImageToAsciiModalDirty,
  (isDirty) => {
    emit("dirty-change", isDirty);
  },
  { immediate: true },
);

function cloneMatchingParams(params: ImageToAsciiMatchingParams): ImageToAsciiMatchingParams {
  return JSON.parse(JSON.stringify(params)) as ImageToAsciiMatchingParams;
}

function captureImageToAsciiModalSnapshot(): ImageToAsciiModalSnapshot {
  return {
    hasSourceImage: Boolean(sourceImageUrl.value),
    transform: {
      scale: transform.scale,
      rotation: transform.rotation,
      x: transform.x,
      y: transform.y,
    },
    contrast: contrast.value,
    isMonochromeEnabled: isMonochromeEnabled.value,
    isInverted: isInverted.value,
    edgeMode: edgeMode.value,
    sobelThreshold: sobelThreshold.value,
    laplacianThreshold: laplacianThreshold.value,
    cannyBlur: cannyBlur.value,
    cannyLowThreshold: cannyLowThreshold.value,
    cannyHighThreshold: cannyHighThreshold.value,
    differenceThreshold: differenceThreshold.value,
    isFullWidthMatchingEnabled: isFullWidthMatchingEnabled.value,
    matchingMethod: matchingMethod.value,
    matchingParams: cloneMatchingParams(toRaw(matchingParams)),
    matchingWidthMode: matchingWidthMode.value,
    glyphPolarity: glyphPolarity.value,
    isColorEmojiExcluded: isColorEmojiExcluded.value,
    matchFontFamily: matchFontFamily.value.trim(),
  };
}

function createEmptyStageCells() {
  return Array.from({ length: GRID_COLUMNS * GRID_ROWS }, () => null as StageMatchCell | null);
}

function isStageMatchCell(cell: StageMatchCell | null): cell is StageMatchCell {
  return cell !== null;
}

function getStageCellStyle(cell: { x: number; y: number; width: 1 | 2 }) {
  return {
    left: `${(cell.x / GRID_COLUMNS) * 100}%`,
    top: `${(cell.y / GRID_ROWS) * 100}%`,
    width: `${(cell.width / GRID_COLUMNS) * 100}%`,
    height: `${(1 / GRID_ROWS) * 100}%`,
  };
}

function getProcessingCellSwatch(workerIndex: number) {
  return PROCESSING_CELL_SWATCHES[workerIndex % PROCESSING_CELL_SWATCHES.length];
}

function getProcessingCellStyle(cell: ProcessingCellState) {
  const swatch = getProcessingCellSwatch(cell.workerIndex);

  return {
    ...getStageCellStyle(cell),
    borderColor: swatch.borderColor,
    backgroundColor: swatch.backgroundColor,
    boxShadow: `0 0 0 1px rgba(0, 0, 0, 0.85), 0 0 8px ${swatch.shadowColor}`,
  };
}

function rebuildProcessingCells() {
  processingCells.value = Array.from(processingCellDrafts.entries())
    .sort(([left], [right]) => left - right)
    .map(([workerIndex, cell]) => ({
      workerIndex,
      ...cell,
    }));
}

function scheduleProcessingCellRefresh() {
  if (processingCellFrameHandle !== null || typeof window === "undefined") {
    return;
  }

  processingCellFrameHandle = window.requestAnimationFrame(() => {
    processingCellFrameHandle = null;
    rebuildProcessingCells();
  });
}

function clearProcessingCells() {
  processingCellDrafts.clear();

  if (processingCellFrameHandle !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(processingCellFrameHandle);
  }

  processingCellFrameHandle = null;
  processingCells.value = [];
}

function resetImageDerivedStateForMutation() {
  processedImageUrl.value = null;
  invalidateMatchResult();
}

function commitImageSettingChange(mutator: () => void, options?: { refreshPreviewPolarity?: boolean }) {
  mutator();
  resetImageDerivedStateForMutation();

  if (options?.refreshPreviewPolarity) {
    void refreshDetectedPreviewFromCurrentImage();
  }
}

function setProcessingCell(workerIndex: number | null, cell: ImageToAsciiProcessingCell | null) {
  if (workerIndex === null) {
    clearProcessingCells();
    return;
  }

  if (cell) {
    processingCellDrafts.set(workerIndex, cell);
  } else {
    processingCellDrafts.delete(workerIndex);
  }

  scheduleProcessingCellRefresh();
}

function getStageCellText(cell: StageMatchCell) {
  return cell.char === " " ? "\u00a0" : cell.char;
}

function getGlyphPolarityLabel(value: ImageToAsciiGlyphPolarity) {
  return value === "black-on-white" ? "Black text / White background" : "White text / Black background";
}

function detectGlyphPolarityFromLuminance(luminance: Uint8ClampedArray): ImageToAsciiGlyphPolarity {
  let total = 0;

  for (let index = 0; index < luminance.length; index += 1) {
    total += luminance[index];
  }

  return total / Math.max(1, luminance.length) >= 128 ? "black-on-white" : "white-on-black";
}

function updateDetectedPreviewPolarity(luminance: Uint8ClampedArray | null) {
  const detected = luminance ? detectGlyphPolarityFromLuminance(luminance) : DEFAULT_GLYPH_POLARITY;
  detectedPreviewPolarity.value = detected;
  autoDetectedGlyphPolarity.value = luminance ? detected : null;

  if (glyphPolarity.value === "auto") {
    resolvedGlyphPolarity.value = detected;
  }
}

function resolveGlyphPolarity(luminance: Uint8ClampedArray | null) {
  if (luminance) {
    updateDetectedPreviewPolarity(luminance);
  } else if (!sourceImageUrl.value) {
    updateDetectedPreviewPolarity(null);
  }

  if (glyphPolarity.value !== "auto") {
    resolvedGlyphPolarity.value = glyphPolarity.value;
    return glyphPolarity.value;
  }

  const resolved = luminance ? detectGlyphPolarityFromLuminance(luminance) : detectedPreviewPolarity.value;
  resolvedGlyphPolarity.value = resolved;
  autoDetectedGlyphPolarity.value = sourceImageUrl.value ? resolved : null;
  return resolved;
}

function isGlyphPreparationPhase(phase: ImageToAsciiMatchProgress["phase"]) {
  return phase === "load-library" || phase === "load-cache" || phase === "index-half" || phase === "index-full" || phase === "save-cache";
}

function formatScale(value: number) {
  const fixed = value.toFixed(2);

  if (fixed.endsWith(".00")) {
    return `${fixed.slice(0, -3)}.0`;
  }

  return fixed.replace(/0$/, "");
}

function readNumberFromEvent(event: Event) {
  return Number((event.target as HTMLInputElement).value);
}

function readStringFromEvent(event: Event) {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

function getAutoWorkerCount() {
  const hardwareCount = typeof navigator === "undefined" ? 2 : navigator.hardwareConcurrency || 2;
  return Math.min(4, Math.max(1, hardwareCount - 1));
}

function resolveWorkerCount(value: string) {
  const normalized = value.trim().toLowerCase();

  if (!normalized || normalized === "auto") {
    return getAutoWorkerCount();
  }

  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? Math.min(25, Math.max(1, parsed)) : getAutoWorkerCount();
}

function updateWorkerSetting(value: string) {
  workerSetting.value = value;
  invalidateMatchResult();
}

function updateMatchingMethod(value: string) {
  matchingMethod.value = normalizeMatchingMethod(value);
  invalidateMatchResult();
  preloadSelectedMatchingLibrary();
}

function normalizeMatchingMethod(value: string): ImageToAsciiMatchingMethod {
  if (
    value === "pixel" ||
    value === "pixelmatch" ||
    value === "chamfer" ||
    value === "edge-correlation" ||
    value === "template" ||
    value === "contour-shape"
  ) {
    return value;
  }

  return DEFAULT_MATCHING_METHOD;
}

function getMatchingMethodLabel(value: ImageToAsciiMatchingMethod) {
  if (value === "pixelmatch") {
    return "Pixelmatch";
  }

  if (value === "chamfer") {
    return "Chamfer";
  }

  if (value === "edge-correlation") {
    return "Edge Correlation";
  }

  if (value === "template") {
    return "Template Matching";
  }

  if (value === "contour-shape") {
    return "Contour Shape";
  }

  return "Pixel";
}

function getMatchingLibraryName(value: ImageToAsciiMatchingMethod): ImageToAsciiMatchingLibraryName {
  if (value === "pixelmatch") {
    return "pixelmatch";
  }

  if (value === "chamfer" || value === "edge-correlation" || value === "template" || value === "contour-shape") {
    return "opencv";
  }

  return "none";
}

function getMatchingLibraryLabel(value: ImageToAsciiMatchingLibraryName) {
  if (value === "pixelmatch") {
    return "Pixelmatch";
  }

  if (value === "opencv") {
    return "OpenCV.js";
  }

  return "Built-in";
}

function emitLibraryToast(kind: "success" | "error", message: string) {
  emit("toast", { kind, message });
}

function cancelMatchingLibraryPreload() {
  matchingLibraryPreloadToken += 1;
  matchingLibraryPreloadHandle?.cancel();
  matchingLibraryPreloadHandle = null;
}

function preloadSelectedMatchingLibrary() {
  cancelMatchingLibraryPreload();

  const method = matchingMethod.value;
  const library = getMatchingLibraryName(method);

  if (library === "none") {
    return;
  }

  const token = matchingLibraryPreloadToken;
  matchingLibraryPreloadHandle = preloadImageToAsciiMatchingLibrary(method, {
    onReady(status) {
      if (token !== matchingLibraryPreloadToken) {
        return;
      }

      matchingLibraryPreloadHandle = null;
      emitLibraryToast("success", `${getMatchingLibraryLabel(status.library)} loaded. Available.`);
    },
    onError(message) {
      if (token !== matchingLibraryPreloadToken) {
        return;
      }

      matchingLibraryPreloadHandle = null;
      emitLibraryToast("error", `${getMatchingLibraryLabel(library)} load failed. Unavailable. ${message}`);
    },
  });
}

function getMatchingParamsSnapshot(): ImageToAsciiMatchingParams {
  return cloneMatchingParams(toRaw(matchingParams));
}

function updateMatchFontFamily(value: string) {
  matchFontFamily.value = value;
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  invalidateMatchResult();
}

function updateMatchingWidthMode(value: string) {
  matchingWidthMode.value = value === "web" || value === "terminal" ? value : "auto";
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  invalidateMatchResult();
}

function updateGlyphPolarity(value: GlyphPolaritySetting) {
  glyphPolarity.value = value;
  resolvedGlyphPolarity.value = value === "auto" ? autoDetectedGlyphPolarity.value ?? detectedPreviewPolarity.value : value;
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  invalidateMatchResult();
}

function updateColorEmojiExclusion(value: boolean) {
  isColorEmojiExcluded.value = value;
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  invalidateMatchResult();
}

function cancelMatching(options?: { clearProcessingCells?: boolean }) {
  matchRequestToken += 1;
  matchHandle?.cancel();
  matchHandle = null;
  isMatching.value = false;
  matchProgress.value = null;

  if (options?.clearProcessingCells !== false) {
    clearProcessingCells();
  }
}

function stopMatching() {
  cancelMatching();
  matchResult.value = null;
  matchStatus.value = sourceImageUrl.value ? "Stopped" : "Load image to match";
}

function cancelGlyphCacheBuild() {
  glyphCacheBuildToken += 1;
  glyphCacheBuildHandle?.cancel();
  glyphCacheBuildHandle = null;
  isBuildingGlyphCache.value = false;
  glyphCacheProgress.value = null;
}

function clearMatchLayers() {
  halfMatchCells.value = createEmptyStageCells();
  fullMatchCells.value = createEmptyStageCells();
  clearProcessingCells();
}

function invalidateMatchResult() {
  cancelMatching({ clearProcessingCells: false });
  matchResult.value = null;
  matchStatus.value = sourceImageUrl.value ? "" : "Load image to match";

  if (sourceImageUrl.value) {
    loadError.value = "";
  }
}

function clearMatchResult() {
  invalidateMatchResult();
  clearMatchLayers();
}

function hasPlacedMatchCells() {
  return halfMatchCells.value.some(isStageMatchCell) || fullMatchCells.value.some(isStageMatchCell);
}

function applyMatchCellUpdate(update: ImageToAsciiCellUpdate) {
  const target = update.layer === "half" ? halfMatchCells : fullMatchCells;
  const index = update.y * GRID_COLUMNS + update.x;

  if (index < 0 || index >= target.value.length) {
    return;
  }

  target.value[index] = update.cell
    ? {
        x: update.x,
        y: update.y,
        char: update.cell.char,
        width: update.cell.width,
        score: update.cell.score,
      }
    : null;
}

async function refreshDetectedPreviewFromCurrentImage() {
  const token = ++detectedPreviewToken;

  if (!sourceImageUrl.value) {
    updateDetectedPreviewPolarity(null);
    return;
  }

  try {
    const imageData = await createMatchingImageData();

    if (token !== detectedPreviewToken || !imageData) {
      return;
    }

    updateDetectedPreviewPolarity(imageDataToLuminance(imageData));
  } catch {
    if (token !== detectedPreviewToken) {
      return;
    }

    updateDetectedPreviewPolarity(null);
  }
}

async function runImageMutation(operation: () => Promise<void> | void) {
  if (isMatching.value || isApplyingImageMutation.value) {
    return;
  }

  isApplyingImageMutation.value = true;

  try {
    await operation();
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    isApplyingImageMutation.value = false;
  }
}

function closeImageToAsciiModal() {
  isCloseConfirmOpen.value = false;
  emit("dirty-change", false);
  emit("close");
}

function requestCloseImageToAsciiModal() {
  if (isImageToAsciiModalDirty.value) {
    isCloseConfirmOpen.value = true;
    return;
  }

  closeImageToAsciiModal();
}

function confirmCloseImageToAsciiModal() {
  closeImageToAsciiModal();
}

function cancelCloseImageToAsciiModal() {
  isCloseConfirmOpen.value = false;
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && (navigator.platform || "").toLowerCase().includes("mac");
}

function isRotationWheelEvent(event: WheelEvent) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

function updateEdgeMode(value: string) {
  const nextValue = value as EdgeMode;

  if (nextValue === edgeMode.value || isImageMutationLocked.value) {
    return;
  }

  commitImageSettingChange(
    () => {
      edgeMode.value = nextValue;
    },
    { refreshPreviewPolarity: true },
  );
}

function openFilePicker() {
  if (isImageMutationLocked.value) {
    return;
  }

  fileInputRef.value?.click();
}

function handleFileInput(event: Event) {
  if (isImageMutationLocked.value) {
    return;
  }

  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    requestImageFileLoad(file);
  }

  input.value = "";
}

function handleModalDragEnter() {
  if (isImageMutationLocked.value) {
    return;
  }

  isDragOver.value = true;
}

function handleModalDragLeave(event: DragEvent) {
  const modal = event.currentTarget as HTMLElement;
  const nextTarget = event.relatedTarget;

  if (!(nextTarget instanceof Node) || !modal.contains(nextTarget)) {
    isDragOver.value = false;
  }
}

function handleDrop(event: DragEvent) {
  isDragOver.value = false;

  if (isImageMutationLocked.value) {
    return;
  }

  const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));

  if (!file) {
    loadError.value = "画像ファイルをドロップしてください。";
    return;
  }

  requestImageFileLoad(file);
}

function getImageFileName(file: File) {
  return file.name.trim() || "clipboard-image.png";
}

function getClipboardImageFile(event: ClipboardEvent) {
  const data = event.clipboardData;

  if (!data) {
    return null;
  }

  const fileFromList = Array.from(data.files).find((item) => item.type.startsWith("image/"));

  if (fileFromList) {
    return fileFromList;
  }

  const fileFromItems = Array.from(data.items)
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .find((item): item is File => item !== null);

  return fileFromItems ?? null;
}

function handleWindowPaste(event: ClipboardEvent) {
  if (isImageMutationLocked.value) {
    return;
  }

  const file = getClipboardImageFile(event);

  if (!file) {
    return;
  }

  event.preventDefault();
  requestImageFileLoad(file);
}

function requestImageFileLoad(file: File) {
  if (!file.type.startsWith("image/")) {
    loadError.value = "画像ファイルを選択してください。";
    return;
  }

  void applyImageFileLoad(file);
}

async function applyImageFileLoad(file: File) {
  await runImageMutation(async () => {
    const nextUrl = URL.createObjectURL(file);

    try {
      const size = await readImageSize(nextUrl);
      revokeSourceImageUrl();
      sourceImageUrl.value = nextUrl;
      sourceFileName.value = getImageFileName(file);
      sourceNaturalWidth.value = size.width;
      sourceNaturalHeight.value = size.height;
      loadError.value = "";
      resetTransformForImage(size.width, size.height);
      resetImageDerivedStateForMutation();
      await refreshDetectedPreviewFromCurrentImage();
    } catch {
      URL.revokeObjectURL(nextUrl);
      throw new Error("画像を読み込めませんでした。");
    }
  });
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    };
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = url;
  });
}

function loadImageElement(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();

    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image."));
    image.src = url;
  });
}

function resetTransformForImage(width: number, height: number) {
  transform.x = 0;
  transform.y = 0;
  transform.rotation = 0;
  transform.scale = clamp(Math.min(TARGET_WIDTH / width, TARGET_HEIGHT / height), SCALE_MIN, SCALE_MAX);
}

function revokeSourceImageUrl() {
  if (sourceImageUrl.value) {
    URL.revokeObjectURL(sourceImageUrl.value);
  }
}

function updateScale(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Number(clamp(value, SCALE_MIN, SCALE_MAX).toFixed(2));

  if (nextValue === transform.scale) {
    return;
  }

  commitImageSettingChange(() => {
    transform.scale = nextValue;
  });
}

function updateRotation(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Number(clamp(value, ROTATION_MIN, ROTATION_MAX).toFixed(1));

  if (nextValue === transform.rotation) {
    return;
  }

  commitImageSettingChange(() => {
    transform.rotation = nextValue;
  });
}

function updatePositionX(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(value);

  if (nextValue === transform.x) {
    return;
  }

  commitImageSettingChange(() => {
    transform.x = nextValue;
  });
}

function updatePositionY(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(value);

  if (nextValue === transform.y) {
    return;
  }

  commitImageSettingChange(() => {
    transform.y = nextValue;
  });
}

function updateContrast(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(clamp(value, 0, 200));

  if (nextValue === contrast.value) {
    return;
  }

  commitImageSettingChange(() => {
    contrast.value = nextValue;
  });
}

function updateMonochromeEnabled(value: boolean) {
  if (!sourceImageUrl.value || value === isMonochromeEnabled.value || isImageMutationLocked.value) {
    return;
  }

  commitImageSettingChange(() => {
    isMonochromeEnabled.value = value;
  });
}

function updateInverted(value: boolean) {
  if (!sourceImageUrl.value || value === isInverted.value || isImageMutationLocked.value) {
    return;
  }

  commitImageSettingChange(
    () => {
      isInverted.value = value;
    },
    { refreshPreviewPolarity: true },
  );
}

function updateSobelThreshold(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(clamp(value, 0, 255));

  if (nextValue === sobelThreshold.value) {
    return;
  }

  commitImageSettingChange(() => {
    sobelThreshold.value = nextValue;
  });
}

function updateLaplacianThreshold(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(clamp(value, 0, 255));

  if (nextValue === laplacianThreshold.value) {
    return;
  }

  commitImageSettingChange(() => {
    laplacianThreshold.value = nextValue;
  });
}

function updateCannyBlur(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(clamp(value, 0, 8));

  if (nextValue === cannyBlur.value) {
    return;
  }

  commitImageSettingChange(() => {
    cannyBlur.value = nextValue;
  });
}

function updateCannyLowThreshold(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(clamp(value, 0, 255));

  if (nextValue === cannyLowThreshold.value) {
    return;
  }

  commitImageSettingChange(() => {
    cannyLowThreshold.value = nextValue;
  });
}

function updateCannyHighThreshold(value: number) {
  if (!sourceImageUrl.value || !Number.isFinite(value) || isImageMutationLocked.value) {
    return;
  }

  const nextValue = Math.round(clamp(value, 0, 255));

  if (nextValue === cannyHighThreshold.value) {
    return;
  }

  commitImageSettingChange(() => {
    cannyHighThreshold.value = nextValue;
  });
}

function imageDataToLuminance(imageData: ImageData) {
  const source = imageData.data;
  const luminance = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT);

  for (let index = 0; index < luminance.length; index += 1) {
    const sourceIndex = index * 4;
    luminance[index] = Math.round(source[sourceIndex] * 0.2126 + source[sourceIndex + 1] * 0.7152 + source[sourceIndex + 2] * 0.0722);
  }

  return luminance;
}

function createEdgeImageData(edgeValues: Uint8ClampedArray) {
  const output = new ImageData(TARGET_WIDTH, TARGET_HEIGHT);

  for (let index = 0; index < edgeValues.length; index += 1) {
    const outputIndex = index * 4;
    const value = isInverted.value ? 255 - edgeValues[index] : edgeValues[index];
    output.data[outputIndex] = value;
    output.data[outputIndex + 1] = value;
    output.data[outputIndex + 2] = value;
    output.data[outputIndex + 3] = 255;
  }

  return output;
}

function sampleLuminance(luminance: Uint8ClampedArray, x: number, y: number) {
  const clampedX = Math.round(clamp(x, 0, TARGET_WIDTH - 1));
  const clampedY = Math.round(clamp(y, 0, TARGET_HEIGHT - 1));

  return luminance[clampedY * TARGET_WIDTH + clampedX] ?? 0;
}

function applyBaseProcessing(imageData: ImageData) {
  const data = imageData.data;
  const contrastScale = contrast.value / 100;

  for (let index = 0; index < data.length; index += 4) {
    let red = data[index];
    let green = data[index + 1];
    let blue = data[index + 2];

    if (isMonochromeEnabled.value) {
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      red = luminance;
      green = luminance;
      blue = luminance;
    }

    red = clamp((red - 128) * contrastScale + 128, 0, 255);
    green = clamp((green - 128) * contrastScale + 128, 0, 255);
    blue = clamp((blue - 128) * contrastScale + 128, 0, 255);

    if (isInverted.value) {
      red = 255 - red;
      green = 255 - green;
      blue = 255 - blue;
    }

    data[index] = red;
    data[index + 1] = green;
    data[index + 2] = blue;
    data[index + 3] = 255;
  }
}

function drawTransformedSourceImage(context: CanvasRenderingContext2D, image: HTMLImageElement) {
  context.fillStyle = "#000000";
  context.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  context.save();
  context.translate(TARGET_WIDTH / 2 + transform.x, TARGET_HEIGHT / 2 + transform.y);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.scale(transform.scale, transform.scale);
  context.drawImage(image, -sourceNaturalWidth.value / 2, -sourceNaturalHeight.value / 2, sourceNaturalWidth.value, sourceNaturalHeight.value);
  context.restore();
}

async function createMatchingImageData() {
  const imageUrl = processedImageUrl.value ?? sourceImageUrl.value;

  if (!imageUrl) {
    return null;
  }

  const image = await loadImageElement(imageUrl);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;

  const context = canvas.getContext("2d");

  if (!context) {
    loadError.value = "画像加工に失敗しました。";
    return null;
  }

  if (processedImageUrl.value) {
    context.drawImage(image, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  } else {
    drawTransformedSourceImage(context, image);
    const imageData = context.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    applyBaseProcessing(imageData);
    context.putImageData(imageData, 0, 0);
  }

  return context.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
}

function getMatchFontFamilyFromCss() {
  const rootStyle = getComputedStyle(document.documentElement);
  return rootStyle.getPropertyValue("--aa-font-family").trim() || '"MS Gothic", monospace';
}

async function buildGlyphCache() {
  if (!canBuildGlyphCache.value) {
    return;
  }

  cancelGlyphCacheBuild();
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Preparing glyph cache";
  glyphCacheProgress.value = {
    phase: "index-half",
    checkedCodePointCount: 0,
    totalCodePointCount: 1,
    matchedCellCount: 0,
    totalCellCount: GRID_COLUMNS * GRID_ROWS,
  };
  isBuildingGlyphCache.value = true;

  const token = glyphCacheBuildToken;
  let resolvedPolarity: ImageToAsciiGlyphPolarity;

  try {
    const imageData = glyphPolarity.value === "auto" && sourceImageUrl.value ? await createMatchingImageData() : null;

    if (token !== glyphCacheBuildToken) {
      return;
    }

    resolvedPolarity = resolveGlyphPolarity(imageData ? imageDataToLuminance(imageData) : null);
  } catch (error) {
    if (token !== glyphCacheBuildToken) {
      return;
    }

    glyphCacheBuildHandle = null;
    isBuildingGlyphCache.value = false;
    glyphCacheProgress.value = null;
    glyphCacheSummary.value = null;
    glyphCacheStatus.value = error instanceof Error ? error.message : String(error);
    loadError.value = glyphCacheStatus.value;
    return;
  }

  glyphCacheStatus.value = `Building glyph cache (${getGlyphPolarityLabel(resolvedPolarity)})`;

  glyphCacheBuildHandle = startImageToAsciiGlyphCacheBuild(
    {
      pageData: unicodeGlyphPages as UnicodeGlyphPageData,
      fontFamily: effectiveMatchFontFamily.value,
      glyphPolarity: resolvedPolarity,
      excludeColorEmoji: isColorEmojiExcluded.value,
      widthMode: effectiveMatchingWidthMode.value,
    },
    {
      onProgress(progress) {
        if (token !== glyphCacheBuildToken) {
          return;
        }

        glyphCacheProgress.value = progress;
        glyphCacheStatus.value = glyphProgressDetail.value || "Building glyph cache";
      },
      onDone(summary) {
        if (token !== glyphCacheBuildToken) {
          return;
        }

        glyphCacheBuildHandle = null;
        isBuildingGlyphCache.value = false;
        glyphCacheProgress.value = null;
        glyphCacheSummary.value = summary;
        glyphCacheStatus.value = `Glyph cache ready. Half ${summary.halfCount}, Full ${summary.fullCount}`;
      },
      onError(message) {
        if (token !== glyphCacheBuildToken) {
          return;
        }

        glyphCacheBuildHandle = null;
        isBuildingGlyphCache.value = false;
        glyphCacheProgress.value = null;
        glyphCacheSummary.value = null;
        glyphCacheStatus.value = message;
        loadError.value = message;
      },
    },
  );
}

async function regenerateMatch() {
  if (!sourceImageUrl.value || isMatching.value || isBuildingGlyphCache.value) {
    return;
  }

  cancelMatching({ clearProcessingCells: false });
  matchResult.value = null;
  loadError.value = "";
  matchStatus.value = "Preparing image";
  matchProgress.value = {
    phase: "load-cache",
    checkedCodePointCount: 0,
    totalCodePointCount: 1,
    matchedCellCount: 0,
    totalCellCount: GRID_COLUMNS * GRID_ROWS,
  };
  isMatching.value = true;

  const token = matchRequestToken;

  try {
    const imageData = await createMatchingImageData();

    if (!imageData || token !== matchRequestToken) {
      return;
    }

    const imageAlpha = imageDataToLuminance(imageData);
    const resolvedPolarity = resolveGlyphPolarity(imageAlpha);
    const workerCount = resolvedWorkerCount.value;
    matchStatus.value = `Starting ${workerCount} worker${workerCount > 1 ? "s" : ""}`;
    matchHandle = startImageToAsciiMatching(
      {
        pageData: unicodeGlyphPages as UnicodeGlyphPageData,
        imageAlpha,
        fontFamily: effectiveMatchFontFamily.value,
        glyphPolarity: resolvedPolarity,
        excludeColorEmoji: isColorEmojiExcluded.value,
        threshold: clamp(Number(differenceThreshold.value), 0, 100),
        includeFullWidth: isFullWidthMatchingEnabled.value,
        matchingMethod: matchingMethod.value,
        matchingParams: getMatchingParamsSnapshot(),
        widthMode: effectiveMatchingWidthMode.value,
        workerCount,
      },
      {
        onProgress(progress) {
          if (token !== matchRequestToken) {
            return;
          }

          matchProgress.value = progress;
          matchStatus.value = matchProgressText.value;
        },
        onCell(update) {
          if (token !== matchRequestToken) {
            return;
          }

          applyMatchCellUpdate(update);
        },
        onProcessingCell(workerIndex, cell) {
          if (token !== matchRequestToken) {
            return;
          }

          setProcessingCell(workerIndex, cell);
        },
        onResult(result) {
          if (token !== matchRequestToken) {
            return;
          }

          matchHandle = null;
          isMatching.value = false;
          matchProgress.value = null;
          clearProcessingCells();
          matchResult.value = result;
          matchStatus.value = "Matching ready";
        },
        onError(message) {
          if (token !== matchRequestToken) {
            return;
          }

          matchHandle = null;
          isMatching.value = false;
          matchProgress.value = null;
          clearProcessingCells();
          matchResult.value = null;
          matchStatus.value = message;
          loadError.value = message;
        },
      },
    );
  } catch (error) {
    if (token !== matchRequestToken) {
      return;
    }

    matchHandle = null;
    isMatching.value = false;
    matchProgress.value = null;
    clearProcessingCells();
    matchResult.value = null;
    matchStatus.value = error instanceof Error ? error.message : String(error);
    loadError.value = matchStatus.value;
  }
}

function applySobelEdge(luminance: Uint8ClampedArray, threshold: number) {
  const output = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT);

  for (let y = 0; y < TARGET_HEIGHT; y += 1) {
    for (let x = 0; x < TARGET_WIDTH; x += 1) {
      const gx =
        -sampleLuminance(luminance, x - 1, y - 1) +
        sampleLuminance(luminance, x + 1, y - 1) -
        2 * sampleLuminance(luminance, x - 1, y) +
        2 * sampleLuminance(luminance, x + 1, y) -
        sampleLuminance(luminance, x - 1, y + 1) +
        sampleLuminance(luminance, x + 1, y + 1);
      const gy =
        -sampleLuminance(luminance, x - 1, y - 1) -
        2 * sampleLuminance(luminance, x, y - 1) -
        sampleLuminance(luminance, x + 1, y - 1) +
        sampleLuminance(luminance, x - 1, y + 1) +
        2 * sampleLuminance(luminance, x, y + 1) +
        sampleLuminance(luminance, x + 1, y + 1);
      const magnitude = Math.min(255, Math.hypot(gx, gy));

      output[y * TARGET_WIDTH + x] = magnitude >= threshold ? 255 : 0;
    }
  }

  return output;
}

function applyLaplacianEdge(luminance: Uint8ClampedArray, threshold: number) {
  const output = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT);

  for (let y = 0; y < TARGET_HEIGHT; y += 1) {
    for (let x = 0; x < TARGET_WIDTH; x += 1) {
      const value = Math.abs(
        sampleLuminance(luminance, x, y - 1) +
          sampleLuminance(luminance, x - 1, y) -
          4 * sampleLuminance(luminance, x, y) +
          sampleLuminance(luminance, x + 1, y) +
          sampleLuminance(luminance, x, y + 1),
      );

      output[y * TARGET_WIDTH + x] = value >= threshold ? 255 : 0;
    }
  }

  return output;
}

function boxBlurLuminance(luminance: Uint8ClampedArray, radius: number) {
  const roundedRadius = Math.round(clamp(radius, 0, 8));

  if (roundedRadius <= 0) {
    return luminance;
  }

  const output = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT);
  const diameter = roundedRadius * 2 + 1;
  const area = diameter * diameter;

  for (let y = 0; y < TARGET_HEIGHT; y += 1) {
    for (let x = 0; x < TARGET_WIDTH; x += 1) {
      let total = 0;

      for (let offsetY = -roundedRadius; offsetY <= roundedRadius; offsetY += 1) {
        for (let offsetX = -roundedRadius; offsetX <= roundedRadius; offsetX += 1) {
          total += sampleLuminance(luminance, x + offsetX, y + offsetY);
        }
      }

      output[y * TARGET_WIDTH + x] = Math.round(total / area);
    }
  }

  return output;
}

function applyCannyLikeEdge(luminance: Uint8ClampedArray, blurRadius: number, lowThreshold: number, highThreshold: number) {
  const blurred = boxBlurLuminance(luminance, blurRadius);
  const magnitudes = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT);
  const output = new Uint8ClampedArray(TARGET_WIDTH * TARGET_HEIGHT);

  for (let y = 0; y < TARGET_HEIGHT; y += 1) {
    for (let x = 0; x < TARGET_WIDTH; x += 1) {
      const gx =
        -sampleLuminance(blurred, x - 1, y - 1) +
        sampleLuminance(blurred, x + 1, y - 1) -
        2 * sampleLuminance(blurred, x - 1, y) +
        2 * sampleLuminance(blurred, x + 1, y) -
        sampleLuminance(blurred, x - 1, y + 1) +
        sampleLuminance(blurred, x + 1, y + 1);
      const gy =
        -sampleLuminance(blurred, x - 1, y - 1) -
        2 * sampleLuminance(blurred, x, y - 1) -
        sampleLuminance(blurred, x + 1, y - 1) +
        sampleLuminance(blurred, x - 1, y + 1) +
        2 * sampleLuminance(blurred, x, y + 1) +
        sampleLuminance(blurred, x + 1, y + 1);

      magnitudes[y * TARGET_WIDTH + x] = Math.min(255, Math.hypot(gx, gy));
    }
  }

  for (let y = 0; y < TARGET_HEIGHT; y += 1) {
    for (let x = 0; x < TARGET_WIDTH; x += 1) {
      const index = y * TARGET_WIDTH + x;
      const magnitude = magnitudes[index];

      if (magnitude >= highThreshold) {
        output[index] = 255;
      } else if (magnitude >= lowThreshold) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            if (sampleLuminance(magnitudes, x + offsetX, y + offsetY) >= highThreshold) {
              output[index] = 255;
            }
          }
        }
      }
    }
  }

  return output;
}

async function applyEdgeMode() {
  if (!sourceImageUrl.value || edgeMode.value === "Off") {
    return;
  }

  await runImageMutation(async () => {
    processedImageUrl.value = null;
    invalidateMatchResult();

    const image = await loadImageElement(sourceImageUrl.value!);
    const canvas = document.createElement("canvas");
    canvas.width = TARGET_WIDTH;
    canvas.height = TARGET_HEIGHT;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("画像加工に失敗しました。");
    }

    drawTransformedSourceImage(context, image);

    const imageData = context.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
    applyBaseProcessing(imageData);
    const luminance = imageDataToLuminance(imageData);
    const edgeValues =
      edgeMode.value === "Sobel"
        ? applySobelEdge(luminance, sobelThreshold.value)
        : edgeMode.value === "Laplacian"
          ? applyLaplacianEdge(luminance, laplacianThreshold.value)
          : applyCannyLikeEdge(luminance, cannyBlur.value, cannyLowThreshold.value, cannyHighThreshold.value);

    context.putImageData(createEdgeImageData(edgeValues), 0, 0);
    processedImageUrl.value = canvas.toDataURL("image/png");
    loadError.value = "";
    await refreshDetectedPreviewFromCurrentImage();
  });
}

function getProcessedImageFileName() {
  const baseName = sourceFileName.value.replace(/\.[^.]+$/, "").trim() || "image-to-aa";
  return `${baseName}-processed.png`;
}

async function saveProcessedImage() {
  if (!sourceImageUrl.value || isImageMutationLocked.value) {
    return;
  }

  try {
    const imageData = await createMatchingImageData();

    if (!imageData) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = TARGET_WIDTH;
    canvas.height = TARGET_HEIGHT;

    const context = canvas.getContext("2d");

    if (!context) {
      loadError.value = "画像保存に失敗しました。";
      return;
    }

    context.putImageData(imageData, 0, 0);

    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = getProcessedImageFileName();
    link.click();
  } catch {
    loadError.value = "画像保存に失敗しました。";
    return;
  }
}

function beginStageDrag(event: PointerEvent) {
  if (!sourceImageUrl.value || event.button !== 0 || isImageMutationLocked.value) {
    return;
  }

  event.preventDefault();
  stageRef.value?.setPointerCapture(event.pointerId);
  activeDrag.value = {
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: transform.x,
    startY: transform.y,
  };
}

function moveStageDrag(event: PointerEvent) {
  if (!activeDrag.value || activeDrag.value.pointerId !== event.pointerId || !stageRef.value) {
    return;
  }

  const rect = stageRef.value.getBoundingClientRect();
  const deltaX = ((event.clientX - activeDrag.value.startClientX) / rect.width) * TARGET_WIDTH;
  const deltaY = ((event.clientY - activeDrag.value.startClientY) / rect.height) * TARGET_HEIGHT;
  const nextX = Math.round(activeDrag.value.startX + deltaX);
  const nextY = Math.round(activeDrag.value.startY + deltaY);

  if (nextX === transform.x && nextY === transform.y) {
    return;
  }

  commitImageSettingChange(() => {
    transform.x = nextX;
    transform.y = nextY;
  });
}

function endStageDrag(event: PointerEvent) {
  if (!activeDrag.value || activeDrag.value.pointerId !== event.pointerId) {
    return;
  }

  if (stageRef.value?.hasPointerCapture(event.pointerId)) {
    stageRef.value.releasePointerCapture(event.pointerId);
  }

  activeDrag.value = null;
}

function handleStageWheel(event: WheelEvent) {
  event.preventDefault();
  event.stopPropagation();

  if (!sourceImageUrl.value) {
    return;
  }

  if (isImageMutationLocked.value) {
    return;
  }

  if (isRotationWheelEvent(event)) {
    updateRotation(transform.rotation - event.deltaY * 0.08);
    return;
  }

  updateScale(transform.scale * Math.exp(-event.deltaY * 0.001));
}

function applyMatchResult() {
  if (!matchResult.value) {
    return;
  }

  emit("apply", matchResult.value.cells);
  closeImageToAsciiModal();
}

onMounted(() => {
  stageRef.value?.addEventListener("wheel", handleStageWheel, { passive: false });
  window.addEventListener("paste", handleWindowPaste, true);
});

onBeforeUnmount(() => {
  emit("dirty-change", false);
  cancelMatching();
  cancelGlyphCacheBuild();
  cancelMatchingLibraryPreload();
  clearProcessingCells();
  stageRef.value?.removeEventListener("wheel", handleStageWheel);
  window.removeEventListener("paste", handleWindowPaste, true);
  revokeSourceImageUrl();
});
</script>

<template>
  <div class="confirm-modal-backdrop image-to-aa-backdrop" role="presentation">
    <section
      class="confirm-modal image-to-aa-modal"
      :class="{ 'is-drag-over': isDragOver }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="image-to-aa-title"
      @dragenter.prevent="handleModalDragEnter"
      @dragover.prevent="handleModalDragEnter"
      @dragleave="handleModalDragLeave"
      @drop.prevent="handleDrop"
      @pointerdown.stop
      @contextmenu.prevent.stop
    >
      <header class="image-to-aa-header">
        <div>
          <h2 id="image-to-aa-title">Image to AA</h2>
          <p :class="{ 'is-error': loadError }">{{ statusText }}</p>
        </div>
        <div class="image-to-aa-header-actions">
          <button
            type="button"
            class="image-settings-button image-settings-button--header"
            :class="{ 'is-active': isMatchingSettingsOpen }"
            aria-label="Image to AA settings"
            @click="isMatchingSettingsOpen = true"
          >
            <span aria-hidden="true" v-html="settingsIcon"></span>
          </button>
          <button type="button" aria-label="Close" @click="requestCloseImageToAsciiModal">&times;</button>
        </div>
      </header>

      <div class="image-to-aa-body">
        <section class="image-to-aa-stage-panel" aria-label="Preview">
          <div
            ref="stageRef"
            class="image-stage"
            :class="{
              'has-source-image': sourceImageUrl,
              'is-dragging': activeDrag,
              'image-stage--white-on-black': displayGlyphPolarity === 'white-on-black',
              'image-stage--black-on-white': displayGlyphPolarity === 'black-on-white',
            }"
            aria-label="image stage"
            @pointerdown="beginStageDrag"
            @pointermove="moveStageDrag"
            @pointerup="endStageDrag"
            @pointercancel="endStageDrag"
          >
            <div class="source-image-layer" :style="sourceImageStyle" aria-hidden="true">
              <img v-if="processedImageUrl" class="processed-image" :src="processedImageUrl" alt="" draggable="false" />
              <img v-else-if="sourceImageUrl" class="source-image" :src="sourceImageUrl" alt="" draggable="false" />
              <div v-else class="image-stage-empty-message">DRAG IMAGE HERE</div>
            </div>
            <div v-if="sourceImageUrl" class="half-match-layer" aria-label="Half-width ASCII layer">
              <span
                v-for="cell in visibleHalfMatchCells"
                :key="`half-${cell.x}-${cell.y}`"
                class="image-match-cell image-match-cell--half"
                :style="getStageCellStyle(cell)"
              >{{ getStageCellText(cell) }}</span>
            </div>
            <div v-if="sourceImageUrl && isFullWidthMatchingEnabled" class="full-match-layer" aria-label="Full-width ASCII layer">
              <span
                v-for="cell in visibleFullMatchCells"
                :key="`full-${cell.x}-${cell.y}`"
                class="image-match-cell image-match-cell--full"
                :style="getStageCellStyle(cell)"
              >{{ getStageCellText(cell) }}</span>
            </div>
            <div v-if="isGridVisible" class="image-grid-overlay" :style="gridOverlayStyle" aria-hidden="true"></div>
            <div
              v-for="cell in processingCells"
              :key="`processing-${cell.workerIndex}`"
              class="image-processing-cell"
              :style="getProcessingCellStyle(cell)"
              aria-hidden="true"
            ></div>
            <div v-if="glyphProgress" class="image-glyph-progress-overlay" aria-live="polite">
              <div class="image-glyph-progress-card">
                <strong>{{ glyphProgressTitle }}</strong>
                <span>{{ glyphProgressPercent }}%</span>
                <div class="image-glyph-progress-bar" aria-hidden="true">
                  <div :style="{ width: `${glyphProgressPercent}%` }"></div>
                </div>
                <small>{{ glyphProgressDetail }}</small>
              </div>
            </div>
          </div>
        </section>

        <aside class="image-control-panel" aria-label="Controls">
          <div class="image-load-actions">
            <button type="button" class="image-load-button" :disabled="isImageMutationLocked" @click="openFilePicker">Load Image</button>
            <button type="button" class="image-action-button" :disabled="!canSaveProcessedImage" @click="saveProcessedImage">Save Image</button>
          </div>
          <input ref="fileInputRef" class="hidden-file-input" type="file" accept="image/*" :disabled="isImageMutationLocked" @change="handleFileInput" />

          <section class="image-control-group">
            <h3>Transform</h3>
            <label class="image-control-field">
              <span>Scale</span>
              <div class="image-control-inline">
                <input type="range" min="0.1" max="4" step="0.01" :disabled="isImageMutationLocked" :value="transform.scale" @input="updateScale(readNumberFromEvent($event))" />
                <input class="image-number-input" type="number" min="0.1" max="4" step="0.1" :disabled="isImageMutationLocked" :value="scaleText" @input="updateScale(readNumberFromEvent($event))" />
              </div>
            </label>
            <label class="image-control-field">
              <span>Rotation</span>
              <div class="image-control-inline">
                <input type="range" min="-180" max="180" step="1" :disabled="isImageMutationLocked" :value="transform.rotation" @input="updateRotation(readNumberFromEvent($event))" />
                <input class="image-number-input" type="number" min="-180" max="180" step="1" :disabled="isImageMutationLocked" :value="rotationText" @input="updateRotation(readNumberFromEvent($event))" />
              </div>
            </label>
            <div class="image-control-row">
              <label class="image-control-field">
                <span>X</span>
                <input type="number" step="1" :disabled="isImageMutationLocked" :value="positionXText" @input="updatePositionX(readNumberFromEvent($event))" />
              </label>
              <label class="image-control-field">
                <span>Y</span>
                <input type="number" step="1" :disabled="isImageMutationLocked" :value="positionYText" @input="updatePositionY(readNumberFromEvent($event))" />
              </label>
            </div>
          </section>

          <section class="image-control-group">
            <h3>Processing</h3>
            <label class="image-check-field">
              <input
                type="checkbox"
                :disabled="isImageMutationLocked"
                :checked="isMonochromeEnabled"
                @change="updateMonochromeEnabled(($event.target as HTMLInputElement).checked)"
              />
              <span>Monochrome</span>
            </label>
            <label class="image-control-field">
              <span>Contrast</span>
              <input type="range" min="0" max="200" :disabled="isImageMutationLocked" :value="contrast" @input="updateContrast(readNumberFromEvent($event))" />
            </label>
            <label class="image-check-field">
              <input
                type="checkbox"
                :disabled="isImageMutationLocked"
                :checked="isInverted"
                @change="updateInverted(($event.target as HTMLInputElement).checked)"
              />
              <span>Invert</span>
            </label>
            <hr class="image-match-divider" />
            <div class="image-edge-mode-row">
              <label class="image-control-field">
                <span>Edge Mode</span>
                <select :disabled="isImageMutationLocked" :value="edgeMode" @change="updateEdgeMode(readStringFromEvent($event))">
                  <option>Off</option>
                  <option>Sobel</option>
                  <option>Laplacian</option>
                  <option>Canny-like</option>
                </select>
              </label>
              <button type="button" class="image-action-button" :disabled="isImageMutationLocked || !sourceImageUrl || edgeMode === 'Off'" @click="applyEdgeMode">Apply Edge</button>
            </div>
            <label v-if="edgeMode === 'Sobel'" class="image-control-field">
              <span>Sobel Threshold</span>
              <input type="number" min="0" max="255" step="1" :disabled="isImageMutationLocked" :value="sobelThreshold" @input="updateSobelThreshold(readNumberFromEvent($event))" />
            </label>
            <label v-else-if="edgeMode === 'Laplacian'" class="image-control-field">
              <span>Laplacian Threshold</span>
              <input type="number" min="0" max="255" step="1" :disabled="isImageMutationLocked" :value="laplacianThreshold" @input="updateLaplacianThreshold(readNumberFromEvent($event))" />
            </label>
            <div v-else-if="edgeMode === 'Canny-like'" class="image-control-row image-control-row--three">
              <label class="image-control-field">
                <span>Blur</span>
                <input type="number" min="0" max="8" step="1" :disabled="isImageMutationLocked" :value="cannyBlur" @input="updateCannyBlur(readNumberFromEvent($event))" />
              </label>
              <label class="image-control-field">
                <span>Low</span>
                <input type="number" min="0" max="255" step="1" :disabled="isImageMutationLocked" :value="cannyLowThreshold" @input="updateCannyLowThreshold(readNumberFromEvent($event))" />
              </label>
              <label class="image-control-field">
                <span>High</span>
                <input type="number" min="0" max="255" step="1" :disabled="isImageMutationLocked" :value="cannyHighThreshold" @input="updateCannyHighThreshold(readNumberFromEvent($event))" />
              </label>
            </div>
            <span class="image-edge-status">{{ edgeStatusText }}</span>
          </section>

          <section class="image-control-group">
            <h3>Matching</h3>
            <label class="image-check-field">
              <input v-model="isFullWidthMatchingEnabled" type="checkbox" @change="invalidateMatchResult" />
              <span>Full-width matching</span>
            </label>
            <label class="image-check-field">
              <input
                type="checkbox"
                :checked="isColorEmojiExcluded"
                @change="updateColorEmojiExclusion(($event.target as HTMLInputElement).checked)"
              />
              <span>Exclude color emoji</span>
            </label>
            <label class="image-control-field">
              <span>Matching Method</span>
              <select :value="matchingMethod" @change="updateMatchingMethod(readStringFromEvent($event))">
                <option value="pixel">Pixel</option>
                <option value="pixelmatch">Pixelmatch</option>
                <option value="chamfer">Chamfer</option>
                <option value="edge-correlation">Edge Correlation</option>
                <option value="template">Template Matching</option>
                <option value="contour-shape">Contour Shape</option>
              </select>
            </label>
            <div v-if="matchingMethod === 'pixel'" class="image-match-param-panel">
              <div class="image-control-row image-control-row--three">
                <label class="image-control-field">
                  <span>Pixel Weight</span>
                  <input v-model.number="matchingParams.pixel.pixelWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Density Weight</span>
                  <input v-model.number="matchingParams.pixel.densityWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Feature Weight</span>
                  <input v-model.number="matchingParams.pixel.featureWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
              <div class="image-control-row">
                <label class="image-control-field">
                  <span>Blank Bias</span>
                  <input v-model.number="matchingParams.pixel.blankBias" type="number" min="-100" max="100" step="0.5" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Ink Penalty</span>
                  <input v-model.number="matchingParams.pixel.inkMismatchPenalty" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
            </div>
            <div v-else-if="matchingMethod === 'pixelmatch'" class="image-match-param-panel">
              <div class="image-control-row image-control-row--three">
                <label class="image-control-field">
                  <span>Threshold</span>
                  <input v-model.number="matchingParams.pixelmatch.threshold" type="number" min="0" max="1" step="0.01" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Alpha</span>
                  <input v-model.number="matchingParams.pixelmatch.alpha" type="number" min="0" max="1" step="0.01" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Perceptual</span>
                  <input v-model.number="matchingParams.pixelmatch.perceptualWeight" type="number" min="0" max="1" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
              <label class="image-check-field">
                <input v-model="matchingParams.pixelmatch.includeAA" type="checkbox" @change="invalidateMatchResult" />
                <span>Include anti-alias</span>
              </label>
              <label class="image-check-field">
                <input v-model="matchingParams.pixelmatch.diffMask" type="checkbox" @change="invalidateMatchResult" />
                <span>Diff mask</span>
              </label>
            </div>
            <div v-else-if="matchingMethod === 'chamfer'" class="image-match-param-panel">
              <div class="image-control-row">
                <label class="image-control-field">
                  <span>Metric</span>
                  <select v-model="matchingParams.chamfer.metric" @change="invalidateMatchResult">
                    <option value="euclidean">Euclidean</option>
                    <option value="manhattan">Manhattan</option>
                    <option value="chebyshev">Chebyshev</option>
                  </select>
                </label>
                <label class="image-control-field">
                  <span>Max Distance</span>
                  <input v-model.number="matchingParams.chamfer.maxDistance" type="number" min="1" max="32" step="0.5" @input="invalidateMatchResult" />
                </label>
              </div>
              <div class="image-control-row image-control-row--three">
                <label class="image-control-field">
                  <span>Foreground</span>
                  <input v-model.number="matchingParams.chamfer.foregroundWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Background</span>
                  <input v-model.number="matchingParams.chamfer.backgroundPenalty" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Bidirectional</span>
                  <input v-model.number="matchingParams.chamfer.bidirectionalWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
              <div class="image-control-row">
                <label class="image-control-field">
                  <span>Edge Threshold</span>
                  <input v-model.number="matchingParams.chamfer.edgeThreshold" type="number" min="0" max="255" step="1" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Dilation</span>
                  <input v-model.number="matchingParams.chamfer.dilationRadius" type="number" min="0" max="4" step="1" @input="invalidateMatchResult" />
                </label>
              </div>
            </div>
            <div v-else-if="matchingMethod === 'edge-correlation'" class="image-match-param-panel">
              <div class="image-control-row">
                <label class="image-control-field">
                  <span>Edge Kernel</span>
                  <select v-model="matchingParams.edgeCorrelation.edgeMode" @change="invalidateMatchResult">
                    <option value="sobel">Sobel</option>
                    <option value="laplacian">Laplacian</option>
                  </select>
                </label>
                <label class="image-control-field">
                  <span>Threshold</span>
                  <input v-model.number="matchingParams.edgeCorrelation.threshold" type="number" min="0" max="255" step="1" @input="invalidateMatchResult" />
                </label>
              </div>
              <div class="image-control-row image-control-row--three">
                <label class="image-control-field">
                  <span>Correlation</span>
                  <input v-model.number="matchingParams.edgeCorrelation.correlationWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Difference</span>
                  <input v-model.number="matchingParams.edgeCorrelation.differenceWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Gradient</span>
                  <input v-model.number="matchingParams.edgeCorrelation.gradientWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
              <label class="image-control-field">
                <span>Threshold Penalty</span>
                <input v-model.number="matchingParams.edgeCorrelation.thresholdPenaltyWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
              </label>
            </div>
            <div v-else-if="matchingMethod === 'template'" class="image-match-param-panel">
              <label class="image-control-field">
                <span>Mode</span>
                <select v-model="matchingParams.template.mode" @change="invalidateMatchResult">
                  <option value="ccoeff-normed">CCOEFF Normed</option>
                  <option value="ccorr-normed">CCORR Normed</option>
                  <option value="sqdiff-normed">SQDIFF Normed</option>
                </select>
              </label>
              <div class="image-control-row image-control-row--three">
                <label class="image-control-field">
                  <span>Correlation</span>
                  <input v-model.number="matchingParams.template.correlationWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Difference</span>
                  <input v-model.number="matchingParams.template.differenceWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Density</span>
                  <input v-model.number="matchingParams.template.densityWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
            </div>
            <div v-else-if="matchingMethod === 'contour-shape'" class="image-match-param-panel">
              <div class="image-control-row">
                <label class="image-control-field">
                  <span>Method</span>
                  <select v-model="matchingParams.contourShape.method" @change="invalidateMatchResult">
                    <option value="i1">I1</option>
                    <option value="i2">I2</option>
                    <option value="i3">I3</option>
                  </select>
                </label>
                <label class="image-control-field">
                  <span>Contour Threshold</span>
                  <input v-model.number="matchingParams.contourShape.contourThreshold" type="number" min="0" max="255" step="1" @input="invalidateMatchResult" />
                </label>
              </div>
              <div class="image-control-row image-control-row--three">
                <label class="image-control-field">
                  <span>Shape</span>
                  <input v-model.number="matchingParams.contourShape.shapeWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Area</span>
                  <input v-model.number="matchingParams.contourShape.areaWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
                <label class="image-control-field">
                  <span>Centroid</span>
                  <input v-model.number="matchingParams.contourShape.centroidWeight" type="number" min="0" max="10" step="0.05" @input="invalidateMatchResult" />
                </label>
              </div>
              <label class="image-control-field">
                <span>Empty Penalty</span>
                <input v-model.number="matchingParams.contourShape.emptyPenalty" type="number" min="0" max="100" step="1" @input="invalidateMatchResult" />
              </label>
            </div>
            <hr class="image-match-divider" />
            <div class="image-control-row">
              <label class="image-control-field">
                <span>Difference Threshold</span>
                <input v-model.number="differenceThreshold" type="number" min="0" max="100" step="1" @input="invalidateMatchResult" />
              </label>
              <label class="image-control-field">
                <span>Worker</span>
                <input :value="workerSetting" type="text" list="image-to-aa-worker-options" @input="updateWorkerSetting(readStringFromEvent($event))" />
                <datalist id="image-to-aa-worker-options">
                  <option value="Auto"></option>
                  <option value="1"></option>
                  <option value="2"></option>
                  <option value="3"></option>
                  <option value="4"></option>
                  <option value="8"></option>
                </datalist>
              </label>
            </div>
            <span class="image-edge-status">{{ matchProgressText }}</span>
            <button type="button" class="image-action-button" :disabled="!canRunMatching" @click="isMatching ? stopMatching() : regenerateMatch()">
              {{ isMatching ? "Cancel Matching" : "Regenerate" }}
            </button>
          </section>
        </aside>
      </div>

      <footer class="image-to-aa-actions">
        <label class="image-check-field image-footer-check">
          <input v-model="isGridVisible" type="checkbox" />
          <span>Grid</span>
        </label>
        <div class="image-footer-center">
          <button type="button" class="image-footer-clear-button" :disabled="!hasMatchOverlay" @click="clearMatchResult">Clear Preview</button>
        </div>
        <div class="image-footer-buttons">
          <button type="button" @click="requestCloseImageToAsciiModal">Cancel</button>
          <button type="button" :disabled="!canApplyMatch" @click="applyMatchResult">Apply</button>
        </div>
      </footer>

      <div v-if="isMatchingSettingsOpen" class="image-settings-modal-backdrop" role="presentation" @click.self="isMatchingSettingsOpen = false">
        <section
          class="image-settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="image-to-aa-settings-title"
          @pointerdown.stop
          @contextmenu.prevent.stop
        >
          <header class="image-settings-modal-header">
            <h3 id="image-to-aa-settings-title">Image to AA Settings</h3>
            <button type="button" aria-label="Close settings" @click="isMatchingSettingsOpen = false">&times;</button>
          </header>
          <div class="image-settings-modal-body">
            <label class="image-control-field">
              <span>Font Family</span>
              <input
                type="text"
                :placeholder="getMatchFontFamilyFromCss()"
                :value="matchFontFamily"
                @input="updateMatchFontFamily(($event.target as HTMLInputElement).value)"
              />
            </label>
            <label class="image-control-field">
              <span>Width Mode</span>
              <select :value="matchingWidthMode" @change="updateMatchingWidthMode(readStringFromEvent($event))">
                <option value="auto">Auto (File menu: {{ props.widthMode === "terminal" ? "Terminal" : "Web" }})</option>
                <option value="web">Web</option>
                <option value="terminal">Terminal</option>
              </select>
            </label>
            <fieldset class="image-radio-group image-radio-group--samples">
              <legend>Comparison glyph sample</legend>
              <label class="image-glyph-sample-option">
                <input
                  type="radio"
                  name="image-to-aa-glyph-polarity"
                  value="auto"
                  :checked="glyphPolarity === 'auto'"
                  @change="updateGlyphPolarity('auto')"
                />
                <span class="image-glyph-sample-label">Auto</span>
                <span class="image-glyph-sample image-glyph-sample--auto">Detect from current image background</span>
              </label>
              <label class="image-glyph-sample-option">
                <input
                  type="radio"
                  name="image-to-aa-glyph-polarity"
                  value="white-on-black"
                  :checked="glyphPolarity === 'white-on-black'"
                  @change="updateGlyphPolarity('white-on-black')"
                />
                <span class="image-glyph-sample-label">White text / Black background</span>
                <span class="image-glyph-sample image-glyph-sample--white-on-black" :style="{ fontFamily: effectiveMatchFontFamily }"> ABCDEFG0123</span>
              </label>
              <label class="image-glyph-sample-option">
                <input
                  type="radio"
                  name="image-to-aa-glyph-polarity"
                  value="black-on-white"
                  :checked="glyphPolarity === 'black-on-white'"
                  @change="updateGlyphPolarity('black-on-white')"
                />
                <span class="image-glyph-sample-label">Black text / White background</span>
                <span class="image-glyph-sample image-glyph-sample--black-on-white" :style="{ fontFamily: effectiveMatchFontFamily }"> ABCDEFG0123</span>
              </label>
            </fieldset>
            <span class="image-auto-detection-status">{{ autoDetectionText }}</span>
            <button type="button" class="image-action-button" :disabled="!canBuildGlyphCache" @click="buildGlyphCache">
              {{ isBuildingGlyphCache ? "Building Glyph Cache..." : "Build Glyph Cache" }}
            </button>
            <span class="image-edge-status">{{ glyphCacheStatus }}</span>
          </div>
        </section>
      </div>

      <ConfirmModal
        v-if="isCloseConfirmOpen"
        message="Discard current changes and close Image to AA?"
        cancel-label="Keep Editing"
        confirm-label="Discard"
        @confirm="confirmCloseImageToAsciiModal"
        @cancel="cancelCloseImageToAsciiModal"
      />
    </section>
  </div>
</template>
