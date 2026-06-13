<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import settingsIcon from "../assets/icons/settings.svg?raw";
import unicodeGlyphPages from "../data/static/unicode-glyph-pages.json";
import type { WidthMode } from "../model/widthMode";
import { startImageToAsciiGlyphCacheBuild, startImageToAsciiMatching } from "../search/imageToAsciiMatching";
import type {
  ImageToAsciiApplyGrid,
  ImageToAsciiCellUpdate,
  ImageToAsciiGlyphCacheSummary,
  ImageToAsciiGlyphPolarity,
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
const halfMatchCells = ref<(StageMatchCell | null)[]>(createEmptyStageCells());
const fullMatchCells = ref<(StageMatchCell | null)[]>(createEmptyStageCells());
const processingCell = ref<ImageToAsciiProcessingCell | null>(null);
let matchHandle: ImageToAsciiMatchHandle | null = null;
let glyphCacheBuildHandle: ImageToAsciiMatchHandle | null = null;
let matchRequestToken = 0;
let glyphCacheBuildToken = 0;

const statusText = computed(() => {
  if (loadError.value) {
    return loadError.value;
  }

  if (isMatching.value) {
    return `Matching: ${matchStatus.value}`;
  }

  if (sourceImageUrl.value) {
    return `Loaded: ${sourceFileName.value} (${sourceNaturalWidth.value}x${sourceNaturalHeight.value}). ${matchStatus.value}`;
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

const edgeStatusText = computed(() => {
  if (processedImageUrl.value) {
    return `${edgeMode.value} edge applied`;
  }

  if (edgeMode.value === "Off") {
    return "Edge processing is off";
  }

  return "Apply Edge to update preview";
});
const visibleHalfMatchCells = computed(() => halfMatchCells.value.filter(isStageMatchCell));
const visibleFullMatchCells = computed(() => fullMatchCells.value.filter(isStageMatchCell));
const processingCellStyle = computed(() => (processingCell.value ? getStageCellStyle(processingCell.value) : {}));
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

function resolveGlyphPolarity(luminance: Uint8ClampedArray | null) {
  if (glyphPolarity.value !== "auto") {
    resolvedGlyphPolarity.value = glyphPolarity.value;
    autoDetectedGlyphPolarity.value = null;
    return glyphPolarity.value;
  }

  const resolved = luminance ? detectGlyphPolarityFromLuminance(luminance) : DEFAULT_GLYPH_POLARITY;
  resolvedGlyphPolarity.value = resolved;
  autoDetectedGlyphPolarity.value = luminance ? resolved : null;
  return resolved;
}

function isGlyphPreparationPhase(phase: ImageToAsciiMatchProgress["phase"]) {
  return phase === "load-cache" || phase === "index-half" || phase === "index-full" || phase === "save-cache";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  clearMatchResult();
}

function updateMatchFontFamily(value: string) {
  matchFontFamily.value = value;
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  clearMatchResult();
}

function updateMatchingWidthMode(value: string) {
  matchingWidthMode.value = value === "web" || value === "terminal" ? value : "auto";
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  clearMatchResult();
}

function updateGlyphPolarity(value: GlyphPolaritySetting) {
  glyphPolarity.value = value;
  resolvedGlyphPolarity.value = value === "auto" ? DEFAULT_GLYPH_POLARITY : value;
  autoDetectedGlyphPolarity.value = null;
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  clearMatchResult();
}

function updateColorEmojiExclusion(value: boolean) {
  isColorEmojiExcluded.value = value;
  glyphCacheSummary.value = null;
  glyphCacheStatus.value = "Glyph cache setting changed";
  clearMatchResult();
}

function cancelMatching() {
  matchRequestToken += 1;
  matchHandle?.cancel();
  matchHandle = null;
  isMatching.value = false;
  matchProgress.value = null;
  processingCell.value = null;
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
  processingCell.value = null;
}

function clearMatchResult() {
  cancelMatching();
  matchResult.value = null;
  autoDetectedGlyphPolarity.value = null;
  clearMatchLayers();
  matchStatus.value = sourceImageUrl.value ? "Regenerate to update preview" : "Load image to match";

  if (sourceImageUrl.value) {
    loadError.value = "";
  }
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

function clearAppliedEdge() {
  processedImageUrl.value = null;
  clearMatchResult();
}

function isMacPlatform() {
  return typeof navigator !== "undefined" && (navigator.platform || "").toLowerCase().includes("mac");
}

function isRotationWheelEvent(event: WheelEvent) {
  return isMacPlatform() ? event.metaKey : event.ctrlKey;
}

function updateEdgeMode(value: string) {
  edgeMode.value = value as EdgeMode;
  clearAppliedEdge();
}

function openFilePicker() {
  fileInputRef.value?.click();
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (file) {
    void loadImageFile(file);
  }

  input.value = "";
}

function handleModalDragEnter() {
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

  const file = Array.from(event.dataTransfer?.files ?? []).find((item) => item.type.startsWith("image/"));

  if (!file) {
    loadError.value = "画像ファイルをドロップしてください。";
    return;
  }

  void loadImageFile(file);
}

async function loadImageFile(file: File) {
  if (!file.type.startsWith("image/")) {
    loadError.value = "画像ファイルを選択してください。";
    return;
  }

  const nextUrl = URL.createObjectURL(file);

  try {
    const size = await readImageSize(nextUrl);
    revokeSourceImageUrl();
    sourceImageUrl.value = nextUrl;
    sourceFileName.value = file.name;
    sourceNaturalWidth.value = size.width;
    sourceNaturalHeight.value = size.height;
    loadError.value = "";
    clearAppliedEdge();
    resetTransformForImage(size.width, size.height);
  } catch {
    URL.revokeObjectURL(nextUrl);
    loadError.value = "画像を読み込めませんでした。";
  }
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
  if (Number.isFinite(value)) {
    clearAppliedEdge();
    transform.scale = Number(clamp(value, SCALE_MIN, SCALE_MAX).toFixed(2));
  }
}

function updateRotation(value: number) {
  if (Number.isFinite(value)) {
    clearAppliedEdge();
    transform.rotation = Number(clamp(value, ROTATION_MIN, ROTATION_MAX).toFixed(1));
  }
}

function updatePositionX(value: number) {
  if (Number.isFinite(value)) {
    clearAppliedEdge();
    transform.x = Math.round(value);
  }
}

function updatePositionY(value: number) {
  if (Number.isFinite(value)) {
    clearAppliedEdge();
    transform.y = Math.round(value);
  }
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

  cancelMatching();
  matchResult.value = null;
  clearMatchLayers();
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
        onProcessingCell(cell) {
          if (token !== matchRequestToken) {
            return;
          }

          processingCell.value = cell;
        },
        onResult(result) {
          if (token !== matchRequestToken) {
            return;
          }

          matchHandle = null;
          isMatching.value = false;
          matchProgress.value = null;
          processingCell.value = null;
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
          processingCell.value = null;
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
    processingCell.value = null;
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
    clearAppliedEdge();
    return;
  }

  clearMatchResult();
  const image = await loadImageElement(sourceImageUrl.value);
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_WIDTH;
  canvas.height = TARGET_HEIGHT;

  const context = canvas.getContext("2d");

  if (!context) {
    loadError.value = "画像加工に失敗しました。";
    return;
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
}

function beginStageDrag(event: PointerEvent) {
  if (!sourceImageUrl.value || event.button !== 0) {
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

  if (nextX !== transform.x || nextY !== transform.y) {
    clearAppliedEdge();
    transform.x = nextX;
    transform.y = nextY;
  }
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
  emit("close");
}

onMounted(() => {
  stageRef.value?.addEventListener("wheel", handleStageWheel, { passive: false });
});

onBeforeUnmount(() => {
  cancelMatching();
  cancelGlyphCacheBuild();
  stageRef.value?.removeEventListener("wheel", handleStageWheel);
  revokeSourceImageUrl();
});
</script>

<template>
  <div class="confirm-modal-backdrop image-to-aa-backdrop" role="presentation" @click.self="emit('close')">
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
          <button type="button" aria-label="Close" @click="emit('close')">&times;</button>
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
            <div v-if="isGridVisible" class="image-grid-overlay" aria-hidden="true"></div>
            <div v-if="processingCell" class="image-processing-cell" :style="processingCellStyle" aria-hidden="true"></div>
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
          <button type="button" class="image-load-button" @click="openFilePicker">Load Image</button>
          <input ref="fileInputRef" class="hidden-file-input" type="file" accept="image/*" @change="handleFileInput" />

          <section class="image-control-group">
            <h3>Transform</h3>
            <label class="image-control-field">
              <span>Scale</span>
              <div class="image-control-inline">
                <input type="range" min="0.1" max="4" step="0.01" :value="transform.scale" @input="updateScale(readNumberFromEvent($event))" />
                <input class="image-number-input" type="number" min="0.1" max="4" step="0.1" :value="scaleText" @input="updateScale(readNumberFromEvent($event))" />
              </div>
            </label>
            <label class="image-control-field">
              <span>Rotation</span>
              <div class="image-control-inline">
                <input type="range" min="-180" max="180" step="1" :value="transform.rotation" @input="updateRotation(readNumberFromEvent($event))" />
                <input class="image-number-input" type="number" min="-180" max="180" step="1" :value="rotationText" @input="updateRotation(readNumberFromEvent($event))" />
              </div>
            </label>
            <div class="image-control-row">
              <label class="image-control-field">
                <span>X</span>
                <input type="number" step="1" :value="positionXText" @input="updatePositionX(readNumberFromEvent($event))" />
              </label>
              <label class="image-control-field">
                <span>Y</span>
                <input type="number" step="1" :value="positionYText" @input="updatePositionY(readNumberFromEvent($event))" />
              </label>
            </div>
          </section>

          <section class="image-control-group">
            <h3>Processing</h3>
            <label class="image-check-field">
              <input v-model="isMonochromeEnabled" type="checkbox" @change="clearAppliedEdge" />
              <span>Monochrome</span>
            </label>
            <label class="image-control-field">
              <span>Contrast</span>
              <input v-model.number="contrast" type="range" min="0" max="200" @input="clearAppliedEdge" />
            </label>
            <label class="image-check-field">
              <input v-model="isInverted" type="checkbox" @change="clearAppliedEdge" />
              <span>Invert</span>
            </label>
            <div class="image-edge-mode-row">
              <label class="image-control-field">
                <span>Edge Mode</span>
                <select :value="edgeMode" @change="updateEdgeMode(readStringFromEvent($event))">
                  <option>Off</option>
                  <option>Sobel</option>
                  <option>Laplacian</option>
                  <option>Canny-like</option>
                </select>
              </label>
              <button type="button" class="image-action-button" :disabled="!sourceImageUrl || edgeMode === 'Off'" @click="applyEdgeMode">Apply Edge</button>
            </div>
            <label v-if="edgeMode === 'Sobel'" class="image-control-field">
              <span>Sobel Threshold</span>
              <input v-model.number="sobelThreshold" type="number" min="0" max="255" step="1" @input="clearAppliedEdge" />
            </label>
            <label v-else-if="edgeMode === 'Laplacian'" class="image-control-field">
              <span>Laplacian Threshold</span>
              <input v-model.number="laplacianThreshold" type="number" min="0" max="255" step="1" @input="clearAppliedEdge" />
            </label>
            <div v-else-if="edgeMode === 'Canny-like'" class="image-control-row image-control-row--three">
              <label class="image-control-field">
                <span>Blur</span>
                <input v-model.number="cannyBlur" type="number" min="0" max="8" step="1" @input="clearAppliedEdge" />
              </label>
              <label class="image-control-field">
                <span>Low</span>
                <input v-model.number="cannyLowThreshold" type="number" min="0" max="255" step="1" @input="clearAppliedEdge" />
              </label>
              <label class="image-control-field">
                <span>High</span>
                <input v-model.number="cannyHighThreshold" type="number" min="0" max="255" step="1" @input="clearAppliedEdge" />
              </label>
            </div>
            <span class="image-edge-status">{{ edgeStatusText }}</span>
          </section>

          <section class="image-control-group">
            <h3>Matching</h3>
            <label class="image-check-field">
              <input v-model="isFullWidthMatchingEnabled" type="checkbox" @change="clearMatchResult" />
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
            <div class="image-control-row">
              <label class="image-control-field">
                <span>Difference Threshold</span>
                <input v-model.number="differenceThreshold" type="number" min="0" max="100" step="1" @input="clearMatchResult" />
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
            <button type="button" class="image-action-button" :disabled="!sourceImageUrl || isBuildingGlyphCache" @click="isMatching ? stopMatching() : regenerateMatch()">
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
        <div class="image-footer-buttons">
          <button type="button" @click="emit('close')">Cancel</button>
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
    </section>
  </div>
</template>
