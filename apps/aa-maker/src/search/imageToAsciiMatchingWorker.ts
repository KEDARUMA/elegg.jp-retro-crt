import { getTerminalCharWidth, type WidthMode } from "../model/widthMode";
import { clamp } from "../utils/clamp";
import { getContourShapeScore as getSharedContourShapeScore } from "./contourShape";
import type {
  ImageToAsciiApplyCell,
  ImageToAsciiCellUpdate,
  ImageToAsciiGlyphPolarity,
  ImageToAsciiGlyphCacheSummary,
  ImageToAsciiMatchingLibraryName,
  ImageToAsciiMatchingLibraryStatus,
  ImageToAsciiMatchingMethod,
  ImageToAsciiMatchingParams,
  ImageToAsciiMatchProgress,
  ImageToAsciiMatchRangeResult,
  ImageToAsciiMatchResult,
  ImageToAsciiMatchRowResult,
  ImageToAsciiProcessingCell,
} from "./imageToAsciiMatching";
import type { UnicodeGlyphPageData } from "./similarGlyphSearch";

type WorkerRequest =
  | (BaseWorkerRequest &
      (
        | {
            kind: "match";
            imageAlpha: Uint8ClampedArray;
            threshold: number;
            includeFullWidth: boolean;
            matchingMethod: ImageToAsciiMatchingMethod;
            matchingParams: ImageToAsciiMatchingParams;
          }
        | {
            kind: "match-range";
            imageAlpha: Uint8ClampedArray;
            threshold: number;
            includeFullWidth: boolean;
            matchingMethod: ImageToAsciiMatchingMethod;
            matchingParams: ImageToAsciiMatchingParams;
            rowStart: number;
            rowEnd: number;
          }
        | {
            kind: "build-cache" | "prepare-cache";
          }
      ))
  | {
      id: number;
      kind: "preload-library";
      matchingMethod: ImageToAsciiMatchingMethod;
    };

type BaseWorkerRequest = {
  id: number;
  pageData: UnicodeGlyphPageData;
  fontFamily: string;
  glyphPolarity: ImageToAsciiGlyphPolarity;
  excludeColorEmoji: boolean;
  widthMode: WidthMode;
};

type WorkerMessage =
  | {
      type: "progress";
      id: number;
      progress: ImageToAsciiMatchProgress;
    }
  | {
      type: "cell";
      id: number;
      update: ImageToAsciiCellUpdate;
    }
  | {
      type: "processing-cell";
      id: number;
      cell: ImageToAsciiProcessingCell | null;
    }
  | {
      type: "result";
      id: number;
      result: ImageToAsciiMatchResult;
    }
  | {
      type: "range-result";
      id: number;
      result: ImageToAsciiMatchRangeResult;
    }
  | {
      type: "cache-built";
      id: number;
      summary: ImageToAsciiGlyphCacheSummary;
    }
  | {
      type: "library-ready";
      id: number;
      status: ImageToAsciiMatchingLibraryStatus;
    }
  | {
      type: "error";
      id: number;
      message: string;
    };

