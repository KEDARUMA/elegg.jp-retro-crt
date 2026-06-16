import { getTerminalCharWidth, type WidthMode } from "../model/widthMode";
import { clamp } from "../utils/clamp";
import { getContourShapeScore as getSharedContourShapeScore } from "./contourShape";
import type {
  SimilarGlyphSearchMatchingMethod,
  SimilarGlyphSearchMatchingParams,
  SimilarGlyphSearchResult,
} from "./similarGlyphSearch";

type WorkerRequest = {
  id: number;
  pages: number[];
  pageSize: number;
  minCodePoint: number;
  maxCodePoint: number;
  targetChar: string;
  targetCodePoint: number;
  targetBitmap?: number[];
  fontFamily: string;
  canvasSize: number;
  threshold: number;
  matchingMethod: SimilarGlyphSearchMatchingMethod;
  matchingParams: SimilarGlyphSearchMatchingParams;
  widthMode: WidthMode;
};

type WorkerMessage =
  | {
      type: "batch";
      id: number;
      results: SimilarGlyphSearchResult[];
      checkedPageCount: number;
      checkedCodePointCount: number;
    }
  | {
      type: "progress";
      id: number;
      phase?: "preparing" | "scanning";
      checkedPageCount: number;
      checkedCodePointCount: number;
    }
  | {
      type: "done";
      id: number;
      checkedPageCount: number;
      checkedCodePointCount: number;
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

type GlyphPattern = {
  alpha: Uint8ClampedArray;
  bits: string;
  inkPixelCount: number;
  features: Uint8ClampedArray;
  density: number;
  width: number;
  height: number;
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
  method: SimilarGlyphSearchMatchingMethod;
  params: SimilarGlyphSearchMatchingParams;
  pixelmatch?: PixelmatchFunction;
  opencv?: OpenCvModule;
  rgbaCache: WeakMap<Uint8ClampedArray, Uint8ClampedArray>;
  distanceCache: WeakMap<Uint8ClampedArray, Float32Array>;
  gradientCache: WeakMap<Uint8ClampedArray, GradientFeatures>;
};

const workerScope = self as unknown as WorkerScope;
const FALLBACK_SAMPLE_CODE_POINTS = [0xfffd, 0x10ffff, 0xe0000];
const BATCH_SIZE = 24;
const PROGRESS_PAGE_INTERVAL = 1;
const PROGRESS_CODE_POINT_INTERVAL = 128;
const INK_THRESHOLD = 12;

workerScope.onmessage = (event) => {
  void searchSimilarGlyphs(event.data).catch((error) => {
    workerScope.postMessage({
      type: "error",
      id: event.data.id,
      message: error instanceof Error ? error.message : String(error),
    });
  });
};

async function searchSimilarGlyphs(request: WorkerRequest) {
  const renderer = createGlyphRenderer(request.canvasSize, request.fontFamily, request.widthMode);
  const bitmapTargetPattern = request.targetBitmap ? createGlyphPatternFromBitmap(request.targetBitmap, request.canvasSize) : null;
  const targetPattern = bitmapTargetPattern ?? (request.targetChar ? renderer.render(request.targetChar) : null);
  const results: SimilarGlyphSearchResult[] = [];
  let checkedPageCount = 0;
  let checkedCodePointCount = 0;
  let resultCount = 0;
  let cancelled = false;

  if (!targetPattern) {
    workerScope.postMessage({ type: "done", id: request.id, checkedPageCount, checkedCodePointCount });
    return;
  }

  postProgress(request.id, "preparing", checkedPageCount, checkedCodePointCount);

  const scoreContext = await createScoreContext(request);

  postProgress(request.id, "scanning", checkedPageCount, checkedCodePointCount);

  request.pages.forEach((page) => {
    if (cancelled) {
      return;
    }

    const pageStart = page * request.pageSize;
    const pageEnd = pageStart + request.pageSize - 1;
    const codeStart = Math.max(request.minCodePoint, pageStart);
    const codeEnd = Math.min(request.maxCodePoint, pageEnd);

    for (let codePoint = codeStart; codePoint <= codeEnd; codePoint += 1) {
      if (shouldSkipCodePoint(codePoint)) {
        continue;
      }

      checkedCodePointCount += 1;

      if (checkedCodePointCount % PROGRESS_CODE_POINT_INTERVAL === 0) {
        postProgress(request.id, "scanning", checkedPageCount, checkedCodePointCount);
      }

      const char = String.fromCodePoint(codePoint);
      const width = renderer.measureWidth(char);
      const pattern = renderer.render(char);

      if (!pattern || renderer.isFallback(pattern)) {
        continue;
      }

      const score = getGlyphScore(targetPattern, pattern, scoreContext);

      if (score <= request.threshold) {
        results.push({
          char,
          codePoint,
          score: Math.round(score * 100) / 100,
          width,
        });
        resultCount += 1;
      }

      if (results.length >= BATCH_SIZE) {
        flushResults(request.id, results, checkedPageCount, checkedCodePointCount);
      }

      if (resultCount >= request.maxResults) {
        cancelled = true;
        break;
      }
    }

    checkedPageCount += 1;

    if (checkedPageCount % PROGRESS_PAGE_INTERVAL === 0) {
      postProgress(request.id, "scanning", checkedPageCount, checkedCodePointCount);
    }
  });

  flushResults(request.id, results, checkedPageCount, checkedCodePointCount);
  workerScope.postMessage({ type: "done", id: request.id, checkedPageCount, checkedCodePointCount });
}

function postProgress(
  id: number,
  phase: "preparing" | "scanning",
  checkedPageCount: number,
  checkedCodePointCount: number,
) {
  workerScope.postMessage({ type: "progress", id, phase, checkedPageCount, checkedCodePointCount });
}

function getGlyphScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  switch (context.method) {
    case "pixelmatch":
      return getPixelmatchScore(target, candidate, context);
    case "chamfer":
      return getChamferScore(target, candidate, context);
    case "edge-correlation":
      return getEdgeCorrelationScore(target, candidate, context);
    case "template":
      return getTemplateScore(target, candidate, context);
    case "contour-shape":
      return getContourShapeScore(target, candidate, context);
    case "pixel":
    default:
      return getPixelScore(target, candidate, context);
  }
}

function getPixelScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  const params = context.params.pixel;
  const pixelScore = getDifferenceScore(target.alpha, candidate.alpha);
  const densityScore = (Math.abs(target.density - candidate.density) / 255) * 100;
  const featureScore = getFeatureDifferenceScore(target.features, candidate.features);
  const inkMismatchScore = getInkMismatchScore(target.alpha, candidate.alpha);

  return clampScore(
    getWeightedScore([
      [pixelScore, params.pixelWeight],
      [densityScore, params.densityWeight],
      [featureScore, params.featureWeight],
      [inkMismatchScore, params.inkMismatchPenalty],
    ]) + (candidate.inkPixelCount === 0 ? params.blankBias : 0),
  );
}

function getPixelmatchScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  if (!context.pixelmatch) {
    throw new Error("Pixelmatch is not loaded.");
  }

  const params = context.params.pixelmatch;
  const diffPixels = context.pixelmatch(
    getRgbaFromAlpha(target.alpha, context),
    getRgbaFromAlpha(candidate.alpha, context),
    undefined,
    target.width,
    target.height,
    {
      threshold: clamp(params.threshold, 0, 1),
      includeAA: params.includeAA,
      alpha: clamp(params.alpha, 0, 1),
      diffMask: params.diffMask,
    },
  );
  const mismatchScore = (diffPixels / Math.max(1, target.width * target.height)) * 100;
  const pixelScore = getDifferenceScore(target.alpha, candidate.alpha);

  return clampScore(getWeightedScore([[mismatchScore, params.perceptualWeight], [pixelScore, 1 - params.perceptualWeight]]));
}

function getChamferScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  const params = context.params.chamfer;
  const maxDistance = Math.max(1, params.maxDistance);
  const targetDistance = getDistanceMap(target.alpha, target.width, target.height, context, params.edgeThreshold, params.metric, params.dilationRadius);
  const candidateDistance = getDistanceMap(candidate.alpha, candidate.width, candidate.height, context, params.edgeThreshold, params.metric, params.dilationRadius);
  const candidateToTarget = getForegroundDistanceScore(candidate.alpha, targetDistance, params.edgeThreshold, maxDistance);
  const targetToCandidate = getForegroundDistanceScore(target.alpha, candidateDistance, params.edgeThreshold, maxDistance);
  const backgroundScore = getInkMismatchScore(target.alpha, candidate.alpha);

  return clampScore(
    getWeightedScore([
      [candidateToTarget, params.foregroundWeight],
      [targetToCandidate, params.bidirectionalWeight],
      [backgroundScore, params.backgroundPenalty],
    ]),
  );
}

function getEdgeCorrelationScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  const params = context.params.edgeCorrelation;
  const targetGradient = getGradientFeatures(target.alpha, target.width, target.height, context, params.edgeMode);
  const candidateGradient = getGradientFeatures(candidate.alpha, candidate.width, candidate.height, context, params.edgeMode);
  const correlationScore = 100 - getGradientCorrelation(targetGradient, candidateGradient) * 100;
  const differenceScore = getDifferenceScore(target.alpha, candidate.alpha);
  const magnitudeScore = getGradientMagnitudeDifference(targetGradient, candidateGradient);
  const thresholdPenalty = getInkMismatchScore(
    thresholdAlpha(target.alpha, params.threshold),
    thresholdAlpha(candidate.alpha, params.threshold),
  );

  return clampScore(
    getWeightedScore([
      [correlationScore, params.correlationWeight],
      [differenceScore, params.differenceWeight],
      [magnitudeScore, params.gradientWeight],
      [thresholdPenalty, params.thresholdPenaltyWeight],
    ]),
  );
}

function getTemplateScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  const params = context.params.template;
  const correlation = getNormalizedCorrelation(target.alpha, candidate.alpha, params.mode);
  const correlationScore = params.mode === "sqdiff-normed" ? correlation * 100 : (1 - correlation) * 100;
  const differenceScore = getDifferenceScore(target.alpha, candidate.alpha);
  const densityScore = (Math.abs(target.density - candidate.density) / 255) * 100;

  return clampScore(
    getWeightedScore([
      [correlationScore, params.correlationWeight],
      [differenceScore, params.differenceWeight],
      [densityScore, params.densityWeight],
    ]),
  );
}

function getContourShapeScore(target: GlyphPattern, candidate: GlyphPattern, context: ScoreContext) {
  const params = context.params.contourShape;
  return getSharedContourShapeScore(target.alpha, candidate.alpha, target.width, target.height, params, (value) =>
    isInkPixel(value, params.contourThreshold),
  );
}

function createScoreContext(request: WorkerRequest): Promise<ScoreContext> {
  const library = getMatchingLibraryName(request.matchingMethod);

  if (library === "pixelmatch") {
    return ensurePixelmatch().then((loadedPixelmatch) => createBaseScoreContext(request, { pixelmatch: loadedPixelmatch }));
  }

  return Promise.resolve(createBaseScoreContext(request));
}

function createBaseScoreContext(
  request: WorkerRequest,
  options: { pixelmatch?: PixelmatchFunction; opencv?: OpenCvModule } = {},
): ScoreContext {
  const context: ScoreContext = {
    method: request.matchingMethod,
    params: request.matchingParams,
    rgbaCache: new WeakMap(),
    distanceCache: new WeakMap(),
    gradientCache: new WeakMap(),
  };

  if (options.pixelmatch) {
    context.pixelmatch = options.pixelmatch;
  }

  if (options.opencv) {
    context.opencv = options.opencv;
  }

  return context;
}

function getMatchingLibraryName(method: SimilarGlyphSearchMatchingMethod) {
  if (method === "pixelmatch") {
    return "pixelmatch";
  }

  return "none";
}

let pixelmatchPromise: Promise<PixelmatchFunction> | null = null;

async function ensurePixelmatch() {
  if (!pixelmatchPromise) {
    pixelmatchPromise = import("pixelmatch").then((module) => module.default);
  }

  return pixelmatchPromise;
}

function createGlyphRenderer(canvasSize: number, fontFamily: string, widthMode: WidthMode) {
  const sourceSize = canvasSize * 3;
  const sourceCanvas = new OffscreenCanvas(sourceSize, sourceSize);
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const normalizedCanvas = new OffscreenCanvas(canvasSize, canvasSize);
  const normalizedContext = normalizedCanvas.getContext("2d", { willReadFrequently: true });
  const measureCanvas = new OffscreenCanvas(canvasSize, canvasSize);
  const measureContext = measureCanvas.getContext("2d");

  if (!sourceContext || !normalizedContext || !measureContext) {
    throw new Error("Similar glyph search failed: 2D canvas is not available.");
  }

  const fontSize = Math.floor(sourceSize * 0.58);
  const font = `${fontSize}px ${fontFamily}`;
  sourceContext.textAlign = "center";
  sourceContext.textBaseline = "middle";
  sourceContext.fillStyle = "#000000";
  sourceContext.font = font;
  normalizedContext.imageSmoothingEnabled = true;
  normalizedContext.imageSmoothingQuality = "high";
  measureContext.font = font;

  const halfWidth = measureContext.measureText("A").width;
  const fullWidth = measureContext.measureText("あ").width;
  const fallbackBits = new Set(
    FALLBACK_SAMPLE_CODE_POINTS.map((codePoint) =>
      renderNormalizedGlyph(sourceContext, normalizedContext, sourceSize, canvasSize, String.fromCodePoint(codePoint)),
    )
      .filter((pattern): pattern is GlyphPattern => pattern !== null)
      .map((pattern) => pattern.bits),
  );

  return {
    render(char: string) {
      return renderNormalizedGlyph(sourceContext, normalizedContext, sourceSize, canvasSize, char);
    },
    isFallback(pattern: GlyphPattern) {
      return fallbackBits.has(pattern.bits);
    },
    measureWidth(char: string): 1 | 2 {
      if (widthMode === "terminal") {
        return getTerminalCharWidth(char);
      }

      const charWidth = measureContext.measureText(char).width;
      return Math.abs(charWidth - fullWidth) < Math.abs(charWidth - halfWidth) ? 2 : 1;
    },
  };
}

