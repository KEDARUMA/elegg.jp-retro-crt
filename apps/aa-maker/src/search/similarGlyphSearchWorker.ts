import { getTerminalCharWidth, type WidthMode } from "../model/widthMode";

type SimilarGlyphSearchResult = {
  char: string;
  codePoint: number;
  score: number;
  width: 1 | 2;
};

type WorkerRequest = {
  id: number;
  pages: number[];
  pageSize: number;
  minCodePoint: number;
  maxCodePoint: number;
  targetChar: string;
  targetCodePoint: number;
  targetWidth: 1 | 2;
  fontFamily: string;
  canvasSize: number;
  threshold: number;
  widthMatch: boolean;
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
      checkedPageCount: number;
      checkedCodePointCount: number;
    }
  | {
      type: "done";
      id: number;
      checkedPageCount: number;
      checkedCodePointCount: number;
    };

type WorkerScope = typeof globalThis & {
  postMessage: (message: WorkerMessage) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

type GlyphImage = {
  alpha: Uint8ClampedArray;
  bits: string;
  inkPixelCount: number;
};

const workerScope = self as unknown as WorkerScope;
const FALLBACK_SAMPLE_CODE_POINTS = [0xfffd, 0x10ffff, 0xe0000];
const BATCH_SIZE = 24;
const PROGRESS_PAGE_INTERVAL = 8;

workerScope.onmessage = (event) => {
  searchSimilarGlyphs(event.data);
};

function searchSimilarGlyphs(request: WorkerRequest) {
  const renderer = createGlyphRenderer(request.canvasSize, request.fontFamily, request.widthMode);
  const targetImage = renderer.render(request.targetChar);
  const results: SimilarGlyphSearchResult[] = [];
  let checkedPageCount = 0;
  let checkedCodePointCount = 0;

  if (!targetImage) {
    workerScope.postMessage({ type: "done", id: request.id, checkedPageCount, checkedCodePointCount });
    return;
  }

  request.pages.forEach((page) => {
    const pageStart = page * request.pageSize;
    const pageEnd = pageStart + request.pageSize - 1;
    const codeStart = Math.max(request.minCodePoint, pageStart);
    const codeEnd = Math.min(request.maxCodePoint, pageEnd);

    for (let codePoint = codeStart; codePoint <= codeEnd; codePoint += 1) {
      if (shouldSkipCodePoint(codePoint)) {
        continue;
      }

      checkedCodePointCount += 1;

      const char = String.fromCodePoint(codePoint);
      const width = renderer.measureWidth(char);

      if (request.widthMatch && width !== request.targetWidth) {
        continue;
      }

      const image = renderer.render(char);

      if (!image || renderer.isFallback(image)) {
        continue;
      }

      const score = getImageDifferenceScore(targetImage, image);

      if (score <= request.threshold) {
        results.push({ char, codePoint, score: Math.round(score * 100) / 100, width });
      }

      if (results.length >= BATCH_SIZE) {
        flushResults(request.id, results, checkedPageCount, checkedCodePointCount);
      }
    }

    checkedPageCount += 1;

    if (checkedPageCount % PROGRESS_PAGE_INTERVAL === 0) {
      workerScope.postMessage({ type: "progress", id: request.id, checkedPageCount, checkedCodePointCount });
    }
  });

  flushResults(request.id, results, checkedPageCount, checkedCodePointCount);
  workerScope.postMessage({ type: "done", id: request.id, checkedPageCount, checkedCodePointCount });
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
    FALLBACK_SAMPLE_CODE_POINTS.map((codePoint) => renderNormalizedGlyph(sourceContext, normalizedContext, sourceSize, canvasSize, String.fromCodePoint(codePoint)))
      .filter((image): image is GlyphImage => image !== null)
      .map((image) => image.bits),
  );

  return {
    render(char: string) {
      return renderNormalizedGlyph(sourceContext, normalizedContext, sourceSize, canvasSize, char);
    },
    isFallback(image: GlyphImage) {
      return fallbackBits.has(image.bits);
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
): GlyphImage | null {
  sourceContext.clearRect(0, 0, sourceSize, sourceSize);
  sourceContext.fillText(char, sourceSize / 2, sourceSize / 2);

  const sourceImage = sourceContext.getImageData(0, 0, sourceSize, sourceSize);
  const bounds = getInkBounds(sourceImage.data, sourceSize);

  if (!bounds) {
    return null;
  }

  normalizedContext.clearRect(0, 0, canvasSize, canvasSize);
  normalizedContext.drawImage(
    sourceContext.canvas,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    1,
    1,
    Math.max(1, canvasSize - 2),
    Math.max(1, canvasSize - 2),
  );

  const normalizedData = normalizedContext.getImageData(0, 0, canvasSize, canvasSize).data;
  const alpha = new Uint8ClampedArray(canvasSize * canvasSize);
  let bits = "";
  let inkPixelCount = 0;

  for (let sourceIndex = 3, targetIndex = 0; sourceIndex < normalizedData.length; sourceIndex += 4, targetIndex += 1) {
    const value = normalizedData[sourceIndex];
    const hasInk = value > 12;

    alpha[targetIndex] = value;
    bits += hasInk ? "1" : "0";

    if (hasInk) {
      inkPixelCount += 1;
    }
  }

  return inkPixelCount > 0 ? { alpha, bits, inkPixelCount } : null;
}

function getInkBounds(data: Uint8ClampedArray, size: number) {
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

function getImageDifferenceScore(target: GlyphImage, candidate: GlyphImage) {
  let total = 0;

  for (let index = 0; index < target.alpha.length; index += 1) {
    total += Math.abs(target.alpha[index] - candidate.alpha[index]);
  }

  return (total / target.alpha.length / 255) * 100;
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