type WorkerScope = typeof globalThis & {
  postMessage: (message: WorkerMessage) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

type GlyphCandidate = {
  char: string;
  codePoint: number;
  width: 1 | 2;
  alpha: Uint8ClampedArray;
  features: Uint8ClampedArray;
  density: number;
  bin: number;
};

type CandidateIndex = {
  candidates: GlyphCandidate[];
  buckets: GlyphCandidate[][];
  blank: GlyphCandidate;
};

type CandidateIndexes = {
  halfIndex: CandidateIndex;
  fullIndex: CandidateIndex;
};

type SerializedCandidateSet = {
  width: 1 | 2;
  count: number;
  pixelLength: number;
  featureLength: number;
  chars: string[];
  codePoints: Uint32Array;
  alpha: Uint8ClampedArray;
  features: Uint8ClampedArray;
  densities: Float32Array;
  bins: Uint8Array;
};

type SerializedGlyphCache = {
  key: string;
  cacheVersion: 1;
  createdAt: number;
  fontFamily: string;
  glyphPolarity: ImageToAsciiGlyphPolarity;
  excludeColorEmoji: boolean;
  widthMode: WidthMode;
  pageVersion: string;
  half: SerializedCandidateSet;
  full: SerializedCandidateSet;
};

type TilePattern = {
  alpha: Uint8ClampedArray;
  features: Uint8ClampedArray;
  density: number;
  width: number;
  height: number;
};

type RenderedGlyphImage = {
  alpha: Uint8ClampedArray;
  hasColorPixel: boolean;
};

type MatchCell = ImageToAsciiApplyCell & {
  score: number;
};

type PixelmatchFunction = (
  img1: Uint8Array | Uint8ClampedArray,
  img2: Uint8Array | Uint8ClampedArray,
  output: Uint8Array | Uint8ClampedArray | undefined,
  width: number,
  height: number,
  options?: {
    threshold?: number;
    includeAA?: boolean;
    alpha?: number;
    diffMask?: boolean;
  },
) => number;

type OpenCvModule = Record<string, unknown> & {
  onRuntimeInitialized?: () => void;
};

type GradientFeatures = {
  magnitudes: Float32Array;
  angles: Float32Array;
  totalMagnitude: number;
};

type ScoreContext = {
  method: ImageToAsciiMatchingMethod;
  params: ImageToAsciiMatchingParams;
  glyphPolarity: ImageToAsciiGlyphPolarity;
  pixelmatch?: PixelmatchFunction;
  opencv?: OpenCvModule;
  rgbaCache: WeakMap<Uint8ClampedArray, Uint8ClampedArray>;
  distanceCache: WeakMap<Uint8ClampedArray, Float32Array>;
  gradientCache: WeakMap<Uint8ClampedArray, GradientFeatures>;
};

const workerScope = self as unknown as WorkerScope;
const TARGET_WIDTH = 640;
const TARGET_HEIGHT = 400;
const GRID_COLUMNS = 80;
const GRID_ROWS = 25;
const HALF_CELL_WIDTH = 8;
const FULL_CELL_WIDTH = 16;
const CELL_HEIGHT = 16;
const DENSITY_BIN_SIZE = 8;
const DENSITY_BIN_COUNT = Math.ceil(256 / DENSITY_BIN_SIZE);
const FEATURE_COLUMNS_HALF = 4;
const FEATURE_COLUMNS_FULL = 8;
const FEATURE_ROWS = 8;
const SHORTLIST_LIMIT = 32;
const MIN_POOL_SIZE = 128;
const FALLBACK_SAMPLE_CODE_POINTS = [0xfffd, 0x10ffff, 0xe0000];
const COLOR_PIXEL_ALPHA_THRESHOLD = 12;
const COLOR_PIXEL_CHANNEL_DELTA = 8;
const PROGRESS_CODEPOINT_INTERVAL = 1024;
const PROGRESS_CELL_INTERVAL = 64;
const GLYPH_CACHE_DB_NAME = "aa-maker-image-to-aa";
const GLYPH_CACHE_DB_VERSION = 1;
const GLYPH_CACHE_STORE_NAME = "glyph-caches";
const GLYPH_CACHE_VERSION = 1;

workerScope.onmessage = (event) => {
  try {
    void handleRequest(event.data);
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id: event.data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

async function handleRequest(request: WorkerRequest) {
  try {
    if (request.kind === "preload-library") {
      const status = await preloadMatchingLibrary(request.id, request.matchingMethod);
      workerScope.postMessage({ type: "library-ready", id: request.id, status });
      return;
    }

    if (request.kind === "build-cache" || request.kind === "prepare-cache") {
      const indexes = await getCandidateIndexes(request, request.kind === "build-cache");
      workerScope.postMessage({
        type: "cache-built",
        id: request.id,
        summary: {
          halfCount: indexes.halfIndex.candidates.length - 1,
          fullCount: indexes.fullIndex.candidates.length - 1,
        },
      });
      return;
    }

    if (request.kind === "match-range") {
      try {
        const result = await matchImageRangeToAscii(request, request.rowStart, request.rowEnd);
        workerScope.postMessage({ type: "range-result", id: request.id, result });
      } finally {
        postProcessingCell(request.id, null);
      }
      return;
    }

    try {
      const result = await matchImageToAscii(request);
      workerScope.postMessage({ type: "result", id: request.id, result });
    } finally {
      postProcessingCell(request.id, null);
    }
  } catch (error) {
    workerScope.postMessage({
      type: "error",
      id: request.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function matchImageToAscii(request: Extract<WorkerRequest, { kind: "match" }>): Promise<ImageToAsciiMatchResult> {
  const rangeResult = await matchImageRangeToAscii(request, 0, GRID_ROWS);

  return {
    halfText: rangeResult.rows.map((row) => row.halfText).join("\n"),
    fullText: rangeResult.rows.map((row) => row.fullText).join("\n"),
    compositeText: rangeResult.rows.map((row) => row.compositeText).join("\n"),
    cells: rangeResult.rows.map((row) => row.cells),
    matchedHalfCount: rangeResult.matchedHalfCount,
    matchedFullCount: rangeResult.matchedFullCount,
    averageScore: Math.round((rangeResult.scoreTotal / (GRID_COLUMNS * GRID_ROWS)) * 100) / 100,
  };
}

async function matchImageRangeToAscii(
  request: Extract<WorkerRequest, { kind: "match" }> | Extract<WorkerRequest, { kind: "match-range" }>,
  rowStart: number,
  rowEnd: number,
): Promise<ImageToAsciiMatchRangeResult> {
  if (request.imageAlpha.length !== TARGET_WIDTH * TARGET_HEIGHT) {
    throw new Error("Image to AA matching failed: unexpected image buffer size.");
  }

  const safeRowStart = Math.max(0, Math.min(GRID_ROWS, Math.floor(rowStart)));
  const safeRowEnd = Math.max(safeRowStart, Math.min(GRID_ROWS, Math.ceil(rowEnd)));
  const rowCount = safeRowEnd - safeRowStart;
  const scoreContext = await createScoreContext(request);
  const { halfIndex, fullIndex } = await getCandidateIndexes(request, false);
  const checkedCodePointCount = countPresentCodePoints(request.pageData);
  const totalCodePointCount = checkedCodePointCount;

  const halfCells: MatchCell[] = Array.from({ length: rowCount * GRID_COLUMNS }, () => ({ char: " ", width: 1, score: 0 }));
  const halfScores = new Float32Array(rowCount * GRID_COLUMNS);
  let matchedHalfCount = 0;
  let scoreTotal = 0;

  for (let y = safeRowStart; y < safeRowEnd; y += 1) {
    const localRow = y - safeRowStart;

    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      const index = localRow * GRID_COLUMNS + x;
      const progressCellCount = localRow * GRID_COLUMNS + x + 1;
      postProcessingCellStart(request.id, { phase: "match-half", x, y, width: 1 });

      const tile = createTilePattern(request.imageAlpha, x * HALF_CELL_WIDTH, y * CELL_HEIGHT, HALF_CELL_WIDTH, CELL_HEIGHT, FEATURE_COLUMNS_HALF);
      const match = findBestCandidate(tile, halfIndex, request.threshold, scoreContext);

      halfCells[index] = match.score <= request.threshold ? match : { char: " ", width: 1, score: match.score };
      halfScores[index] = match.score;
      scoreTotal += match.score;
      postCellUpdate(request.id, {
        layer: "half",
        x,
        y,
        cell: halfCells[index],
      });

      if (halfCells[index].char !== " ") {
        matchedHalfCount += 1;
      }

      if (progressCellCount % PROGRESS_CELL_INTERVAL === 0) {
        postProgress(request.id, {
          phase: "match-half",
          checkedCodePointCount,
          totalCodePointCount,
          matchedCellCount: progressCellCount,
          totalCellCount: GRID_COLUMNS * rowCount,
        });
      }
    }
  }

  postProgress(request.id, {
    phase: "match-half",
    checkedCodePointCount,
    totalCodePointCount,
    matchedCellCount: GRID_COLUMNS * rowCount,
    totalCellCount: GRID_COLUMNS * rowCount,
  });

  const fullHeads: (MatchCell | null)[] = Array.from({ length: rowCount * GRID_COLUMNS }, () => null);
  let matchedFullCount = 0;

  if (request.includeFullWidth && fullIndex.candidates.length > 1) {
    for (let y = safeRowStart; y < safeRowEnd; y += 1) {
      const localRow = y - safeRowStart;

      for (let x = 0; x < GRID_COLUMNS - 1; x += 1) {
        const linearIndex = localRow * GRID_COLUMNS + x;
        const progressCellCount = localRow * (GRID_COLUMNS - 1) + x + 1;
        postProcessingCellStart(request.id, { phase: "match-full", x, y, width: 2 });

        const tile = createTilePattern(request.imageAlpha, x * HALF_CELL_WIDTH, y * CELL_HEIGHT, FULL_CELL_WIDTH, CELL_HEIGHT, FEATURE_COLUMNS_FULL);
        const match = findBestCandidate(tile, fullIndex, request.threshold, scoreContext);
        const halfAverage = (halfScores[linearIndex] + halfScores[linearIndex + 1]) / 2;

        if (match.char === " " || match.score > request.threshold || match.score >= halfAverage) {
          postFullProgressIfNeeded(request.id, checkedCodePointCount, totalCodePointCount, progressCellCount, rowCount * (GRID_COLUMNS - 1));
          continue;
        }

        const leftFull = x > 0 ? fullHeads[linearIndex - 1] : null;

        if (leftFull && leftFull.score <= match.score) {
          postFullProgressIfNeeded(request.id, checkedCodePointCount, totalCodePointCount, progressCellCount, rowCount * (GRID_COLUMNS - 1));
          continue;
        }

        if (leftFull) {
          fullHeads[linearIndex - 1] = null;
          matchedFullCount -= 1;
          postCellUpdate(request.id, {
            layer: "full",
            x: x - 1,
            y,
            cell: null,
          });
        }

        fullHeads[linearIndex] = match;
        matchedFullCount += 1;
        postCellUpdate(request.id, {
          layer: "full",
          x,
          y,
          cell: match,
        });

        postFullProgressIfNeeded(request.id, checkedCodePointCount, totalCodePointCount, progressCellCount, rowCount * (GRID_COLUMNS - 1));
      }
    }

    postProgress(request.id, {
      phase: "match-full",
      checkedCodePointCount,
      totalCodePointCount,
      matchedCellCount: rowCount * (GRID_COLUMNS - 1),
      totalCellCount: rowCount * (GRID_COLUMNS - 1),
    });
  }

  const rows: ImageToAsciiMatchRowResult[] = [];

  for (let y = safeRowStart; y < safeRowEnd; y += 1) {
    const localRow = y - safeRowStart;
    const row: (ImageToAsciiApplyCell | null)[] = [];
    let halfLine = "";
    let fullLine = "";
    let compositeLine = "";

    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      const index = localRow * GRID_COLUMNS + x;
      const full = fullHeads[index];
      const isFullTail = x > 0 && fullHeads[index - 1] !== null;
      const half = halfCells[index];

      halfLine += half.char;

      if (full) {
        row.push({ char: full.char, width: 2 });
        fullLine += full.char;
        compositeLine += full.char;
        x += 1;
        row.push(null);
        halfLine += halfCells[index + 1]?.char ?? " ";
        continue;
      }

      if (isFullTail) {
        row.push(null);
        continue;
      }

      row.push(half.char === " " ? null : { char: half.char, width: 1 });
      fullLine += " ";
      compositeLine += half.char;
    }

    rows.push({
      y,
      cells: row,
      halfText: halfLine,
      fullText: fullLine,
      compositeText: compositeLine,
    });
  }

  return {
    rowStart: safeRowStart,
    rowEnd: safeRowEnd,
    rows,
    matchedHalfCount,
    matchedFullCount,
    scoreTotal,
  };
}

async function getCandidateIndexes(request: BaseWorkerRequest, forceRebuild: boolean): Promise<CandidateIndexes> {
  const cacheKey = getGlyphCacheKey(request);

  if (!forceRebuild) {
    const cached = await loadSerializedGlyphCache(cacheKey, request.id);

    if (cached) {
      postProgress(request.id, {
        phase: "load-cache",
        checkedCodePointCount: 1,
        totalCodePointCount: 1,
        matchedCellCount: 0,
        totalCellCount: GRID_COLUMNS * GRID_ROWS,
      });

      try {
        return deserializeGlyphCache(cached, request.glyphPolarity);
      } catch {
        // 壊れたキャッシュは破棄扱いにして再生成する。
      }
    }
  }

  const indexes = buildCandidateIndexes(request);
  await saveSerializedGlyphCache(serializeGlyphCache(cacheKey, request, indexes), request.id);
  return indexes;
}

function buildCandidateIndexes(request: BaseWorkerRequest): CandidateIndexes {
  const totalCodePointCount = countPresentCodePoints(request.pageData);
  const renderer = createGlyphRenderer(request.fontFamily, request.widthMode, request.glyphPolarity, request.excludeColorEmoji);
  const halfIndex = createCandidateIndex(1, request.glyphPolarity);
  const fullIndex = createCandidateIndex(2, request.glyphPolarity);
  let checkedCodePointCount = 0;

  expandPresentPages(request.pageData).forEach((page) => {
    const pageStart = page * request.pageData.pageSize;
    const pageEnd = pageStart + request.pageData.pageSize - 1;
    const codeStart = Math.max(request.pageData.range.start, pageStart);
    const codeEnd = Math.min(request.pageData.range.end, pageEnd);

    for (let codePoint = codeStart; codePoint <= codeEnd; codePoint += 1) {
      checkedCodePointCount += 1;

      if (shouldSkipCodePoint(codePoint)) {
        continue;
      }

      const char = String.fromCodePoint(codePoint);
      const width = renderer.measureWidth(char);

      if (width === 1) {
        const candidate = renderer.renderCandidate(char, codePoint, 1);

        if (candidate) {
          addCandidate(halfIndex, candidate);
        }
      } else {
        const candidate = renderer.renderCandidate(char, codePoint, 2);

        if (candidate) {
          addCandidate(fullIndex, candidate);
        }
      }

      if (checkedCodePointCount % PROGRESS_CODEPOINT_INTERVAL === 0) {
        postProgress(request.id, {
          phase: width === 1 ? "index-half" : "index-full",
          checkedCodePointCount,
          totalCodePointCount,
          matchedCellCount: 0,
          totalCellCount: GRID_COLUMNS * GRID_ROWS,
        });
      }
    }
  });

  postProgress(request.id, {
    phase: "index-full",
    checkedCodePointCount,
    totalCodePointCount,
    matchedCellCount: 0,
    totalCellCount: GRID_COLUMNS * GRID_ROWS,
  });

  return { halfIndex, fullIndex };
}

function createCandidateIndex(width: 1 | 2, glyphPolarity: ImageToAsciiGlyphPolarity): CandidateIndex {
  const blank = createBlankCandidate(width, glyphPolarity);
  const index: CandidateIndex = {
    candidates: [blank],
    buckets: Array.from({ length: DENSITY_BIN_COUNT }, () => []),
    blank,
  };

  addCandidate(index, blank);
  return index;
}

function addCandidate(index: CandidateIndex, candidate: GlyphCandidate) {
  if (candidate !== index.blank || index.candidates[0] !== index.blank) {
    index.candidates.push(candidate);
  }

  index.buckets[candidate.bin]?.push(candidate);
}

function createBlankCandidate(width: 1 | 2, glyphPolarity: ImageToAsciiGlyphPolarity): GlyphCandidate {
  const pixelWidth = width === 1 ? HALF_CELL_WIDTH : FULL_CELL_WIDTH;
  const alpha = new Uint8ClampedArray(pixelWidth * CELL_HEIGHT);

  if (glyphPolarity === "black-on-white") {
    alpha.fill(255);
  }

  return {
    char: " ",
    codePoint: 0x20,
    width,
    alpha,
    features: createFeatures(alpha, pixelWidth, CELL_HEIGHT, width === 1 ? FEATURE_COLUMNS_HALF : FEATURE_COLUMNS_FULL, FEATURE_ROWS),
    density: 0,
    bin: 0,
  };
}

function createGlyphRenderer(fontFamily: string, widthMode: WidthMode, glyphPolarity: ImageToAsciiGlyphPolarity, excludeColorEmoji: boolean) {
  const halfCanvas = new OffscreenCanvas(HALF_CELL_WIDTH, CELL_HEIGHT);
  const fullCanvas = new OffscreenCanvas(FULL_CELL_WIDTH, CELL_HEIGHT);
  const halfContext = halfCanvas.getContext("2d", { willReadFrequently: true });
  const fullContext = fullCanvas.getContext("2d", { willReadFrequently: true });
  const measureCanvas = new OffscreenCanvas(FULL_CELL_WIDTH, CELL_HEIGHT);
  const measureContext = measureCanvas.getContext("2d");

  if (!halfContext || !fullContext || !measureContext) {
    throw new Error("Image to AA matching failed: 2D canvas is not available.");
  }

  const font = `16px ${fontFamily}`;
  setupGlyphContext(halfContext, font);
  setupGlyphContext(fullContext, font);
  measureContext.font = font;

  const halfWidth = measureContext.measureText("A").width;
  const fullWidth = measureContext.measureText("あ").width;
  const fallbackBits = {
    1: new Set(
      FALLBACK_SAMPLE_CODE_POINTS.map((codePoint) => renderGlyphImage(halfContext, String.fromCodePoint(codePoint), HALF_CELL_WIDTH))
        .filter((image): image is RenderedGlyphImage => image !== null)
        .map((image) => createBits(image.alpha)),
    ),
    2: new Set(
      FALLBACK_SAMPLE_CODE_POINTS.map((codePoint) => renderGlyphImage(fullContext, String.fromCodePoint(codePoint), FULL_CELL_WIDTH))
        .filter((image): image is RenderedGlyphImage => image !== null)
        .map((image) => createBits(image.alpha)),
    ),
  };

  return {
    measureWidth(char: string): 1 | 2 {
      if (widthMode === "terminal") {
        return getTerminalCharWidth(char);
      }

      const charWidth = measureContext.measureText(char).width;
      return Math.abs(charWidth - fullWidth) < Math.abs(charWidth - halfWidth) ? 2 : 1;
    },
    renderCandidate(char: string, codePoint: number, width: 1 | 2): GlyphCandidate | null {
      const pixelWidth = width === 1 ? HALF_CELL_WIDTH : FULL_CELL_WIDTH;
      const featureColumns = width === 1 ? FEATURE_COLUMNS_HALF : FEATURE_COLUMNS_FULL;
      const context = width === 1 ? halfContext : fullContext;
      const rendered = renderGlyphImage(context, char, pixelWidth);

      if (!rendered || (excludeColorEmoji && rendered.hasColorPixel) || isFallbackGlyph(rendered.alpha, fallbackBits[width])) {
        return null;
      }

      const alpha = applyGlyphPolarity(rendered.alpha, glyphPolarity);
      const density = getAverageAlpha(alpha);

      return {
        char,
        codePoint,
        width,
        alpha,
        features: createFeatures(alpha, pixelWidth, CELL_HEIGHT, featureColumns, FEATURE_ROWS),
        density,
        bin: getDensityBin(density),
      };
    },
  };
}

function setupGlyphContext(context: OffscreenCanvasRenderingContext2D, font: string) {
  context.font = font;
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
}

function renderGlyphImage(context: OffscreenCanvasRenderingContext2D, char: string, width: number) {
  context.clearRect(0, 0, width, CELL_HEIGHT);
  context.fillText(char, width / 2, CELL_HEIGHT / 2);

  const image = context.getImageData(0, 0, width, CELL_HEIGHT).data;
  const alpha = new Uint8ClampedArray(width * CELL_HEIGHT);
  let hasInk = false;
  let hasColorPixel = false;

  for (let sourceIndex = 0, targetIndex = 0; sourceIndex < image.length; sourceIndex += 4, targetIndex += 1) {
    const red = image[sourceIndex];
    const green = image[sourceIndex + 1];
    const blue = image[sourceIndex + 2];
    const value = image[sourceIndex + 3];
    alpha[targetIndex] = value;

    if (value > COLOR_PIXEL_ALPHA_THRESHOLD) {
      hasInk = true;

      if (Math.max(red, green, blue) - Math.min(red, green, blue) > COLOR_PIXEL_CHANNEL_DELTA) {
        hasColorPixel = true;
      }
    }
  }

  return hasInk ? { alpha, hasColorPixel } : null;
}

function applyGlyphPolarity(rawAlpha: Uint8ClampedArray, glyphPolarity: ImageToAsciiGlyphPolarity) {
  if (glyphPolarity === "white-on-black") {
    return rawAlpha;
  }

  const alpha = new Uint8ClampedArray(rawAlpha.length);

  for (let index = 0; index < rawAlpha.length; index += 1) {
    alpha[index] = 255 - rawAlpha[index];
  }

  return alpha;
}

function createTilePattern(source: Uint8ClampedArray, originX: number, originY: number, width: number, height: number, featureColumns: number): TilePattern {
  const alpha = new Uint8ClampedArray(width * height);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = (originY + y) * TARGET_WIDTH + originX;
    const targetStart = y * width;
    alpha.set(source.subarray(sourceStart, sourceStart + width), targetStart);
  }

  return {
    alpha,
    features: createFeatures(alpha, width, height, featureColumns, FEATURE_ROWS),
    density: getAverageAlpha(alpha),
    width,
    height,
  };
}

function createFeatures(alpha: Uint8ClampedArray, width: number, height: number, columns: number, rows: number) {
  const features = new Uint8ClampedArray(columns * rows);
  const blockWidth = width / columns;
  const blockHeight = height / rows;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const xStart = Math.floor(column * blockWidth);
      const xEnd = Math.max(xStart + 1, Math.floor((column + 1) * blockWidth));
      const yStart = Math.floor(row * blockHeight);
      const yEnd = Math.max(yStart + 1, Math.floor((row + 1) * blockHeight));
      let total = 0;
      let count = 0;

      for (let y = yStart; y < yEnd; y += 1) {
        for (let x = xStart; x < xEnd; x += 1) {
          total += alpha[y * width + x] ?? 0;
          count += 1;
        }
      }

      features[row * columns + column] = Math.round(total / Math.max(1, count));
    }
  }

  return features;
}

function findBestCandidate(tile: TilePattern, index: CandidateIndex, threshold: number, scoreContext: ScoreContext): MatchCell {
  const blankScore = getCandidateScore(tile, index.blank, scoreContext);

  if (blankScore <= threshold && Math.abs(tile.density - index.blank.density) < threshold * 2.55) {
    return {
      char: " ",
      width: index.blank.width,
      score: Math.round(blankScore * 100) / 100,
    };
  }

  const pool = getCandidatePool(index, tile.density);
  const shortlist = getFeatureShortlist(tile, pool);
  let best = index.blank;
  let bestScore = blankScore;

  shortlist.forEach((candidate) => {
    const score = getCandidateScore(tile, candidate, scoreContext, bestScore);

    if (score < bestScore || (score === bestScore && candidate.codePoint < best.codePoint)) {
      best = candidate;
      bestScore = score;
    }
  });

  return {
    char: best.char,
    width: best.width,
    score: Math.round(bestScore * 100) / 100,
  };
}

let pixelmatchPromise: Promise<PixelmatchFunction> | null = null;
let openCvPromise: Promise<OpenCvModule> | null = null;

async function preloadMatchingLibrary(id: number, method: ImageToAsciiMatchingMethod): Promise<ImageToAsciiMatchingLibraryStatus> {
  const library = getMatchingLibraryName(method);

  if (library === "none") {
    return {
      method,
      library,
      message: "Built-in Pixel matching is ready.",
    };
  }

  postProgress(id, {
    phase: "load-library",
    checkedCodePointCount: 0,
    totalCodePointCount: 1,
    matchedCellCount: 0,
    totalCellCount: GRID_COLUMNS * GRID_ROWS,
  });

  if (library === "pixelmatch") {
    await ensurePixelmatch();
  } else {
    assertOpenCvMethodSupport(method, await ensureOpenCv());
  }

  postProgress(id, {
    phase: "load-library",
    checkedCodePointCount: 1,
    totalCodePointCount: 1,
    matchedCellCount: 0,
    totalCellCount: GRID_COLUMNS * GRID_ROWS,
  });

  return {
    method,
    library,
    message: `${getMatchingLibraryLabel(library)} is ready.`,
  };
}

async function createScoreContext(request: Extract<WorkerRequest, { kind: "match" }> | Extract<WorkerRequest, { kind: "match-range" }>): Promise<ScoreContext> {
  const library = getMatchingLibraryName(request.matchingMethod);
  let pixelmatch: PixelmatchFunction | undefined;
  let opencv: OpenCvModule | undefined;

  if (library === "pixelmatch") {
    await preloadMatchingLibrary(request.id, request.matchingMethod);
    pixelmatch = await ensurePixelmatch();
  }

  return {
    method: request.matchingMethod,
    params: request.matchingParams,
    glyphPolarity: request.glyphPolarity,
    pixelmatch,
    opencv,
    rgbaCache: new WeakMap(),
    distanceCache: new WeakMap(),
    gradientCache: new WeakMap(),
  };
}

function getMatchingLibraryName(method: ImageToAsciiMatchingMethod): ImageToAsciiMatchingLibraryName {
  if (method === "pixelmatch") {
    return "pixelmatch";
  }

  if (method === "chamfer" || method === "edge-correlation" || method === "template" || method === "contour-shape") {
    return "opencv";
  }

  return "none";
}

function getMatchingLibraryLabel(library: ImageToAsciiMatchingLibraryName) {
  if (library === "pixelmatch") {
    return "Pixelmatch";
  }

  if (library === "opencv") {
    return "OpenCV.js";
  }

  return "Built-in matcher";
}

function assertOpenCvMethodSupport(method: ImageToAsciiMatchingMethod, opencv: OpenCvModule) {
  const requiredApis =
    method === "chamfer"
      ? ["Mat", "matFromArray", "distanceTransform"]
      : method === "edge-correlation"
        ? ["Mat", "Sobel", "Laplacian"]
        : method === "template"
          ? ["Mat", "matchTemplate"]
          : method === "contour-shape"
            ? ["Mat", "findContours", "matchShapes"]
            : ["Mat"];
  const missingApi = requiredApis.find((apiName) => typeof opencv[apiName] !== "function");

  if (missingApi) {
    throw new Error(`${getMatchingLibraryLabel("opencv")} does not expose required API: ${missingApi}.`);
  }
}

async function ensurePixelmatch() {
  if (!pixelmatchPromise) {
    pixelmatchPromise = import("pixelmatch").then((module) => module.default);
  }

  return pixelmatchPromise;
}

async function ensureOpenCv() {
  if (!openCvPromise) {
    openCvPromise = import("@techstark/opencv-js").then(async (module) => {
      const loadedModule = module as unknown as { default?: unknown; cv?: unknown };
      const cvModule = (loadedModule.default ?? loadedModule.cv ?? loadedModule) as OpenCvModule | PromiseLike<OpenCvModule>;
      // OpenCV.js の default export は Promise ではなく thenable で返ることがある。
      const resolved = await Promise.resolve(cvModule);

      if (typeof resolved.Mat === "function") {
        return resolved;
      }

      await waitForOpenCvRuntime(resolved);

      if (typeof resolved.Mat !== "function") {
        throw new Error("OpenCV.js loaded, but required runtime APIs are not available.");
      }

      return resolved;
    });
  }

  return openCvPromise;
}

function waitForOpenCvRuntime(cvModule: OpenCvModule) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error("OpenCV.js initialization timed out.")), 30000);
    const previousCallback = cvModule.onRuntimeInitialized;

    cvModule.onRuntimeInitialized = () => {
      clearTimeout(timeoutId);
      previousCallback?.();
      resolve();
    };
  });
}

function getCandidateScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext, stopScore = Number.POSITIVE_INFINITY) {
  if (context.method === "pixelmatch") {
    return getPixelmatchScore(tile, candidate, context);
  }

  if (context.method === "chamfer") {
    return getChamferScore(tile, candidate, context);
  }

  if (context.method === "edge-correlation") {
    return getEdgeCorrelationScore(tile, candidate, context);
  }

  if (context.method === "template") {
    return getTemplateScore(tile, candidate, context);
  }

  if (context.method === "contour-shape") {
    return getContourShapeScore(tile, candidate, context);
  }

  return getPixelScore(tile, candidate, context, stopScore);
}

function getPixelScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext, stopScore = Number.POSITIVE_INFINITY) {
  const params = context.params.pixel;
  const pixelScore = getDifferenceScore(tile.alpha, candidate.alpha, stopScore);
  const densityScore = (Math.abs(tile.density - candidate.density) / 255) * 100;
  const featureScore = getFeatureDifferenceScore(tile.features, candidate.features, Number.POSITIVE_INFINITY);
  const inkMismatchScore = getInkMismatchScore(tile.alpha, candidate.alpha, context.glyphPolarity);
  const weightedScore = getWeightedScore([
    [pixelScore, params.pixelWeight],
    [densityScore, params.densityWeight],
    [featureScore, params.featureWeight],
    [inkMismatchScore, params.inkMismatchPenalty],
  ]);

  return clampScore(weightedScore + (candidate.char === " " ? params.blankBias : 0));
}

function getPixelmatchScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext) {
  if (!context.pixelmatch) {
    throw new Error("Pixelmatch is not loaded.");
  }

  const params = context.params.pixelmatch;
  const diffPixels = context.pixelmatch(
    getRgbaFromAlpha(tile.alpha, context),
    getRgbaFromAlpha(candidate.alpha, context),
    undefined,
    tile.width,
    tile.height,
    {
      threshold: clamp(params.threshold, 0, 1),
      includeAA: params.includeAA,
      alpha: clamp(params.alpha, 0, 1),
      diffMask: params.diffMask,
    },
  );
  const mismatchScore = (diffPixels / Math.max(1, tile.width * tile.height)) * 100;
  const pixelScore = getDifferenceScore(tile.alpha, candidate.alpha);

  return clampScore(getWeightedScore([[mismatchScore, params.perceptualWeight], [pixelScore, 1 - params.perceptualWeight]]));
}

function getChamferScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext) {
  const params = context.params.chamfer;
  const width = tile.width;
  const height = tile.height;
  const maxDistance = Math.max(1, params.maxDistance);
  const tileDistance = getDistanceMap(tile.alpha, width, height, context, params.edgeThreshold, params.metric, params.dilationRadius);
  const candidateDistance = getDistanceMap(candidate.alpha, width, height, context, params.edgeThreshold, params.metric, params.dilationRadius);
  const candidateToTile = getForegroundDistanceScore(candidate.alpha, tileDistance, context.glyphPolarity, params.edgeThreshold, maxDistance);
  const tileToCandidate = getForegroundDistanceScore(tile.alpha, candidateDistance, context.glyphPolarity, params.edgeThreshold, maxDistance);
  const backgroundScore = getInkMismatchScore(tile.alpha, candidate.alpha, context.glyphPolarity);

  return clampScore(
    getWeightedScore([
      [candidateToTile, params.foregroundWeight],
      [tileToCandidate, params.bidirectionalWeight],
      [backgroundScore, params.backgroundPenalty],
    ]),
  );
}

function getEdgeCorrelationScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext) {
  const params = context.params.edgeCorrelation;
  const tileGradient = getGradientFeatures(tile.alpha, tile.width, tile.height, context, params.edgeMode);
  const candidateGradient = getGradientFeatures(candidate.alpha, tile.width, tile.height, context, params.edgeMode);
  const correlationScore = 100 - getGradientCorrelation(tileGradient, candidateGradient) * 100;
  const differenceScore = getDifferenceScore(tile.alpha, candidate.alpha);
  const magnitudeScore = getGradientMagnitudeDifference(tileGradient, candidateGradient);
  const thresholdPenalty = getInkMismatchScore(thresholdAlpha(tile.alpha, context.glyphPolarity, params.threshold), thresholdAlpha(candidate.alpha, context.glyphPolarity, params.threshold), "white-on-black");

  return clampScore(
    getWeightedScore([
      [correlationScore, params.correlationWeight],
      [differenceScore, params.differenceWeight],
      [magnitudeScore, params.gradientWeight],
      [thresholdPenalty, params.thresholdPenaltyWeight],
    ]),
  );
}

function getTemplateScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext) {
  const params = context.params.template;
  const correlation = getNormalizedCorrelation(tile.alpha, candidate.alpha, params.mode);
  const correlationScore = params.mode === "sqdiff-normed" ? correlation * 100 : (1 - correlation) * 100;
  const differenceScore = getDifferenceScore(tile.alpha, candidate.alpha);
  const densityScore = (Math.abs(tile.density - candidate.density) / 255) * 100;

  return clampScore(
    getWeightedScore([
      [correlationScore, params.correlationWeight],
      [differenceScore, params.differenceWeight],
      [densityScore, params.densityWeight],
    ]),
  );
}

function getContourShapeScore(tile: TilePattern, candidate: GlyphCandidate, context: ScoreContext) {
  const params = context.params.contourShape;
  return getSharedContourShapeScore(tile.alpha, candidate.alpha, tile.width, tile.height, params, (value) =>
    isInkPixel(value, context.glyphPolarity, params.contourThreshold),
  );
}

function getCandidatePool(index: CandidateIndex, density: number) {
  const center = getDensityBin(density);
  const pool: GlyphCandidate[] = [];

  for (let radius = 0; radius < DENSITY_BIN_COUNT; radius += 1) {
    const lower = center - radius;
    const upper = center + radius;

    if (lower >= 0) {
      pool.push(...index.buckets[lower]);
    }

    if (upper !== lower && upper < DENSITY_BIN_COUNT) {
      pool.push(...index.buckets[upper]);
    }

    if (pool.length >= MIN_POOL_SIZE && radius >= 2) {
      break;
    }
  }

  return pool.length > 0 ? pool : index.candidates;
}