function renderNormalizedGlyph(
  sourceContext: OffscreenCanvasRenderingContext2D,
  normalizedContext: OffscreenCanvasRenderingContext2D,
  sourceSize: number,
  canvasSize: number,
  char: string,
): GlyphPattern | null {
  sourceContext.clearRect(0, 0, sourceSize, sourceSize);
  sourceContext.fillText(char, sourceSize / 2, sourceSize / 2);

  const sourceImage = sourceContext.getImageData(0, 0, sourceSize, sourceSize);
  const bounds = getInkBounds(sourceImage.data, sourceSize);

  if (!bounds) {
    return null;
  }

  normalizedContext.clearRect(0, 0, canvasSize, canvasSize);
  const targetRect = getAspectFitRect(bounds.width, bounds.height, canvasSize);
  normalizedContext.drawImage(
    sourceContext.canvas,
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
  const alpha = new Uint8ClampedArray(canvasSize * canvasSize);

  for (let sourceIndex = 3, targetIndex = 0; sourceIndex < normalizedData.length; sourceIndex += 4, targetIndex += 1) {
    alpha[targetIndex] = normalizedData[sourceIndex] ?? 0;
  }

  return createGlyphPatternFromAlpha(alpha, canvasSize, canvasSize);
}

function createGlyphPatternFromBitmap(bitmap: number[], canvasSize: number) {
  if (bitmap.length !== canvasSize * canvasSize) {
    return null;
  }

  const alpha = new Uint8ClampedArray(canvasSize * canvasSize);

  bitmap.forEach((rawValue, index) => {
    alpha[index] = clamp(Math.round(Number(rawValue)), 0, 255);
  });

  return createGlyphPatternFromAlpha(alpha, canvasSize, canvasSize);
}

function createGlyphPatternFromAlpha(alpha: Uint8ClampedArray, width: number, height: number) {
  if (alpha.length !== width * height) {
    return null;
  }

  const bits = createBits(alpha);
  let inkPixelCount = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    if ((alpha[index] ?? 0) > INK_THRESHOLD) {
      inkPixelCount += 1;
    }
  }

  if (inkPixelCount === 0) {
    return null;
  }

  return {
    alpha,
    bits,
    inkPixelCount,
    features: createFeatures(alpha, width, height, Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2))),
    density: getAverageAlpha(alpha),
    width,
    height,
  };
}

function getInkBounds(data: Uint8ClampedArray, size: number) {
  let minX = size;
  let minY = size;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = data[(y * size + x) * 4 + 3];

      if (alpha <= INK_THRESHOLD) {
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

function getDifferenceScore(left: Uint8ClampedArray, right: Uint8ClampedArray, stopScore = Number.POSITIVE_INFINITY) {
  let total = 0;
  const stopTotal = Number.isFinite(stopScore) ? (stopScore / 100) * left.length * 255 : Number.POSITIVE_INFINITY;

  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));

    if (total > stopTotal) {
      return Number.POSITIVE_INFINITY;
    }
  }

  return (total / left.length / 255) * 100;
}

function getFeatureDifferenceScore(left: Uint8ClampedArray, right: Uint8ClampedArray, stopScore = Number.POSITIVE_INFINITY) {
  let total = 0;
  const stopTotal = Number.isFinite(stopScore) ? (stopScore / 100) * left.length * 255 : Number.POSITIVE_INFINITY;

  for (let index = 0; index < left.length; index += 1) {
    total += Math.abs((left[index] ?? 0) - (right[index] ?? 0));

    if (total > stopTotal) {
      return Number.POSITIVE_INFINITY;
    }
  }

  return (total / left.length / 255) * 100;
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

function getAverageAlpha(alpha: Uint8ClampedArray) {
  let total = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    total += alpha[index] ?? 0;
  }

  return total / Math.max(1, alpha.length);
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

function getInkValue(value: number) {
  return value;
}

function isInkPixel(value: number, threshold: number) {
  return getInkValue(value) >= threshold;
}

function getInkMismatchScore(left: Uint8ClampedArray, right: Uint8ClampedArray) {
  let mismatch = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftInk = getInkValue(left[index] ?? 0);
    const rightInk = getInkValue(right[index] ?? 0);
    mismatch += Math.abs(leftInk - rightInk) > 96 ? 1 : 0;
  }

  return (mismatch / Math.max(1, left.length)) * 100;
}

