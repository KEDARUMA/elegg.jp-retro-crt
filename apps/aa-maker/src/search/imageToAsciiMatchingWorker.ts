import { getTerminalCharWidth, type WidthMode } from "../model/widthMode";
import type {
  ImageToAsciiApplyCell,
  ImageToAsciiCellUpdate,
  ImageToAsciiGlyphPolarity,
  ImageToAsciiGlyphCacheSummary,
  ImageToAsciiMatchProgress,
  ImageToAsciiMatchRangeResult,
  ImageToAsciiMatchResult,
  ImageToAsciiMatchRowResult,
  ImageToAsciiProcessingCell,
} from "./imageToAsciiMatching";
import type { UnicodeGlyphPageData } from "./similarGlyphSearch";

type WorkerRequest = BaseWorkerRequest &
  (
    | {
        kind: "match";
        imageAlpha: Uint8ClampedArray;
        threshold: number;
        includeFullWidth: boolean;
      }
    | {
        kind: "match-range";
        imageAlpha: Uint8ClampedArray;
        threshold: number;
        includeFullWidth: boolean;
        rowStart: number;
        rowEnd: number;
      }
    | {
        kind: "build-cache" | "prepare-cache";
      }
  );

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
};

type RenderedGlyphImage = {
  alpha: Uint8ClampedArray;
  hasColorPixel: boolean;
};

type MatchCell = ImageToAsciiApplyCell & {
  score: number;
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
      const result = await matchImageRangeToAscii(request, request.rowStart, request.rowEnd);
      workerScope.postMessage({ type: "range-result", id: request.id, result });
      return;
    }

    const result = await matchImageToAscii(request);
    workerScope.postMessage({ type: "result", id: request.id, result });
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
      postProcessingCell(request.id, { phase: "match-half", x, y, width: 1 });

      const tile = createTilePattern(request.imageAlpha, x * HALF_CELL_WIDTH, y * CELL_HEIGHT, HALF_CELL_WIDTH, CELL_HEIGHT, FEATURE_COLUMNS_HALF);
      const match = findBestCandidate(tile, halfIndex, request.threshold);

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
        postProcessingCell(request.id, { phase: "match-full", x, y, width: 2 });

        const tile = createTilePattern(request.imageAlpha, x * HALF_CELL_WIDTH, y * CELL_HEIGHT, FULL_CELL_WIDTH, CELL_HEIGHT, FEATURE_COLUMNS_FULL);
        const match = findBestCandidate(tile, fullIndex, request.threshold);
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

  postProcessingCell(request.id, null);

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

function findBestCandidate(tile: TilePattern, index: CandidateIndex, threshold: number): MatchCell {
  const blankScore = getDifferenceScore(tile.alpha, index.blank.alpha);

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
    const score = getDifferenceScore(tile.alpha, candidate.alpha, bestScore);

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