function getFeatureShortlist(tile: TilePattern, pool: GlyphCandidate[]) {
  const shortlist: { candidate: GlyphCandidate; score: number }[] = [];
  let worstScore = Number.POSITIVE_INFINITY;
  let worstIndex = -1;

  pool.forEach((candidate) => {
    const score = getFeatureDifferenceScore(tile.features, candidate.features, worstScore);

    if (shortlist.length < SHORTLIST_LIMIT) {
      shortlist.push({ candidate, score });

      if (score > worstScore || worstIndex < 0) {
        worstScore = score;
        worstIndex = shortlist.length - 1;
      }

      if (shortlist.length === SHORTLIST_LIMIT) {
        ({ worstScore, worstIndex } = getWorstShortlistItem(shortlist));
      }

      return;
    }

    if (score >= worstScore) {
      return;
    }

    shortlist[worstIndex] = { candidate, score };
    ({ worstScore, worstIndex } = getWorstShortlistItem(shortlist));
  });

  return shortlist.map((item) => item.candidate);
}

function getWorstShortlistItem(shortlist: { score: number }[]) {
  let worstScore = Number.NEGATIVE_INFINITY;
  let worstIndex = 0;

  shortlist.forEach((item, index) => {
    if (item.score > worstScore) {
      worstScore = item.score;
      worstIndex = index;
    }
  });

  return { worstScore, worstIndex };
}

function assertOpenCvReady(context: ScoreContext, label: string, requiredApis: string[]) {
  if (!context.opencv) {
    throw new Error(`${label} requires OpenCV.js.`);
  }

  const missingApi = requiredApis.find((apiName) => typeof context.opencv?.[apiName] !== "function");

  if (missingApi) {
    throw new Error(`${label} requires OpenCV.js API: ${missingApi}.`);
  }
}

function getWeightedScore(items: [score: number, weight: number][]) {
  let total = 0;
  let weightTotal = 0;

  items.forEach(([score, weight]) => {
    const safeWeight = Number.isFinite(weight) ? Math.max(0, weight) : 0;

    if (safeWeight <= 0) {
      return;
    }

    total += score * safeWeight;
    weightTotal += safeWeight;
  });

  return weightTotal > 0 ? total / weightTotal : 100;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 100));
}

function getRgbaFromAlpha(alpha: Uint8ClampedArray, context: ScoreContext) {
  const cached = context.rgbaCache.get(alpha);

  if (cached) {
    return cached;
  }

  const rgba = new Uint8ClampedArray(alpha.length * 4);

  for (let index = 0; index < alpha.length; index += 1) {
    const rgbaIndex = index * 4;
    const value = alpha[index] ?? 0;
    rgba[rgbaIndex] = value;
    rgba[rgbaIndex + 1] = value;
    rgba[rgbaIndex + 2] = value;
    rgba[rgbaIndex + 3] = 255;
  }

  context.rgbaCache.set(alpha, rgba);
  return rgba;
}

function getInkValue(value: number, glyphPolarity: ImageToAsciiGlyphPolarity) {
  return glyphPolarity === "white-on-black" ? value : 255 - value;
}

function isInkPixel(value: number, glyphPolarity: ImageToAsciiGlyphPolarity, threshold: number) {
  return getInkValue(value, glyphPolarity) >= threshold;
}

function getInkMismatchScore(left: Uint8ClampedArray, right: Uint8ClampedArray, glyphPolarity: ImageToAsciiGlyphPolarity) {
  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftInk = getInkValue(left[index] ?? 0, glyphPolarity);
    const rightInk = getInkValue(right[index] ?? 0, glyphPolarity);
    mismatch += Math.abs(leftInk - rightInk) > 96 ? 1 : 0;
  }

  return (mismatch / Math.max(1, left.length)) * 100;
}

function thresholdAlpha(alpha: Uint8ClampedArray, glyphPolarity: ImageToAsciiGlyphPolarity, threshold: number) {
  const output = new Uint8ClampedArray(alpha.length);

  for (let index = 0; index < alpha.length; index += 1) {
    output[index] = isInkPixel(alpha[index] ?? 0, glyphPolarity, threshold) ? 255 : 0;
  }

  return output;
}

function getDistanceMap(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  context: ScoreContext,
  edgeThreshold: number,
  metric: ImageToAsciiMatchingParams["chamfer"]["metric"],
  dilationRadius: number,
) {
  const cached = context.distanceCache.get(alpha);

  if (cached) {
    return cached;
  }

  const openCvDistanceMap = createOpenCvDistanceMap(alpha, width, height, context, edgeThreshold, metric, dilationRadius);

  if (openCvDistanceMap) {
    context.distanceCache.set(alpha, openCvDistanceMap);
    return openCvDistanceMap;
  }

  const points = getForegroundPoints(alpha, width, height, context.glyphPolarity, edgeThreshold, dilationRadius);
  const distances = new Float32Array(width * height);

  if (points.length === 0) {
    distances.fill(Math.max(width, height));
    context.distanceCache.set(alpha, distances);
    return distances;
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = Number.POSITIVE_INFINITY;

      points.forEach((point) => {
        const dx = Math.abs(x - point.x);
        const dy = Math.abs(y - point.y);
        const distance = metric === "manhattan" ? dx + dy : metric === "chebyshev" ? Math.max(dx, dy) : Math.hypot(dx, dy);

        if (distance < best) {
          best = distance;
        }
      });

      distances[y * width + x] = best;
    }
  }

  context.distanceCache.set(alpha, distances);
  return distances;
}

function createOpenCvDistanceMap(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  context: ScoreContext,
  edgeThreshold: number,
  metric: ImageToAsciiMatchingParams["chamfer"]["metric"],
  dilationRadius: number,
) {
  const cv = context.opencv as
    | (OpenCvModule & {
        matFromArray?: (rows: number, cols: number, type: number, array: Uint8Array | number[]) => { delete: () => void };
        Mat?: new () => { data32F?: Float32Array; delete: () => void };
        distanceTransform?: (src: unknown, dst: unknown, distanceType: number, maskSize: number) => void;
        CV_8UC1?: number;
        DIST_L1?: number;
        DIST_L2?: number;
        DIST_C?: number;
        DIST_MASK_3?: number;
      })
    | undefined;

  if (!cv?.matFromArray || !cv.Mat || !cv.distanceTransform || typeof cv.CV_8UC1 !== "number") {
    return null;
  }

  const binary = new Uint8Array(width * height);
  const radius = Math.max(0, Math.round(dilationRadius));
  const points = getForegroundPoints(alpha, width, height, context.glyphPolarity, edgeThreshold, radius);

  if (points.length === 0) {
    return null;
  }

  binary.fill(255);
  points.forEach((point) => {
    binary[point.y * width + point.x] = 0;
  });

  const source = cv.matFromArray(height, width, cv.CV_8UC1, binary);
  const destination = new cv.Mat();

  try {
    const distanceType = metric === "manhattan" ? (cv.DIST_L1 ?? 1) : metric === "chebyshev" ? (cv.DIST_C ?? 3) : (cv.DIST_L2 ?? 2);
    cv.distanceTransform(source, destination, distanceType, cv.DIST_MASK_3 ?? 3);
    return destination.data32F ? new Float32Array(destination.data32F) : null;
  } catch {
    return null;
  } finally {
    source.delete();
    destination.delete();
  }
}

function getForegroundPoints(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  glyphPolarity: ImageToAsciiGlyphPolarity,
  edgeThreshold: number,
  dilationRadius: number,
) {
  const points: { x: number; y: number }[] = [];
  const seen = new Set<number>();
  const radius = Math.max(0, Math.round(dilationRadius));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInkPixel(alpha[y * width + x] ?? 0, glyphPolarity, edgeThreshold)) {
        continue;
      }

      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
          const nextX = x + offsetX;
          const nextY = y + offsetY;

          if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
            continue;
          }

          const key = nextY * width + nextX;

          if (!seen.has(key)) {
            seen.add(key);
            points.push({ x: nextX, y: nextY });
          }
        }
      }
    }
  }

  return points;
}