function thresholdAlpha(alpha: Uint8ClampedArray, threshold: number) {
  const output = new Uint8ClampedArray(alpha.length);

  for (let index = 0; index < alpha.length; index += 1) {
    output[index] = isInkPixel(alpha[index] ?? 0, threshold) ? 255 : 0;
  }

  return output;
}

function getDistanceMap(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  context: ScoreContext,
  edgeThreshold: number,
  metric: SimilarGlyphSearchMatchingParams["chamfer"]["metric"],
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

  const points = getForegroundPoints(alpha, width, height, edgeThreshold, dilationRadius);
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
  metric: SimilarGlyphSearchMatchingParams["chamfer"]["metric"],
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
  const points = getForegroundPoints(alpha, width, height, edgeThreshold, radius);

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

function getForegroundPoints(alpha: Uint8ClampedArray, width: number, height: number, edgeThreshold: number, dilationRadius: number) {
  const points: { x: number; y: number }[] = [];
  const seen = new Set<number>();
  const radius = Math.max(0, Math.round(dilationRadius));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInkPixel(alpha[y * width + x] ?? 0, edgeThreshold)) {
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
  edgeThreshold: number,
  maxDistance: number,
) {
  let total = 0;
  let count = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    if (!isInkPixel(alpha[index] ?? 0, edgeThreshold)) {
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
  edgeMode: SimilarGlyphSearchMatchingParams["edgeCorrelation"]["edgeMode"],
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
          ? sampleCellInk(alpha, width, height, x, y - 1) + sampleCellInk(alpha, width, height, x - 1, y) - 4 * sampleCellInk(alpha, width, height, x, y) +
            sampleCellInk(alpha, width, height, x + 1, y) +
            sampleCellInk(alpha, width, height, x, y + 1)
          : -sampleCellInk(alpha, width, height, x - 1, y - 1) +
            sampleCellInk(alpha, width, height, x + 1, y - 1) -
            2 * sampleCellInk(alpha, width, height, x - 1, y) +
            2 * sampleCellInk(alpha, width, height, x + 1, y) -
            sampleCellInk(alpha, width, height, x - 1, y + 1) +
            sampleCellInk(alpha, width, height, x + 1, y + 1);
      const gy =
        edgeMode === "laplacian"
          ? gx
          : -sampleCellInk(alpha, width, height, x - 1, y - 1) -
            2 * sampleCellInk(alpha, width, height, x, y - 1) -
            sampleCellInk(alpha, width, height, x + 1, y - 1) +
            sampleCellInk(alpha, width, height, x - 1, y + 1) +
            2 * sampleCellInk(alpha, width, height, x, y + 1) +
            sampleCellInk(alpha, width, height, x + 1, y + 1);
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

function sampleCellInk(alpha: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const clampedX = Math.max(0, Math.min(width - 1, x));
  const clampedY = Math.max(0, Math.min(height - 1, y));
  return getInkValue(alpha[clampedY * width + clampedX] ?? 0);
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

function getNormalizedCorrelation(left: Uint8ClampedArray, right: Uint8ClampedArray, mode: SimilarGlyphSearchMatchingParams["template"]["mode"]) {
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

function createBits(alpha: Uint8ClampedArray) {
  let bits = "";

  for (let index = 0; index < alpha.length; index += 1) {
    bits += alpha[index] > INK_THRESHOLD ? "1" : "0";
  }

  return bits;
}

function flushResults(id: number, results: SimilarGlyphSearchResult[], checkedPageCount: number, checkedCodePointCount: number) {
  if (results.length === 0) {
    return;
  }

  workerScope.postMessage({ type: "batch", id, results: results.splice(0, results.length), checkedPageCount, checkedCodePointCount });
}

function shouldSkipCodePoint(codePoint: number) {
  return codePoint < 0x20 || isSurrogateCodePoint(codePoint) || isNonCharacterCodePoint(codePoint);
}

function isSurrogateCodePoint(codePoint: number) {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

function isNonCharacterCodePoint(codePoint: number) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe;
}

export {};