function getForegroundDistanceScore(
  alpha: Uint8ClampedArray,
  distanceMap: Float32Array,
  glyphPolarity: ImageToAsciiGlyphPolarity,
  edgeThreshold: number,
  maxDistance: number,
) {
  let total = 0;
  let count = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    if (!isInkPixel(alpha[index] ?? 0, glyphPolarity, edgeThreshold)) {
      continue;
    }

    total += Math.min(maxDistance, distanceMap[index] ?? maxDistance);
    count += 1;
  }

  if (count === 0) {
    return 100;
  }

  return (total / count / maxDistance) * 100;
}

function getGradientFeatures(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  context: ScoreContext,
  edgeMode: ImageToAsciiMatchingParams["edgeCorrelation"]["edgeMode"],
) {
  const cached = context.gradientCache.get(alpha);

  if (cached) {
    return cached;
  }

  const magnitudes = new Float32Array(width * height);
  const angles = new Float32Array(width * height);
  let totalMagnitude = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const gx =
        edgeMode === "laplacian"
          ? sampleCellInk(alpha, width, height, x, y - 1, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x - 1, y, context.glyphPolarity) -
            4 * sampleCellInk(alpha, width, height, x, y, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x + 1, y, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x, y + 1, context.glyphPolarity)
          : -sampleCellInk(alpha, width, height, x - 1, y - 1, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x + 1, y - 1, context.glyphPolarity) -
            2 * sampleCellInk(alpha, width, height, x - 1, y, context.glyphPolarity) +
            2 * sampleCellInk(alpha, width, height, x + 1, y, context.glyphPolarity) -
            sampleCellInk(alpha, width, height, x - 1, y + 1, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x + 1, y + 1, context.glyphPolarity);
      const gy =
        edgeMode === "laplacian"
          ? gx
          : -sampleCellInk(alpha, width, height, x - 1, y - 1, context.glyphPolarity) -
            2 * sampleCellInk(alpha, width, height, x, y - 1, context.glyphPolarity) -
            sampleCellInk(alpha, width, height, x + 1, y - 1, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x - 1, y + 1, context.glyphPolarity) +
            2 * sampleCellInk(alpha, width, height, x, y + 1, context.glyphPolarity) +
            sampleCellInk(alpha, width, height, x + 1, y + 1, context.glyphPolarity);
      const magnitude = Math.hypot(gx, gy);
      const index = y * width + x;

      magnitudes[index] = magnitude;
      angles[index] = Math.atan2(gy, gx);
      totalMagnitude += magnitude;
    }
  }

  const features = { magnitudes, angles, totalMagnitude };
  context.gradientCache.set(alpha, features);
  return features;
}

function sampleCellInk(alpha: Uint8ClampedArray, width: number, height: number, x: number, y: number, glyphPolarity: ImageToAsciiGlyphPolarity) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  return getInkValue(alpha[clampedY * width + clampedX] ?? 0, glyphPolarity);
}

function getGradientCorrelation(left: GradientFeatures, right: GradientFeatures) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.magnitudes.length; index += 1) {
    const leftValue = left.magnitudes[index] ?? 0;
    const rightValue = right.magnitudes[index] ?? 0;
    const angleFactor = Math.max(0, Math.cos((left.angles[index] ?? 0) - (right.angles[index] ?? 0)));

    dot += leftValue * rightValue * angleFactor;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 && rightNorm === 0) {
    return 1;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function getGradientMagnitudeDifference(left: GradientFeatures, right: GradientFeatures) {
  const total = Math.max(left.totalMagnitude, right.totalMagnitude, 1);
  return (Math.abs(left.totalMagnitude - right.totalMagnitude) / total) * 100;
}

function getNormalizedCorrelation(left: Uint8ClampedArray, right: Uint8ClampedArray, mode: ImageToAsciiMatchingParams["template"]["mode"]) {
  if (mode === "sqdiff-normed") {
    return getDifferenceScore(left, right) / 100;
  }

  let leftTotal = 0;
  let rightTotal = 0;

  for (let index = 0; index < left.length; index += 1) {
    leftTotal += left[index] ?? 0;
    rightTotal += right[index] ?? 0;
  }

  const leftMean = mode === "ccoeff-normed" ? leftTotal / Math.max(1, left.length) : 0;
  const rightMean = mode === "ccoeff-normed" ? rightTotal / Math.max(1, right.length) : 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = (left[index] ?? 0) - leftMean;
    const rightValue = (right[index] ?? 0) - rightMean;

    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 && rightNorm === 0) {
    return 1;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function getFeatureDifferenceScore(left: Uint8ClampedArray, right: Uint8ClampedArray, stopScore: number) {
  let total = 0;
  const stopTotal = Number.isFinite(stopScore) ? (stopScore / 100) * left.length * 255 : Number.POSITIVE_INFINITY;

  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index] - right[index]);

    if (total > stopTotal) {
      return Number.POSITIVE_INFINITY;
    }
  }

  return (total / left.length / 255) * 100;
}

function getDifferenceScore(left: Uint8ClampedArray, right: Uint8ClampedArray, stopScore = Number.POSITIVE_INFINITY) {
  let total = 0;
  const stopTotal = Number.isFinite(stopScore) ? (stopScore / 100) * left.length * 255 : Number.POSITIVE_INFINITY;

  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs(left[index] - right[index]);

    if (total > stopTotal) {
      return Number.POSITIVE_INFINITY;
    }
  }

  return (total / left.length / 255) * 100;
}

function getAverageAlpha(alpha: Uint8ClampedArray) {
  let total = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    total += alpha[index];
  }

  return total / Math.max(1, alpha.length);
}

function getDensityBin(density: number) {
  return Math.max(0, Math.min(DENSITY_BIN_COUNT - 1, Math.floor(density / DENSITY_BIN_SIZE)));
}

function createBits(alpha: Uint8ClampedArray) {
  let bits = "";

  for (let index = 0; index < alpha.length; index += 1) {
    bits += alpha[index] > 12 ? "1" : "0";
  }

  return bits;
}

function isFallbackGlyph(alpha: Uint8ClampedArray, fallbackBits: Set<string>) {
  return fallbackBits.has(createBits(alpha));
}

function serializeGlyphCache(key: string, request: BaseWorkerRequest, indexes: CandidateIndexes): SerializedGlyphCache {
  return {
    key,
    cacheVersion: GLYPH_CACHE_VERSION,
    createdAt: Date.now(),
    fontFamily: request.fontFamily,
    glyphPolarity: request.glyphPolarity,
    excludeColorEmoji: request.excludeColorEmoji,
    widthMode: request.widthMode,
    pageVersion: getGlyphPageVersion(request.pageData),
    half: serializeCandidateSet(indexes.halfIndex, 1),
    full: serializeCandidateSet(indexes.fullIndex, 2),
  };
}

function serializeCandidateSet(index: CandidateIndex, width: 1 | 2): SerializedCandidateSet {
  const candidates = index.candidates.filter((candidate) => candidate !== index.blank);
  const pixelLength = (width === 1 ? HALF_CELL_WIDTH : FULL_CELL_WIDTH) * CELL_HEIGHT;
  const featureLength = (width === 1 ? FEATURE_COLUMNS_HALF : FEATURE_COLUMNS_FULL) * FEATURE_ROWS;
  const chars: string[] = [];
  const codePoints = new Uint32Array(candidates.length);
  const alpha = new Uint8ClampedArray(candidates.length * pixelLength);
  const features = new Uint8ClampedArray(candidates.length * featureLength);
  const densities = new Float32Array(candidates.length);
  const bins = new Uint8Array(candidates.length);

  candidates.forEach((candidate, index) => {
    chars.push(candidate.char);
    codePoints[index] = candidate.codePoint;
    alpha.set(candidate.alpha, index * pixelLength);
    features.set(candidate.features, index * featureLength);
    densities[index] = candidate.density;
    bins[index] = candidate.bin;
  });

  return {
    width,
    count: candidates.length,
    pixelLength,
    featureLength,
    chars,
    codePoints,
    alpha,
    features,
    densities,
    bins,
  };
}

function deserializeGlyphCache(cache: SerializedGlyphCache, glyphPolarity: ImageToAsciiGlyphPolarity): CandidateIndexes {
  return {
    halfIndex: deserializeCandidateSet(cache.half, glyphPolarity),
    fullIndex: deserializeCandidateSet(cache.full, glyphPolarity),
  };
}

function deserializeCandidateSet(set: SerializedCandidateSet, glyphPolarity: ImageToAsciiGlyphPolarity): CandidateIndex {
  const index = createCandidateIndex(set.width, glyphPolarity);

  for (let candidateIndex = 0; candidateIndex < set.count; candidateIndex += 1) {
    const alphaStart = candidateIndex * set.pixelLength;
    const featureStart = candidateIndex * set.featureLength;
    const candidate: GlyphCandidate = {
      char: set.chars[candidateIndex] ?? " ",
      codePoint: set.codePoints[candidateIndex] ?? 0,
      width: set.width,
      alpha: set.alpha.subarray(alphaStart, alphaStart + set.pixelLength),
      features: set.features.subarray(featureStart, featureStart + set.featureLength),
      density: set.densities[candidateIndex] ?? 0,
      bin: set.bins[candidateIndex] ?? 0,
    };

    addCandidate(index, candidate);
  }

  return index;
}

async function loadSerializedGlyphCache(key: string, requestId: number) {
  postProgress(requestId, {
    phase: "load-cache",
    checkedCodePointCount: 0,
    totalCodePointCount: 1,
    matchedCellCount: 0,
    totalCellCount: GRID_COLUMNS * GRID_ROWS,
  });

  try {
    const db = await openGlyphCacheDatabase();
    const cache = await getFromGlyphCacheStore(db, key);

    if (cache && cache.cacheVersion === GLYPH_CACHE_VERSION && cache.key === key) {
      return cache;
    }
  } catch {
    return null;
  }

  return null;
}

async function saveSerializedGlyphCache(cache: SerializedGlyphCache, requestId: number) {
  try {
    postProgress(requestId, {
      phase: "save-cache",
      checkedCodePointCount: 0,
      totalCodePointCount: 1,
      matchedCellCount: 0,
      totalCellCount: GRID_COLUMNS * GRID_ROWS,
    });

    const db = await openGlyphCacheDatabase();
    await putToGlyphCacheStore(db, cache);

    postProgress(requestId, {
      phase: "save-cache",
      checkedCodePointCount: 1,
      totalCodePointCount: 1,
      matchedCellCount: 0,
      totalCellCount: GRID_COLUMNS * GRID_ROWS,
    });
  } catch {
    // IndexedDB が使えない環境ではメモリ上の生成結果だけで続行する。
  }
}

function openGlyphCacheDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = indexedDB.open(GLYPH_CACHE_DB_NAME, GLYPH_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(GLYPH_CACHE_STORE_NAME)) {
        db.createObjectStore(GLYPH_CACHE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open glyph cache database."));
  });
}

function getFromGlyphCacheStore(db: IDBDatabase, key: string) {
  return new Promise<SerializedGlyphCache | null>((resolve, reject) => {
    const transaction = db.transaction(GLYPH_CACHE_STORE_NAME, "readonly");
    const store = transaction.objectStore(GLYPH_CACHE_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => resolve((request.result as SerializedGlyphCache | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("Failed to load glyph cache."));
  });
}

function putToGlyphCacheStore(db: IDBDatabase, cache: SerializedGlyphCache) {
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(GLYPH_CACHE_STORE_NAME, "readwrite");
    const store = transaction.objectStore(GLYPH_CACHE_STORE_NAME);
    const request = store.put(cache);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Failed to save glyph cache."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Failed to save glyph cache."));
    request.onerror = () => reject(request.error ?? new Error("Failed to save glyph cache."));
  });
}

function getGlyphCacheKey(request: BaseWorkerRequest) {
  return [
    `cache:${GLYPH_CACHE_VERSION}`,
    `page:${getGlyphPageVersion(request.pageData)}`,
    `font:${request.fontFamily}`,
    `width:${request.widthMode}`,
    `polarity:${request.glyphPolarity}`,
    `exclude-color-emoji:${request.excludeColorEmoji ? "1" : "0"}`,
  ].join("|");
}

function getGlyphPageVersion(pageData: UnicodeGlyphPageData) {
  const version = (pageData as UnicodeGlyphPageData & { version?: unknown }).version;
  return typeof version === "string" || typeof version === "number" ? String(version) : "unknown";
}

function postProgress(id: number, progress: ImageToAsciiMatchProgress) {
  workerScope.postMessage({ type: "progress", id, progress });
}

function postCellUpdate(id: number, update: ImageToAsciiCellUpdate) {
  workerScope.postMessage({ type: "cell", id, update });
}

function postProcessingCell(id: number, cell: ImageToAsciiProcessingCell | null) {
  workerScope.postMessage({ type: "processing-cell", id, cell });
}

function postProcessingCellStart(id: number, cell: ImageToAsciiProcessingCell) {
  postProcessingCell(id, cell);
}

function postFullProgressIfNeeded(
  id: number,
  checkedCodePointCount: number,
  totalCodePointCount: number,
  matchedCellCount: number,
  totalCellCount = GRID_ROWS * (GRID_COLUMNS - 1),
) {
  if (matchedCellCount % PROGRESS_CELL_INTERVAL !== 0) {
    return;
  }

  postProgress(id, {
    phase: "match-full",
    checkedCodePointCount,
    totalCodePointCount,
    matchedCellCount,
    totalCellCount,
  });
}

function expandPresentPages(pageData: UnicodeGlyphPageData) {
  const pages: number[] = [];

  pageData.pageRuns.forEach((run) => {
    if (!run.present) {
      return;
    }

    for (let offset = 0; offset < run.count; offset += 1) {
      pages.push(run.startPage + offset);
    }
  });

  return pages;
}

function countPresentCodePoints(pageData: UnicodeGlyphPageData) {
  return expandPresentPages(pageData).reduce((total, page) => {
    const pageStart = page * pageData.pageSize;
    const pageEnd = pageStart + pageData.pageSize - 1;
    const codeStart = Math.max(pageData.range.start, pageStart);
    const codeEnd = Math.min(pageData.range.end, pageEnd);

    return total + Math.max(0, codeEnd - codeStart + 1);
  }, 0);
}

function shouldSkipCodePoint(codePoint: number) {
  return (
    codePoint < 0x20 ||
    isSurrogateCodePoint(codePoint) ||
    isNonCharacterCodePoint(codePoint) ||
    isCombiningMarkCodePoint(codePoint) ||
    isVariationSelectorCodePoint(codePoint)
  );
}

function isSurrogateCodePoint(codePoint: number) {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

function isNonCharacterCodePoint(codePoint: number) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe;
}

function isCombiningMarkCodePoint(codePoint: number) {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
    (codePoint >= 0x20d0 && codePoint <= 0x20ff) ||
    (codePoint >= 0xfe20 && codePoint <= 0xfe2f)
  );
}

function isVariationSelectorCodePoint(codePoint: number) {
  return (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || (codePoint >= 0xe0100 && codePoint <= 0xe01ef);
}

export {};
