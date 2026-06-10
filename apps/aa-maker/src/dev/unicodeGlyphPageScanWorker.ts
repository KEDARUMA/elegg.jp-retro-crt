type UnicodeGlyphPageScanWorkerRequest = {
  id: number;
  firstPage: number;
  pageCount: number;
  pageSize: number;
  minCodePoint: number;
  maxCodePoint: number;
  canvasSize: number;
  font: string;
  notdefFilter: boolean;
};

type UnicodeGlyphPageScanPage = {
  page: number;
  present: boolean;
  checkedCodePointCount: number;
};

type UnicodeGlyphPageScanWorkerResponse = {
  id: number;
  pages: UnicodeGlyphPageScanPage[];
};

type WorkerScope = typeof globalThis & {
  postMessage: (message: UnicodeGlyphPageScanWorkerResponse) => void;
  onmessage: ((event: MessageEvent<UnicodeGlyphPageScanWorkerRequest>) => void) | null;
};

type GlyphSignature = {
  inkPixelCount: number;
  bits: string;
};

const workerScope = self as unknown as WorkerScope;
const FALLBACK_SAMPLE_CODE_POINTS = [0xfffd, 0x10ffff, 0xe0000];

workerScope.onmessage = (event) => {
  const request = event.data;
  workerScope.postMessage({
    id: request.id,
    pages: scanPages(request),
  });
};

function scanPages(request: UnicodeGlyphPageScanWorkerRequest) {
  const renderer = createGlyphRenderer(request.canvasSize, request.font, request.notdefFilter);
  const pages: UnicodeGlyphPageScanPage[] = [];

  for (let page = request.firstPage; page < request.firstPage + request.pageCount; page += 1) {
    const pageStart = page * request.pageSize;
    const pageEnd = pageStart + request.pageSize - 1;
    const codeStart = Math.max(request.minCodePoint, pageStart);
    const codeEnd = Math.min(request.maxCodePoint, pageEnd);
    let checkedCodePointCount = 0;
    let present = false;

    for (let codePoint = codeStart; codePoint <= codeEnd; codePoint += 1) {
      if (shouldSkipCodePoint(codePoint)) {
        continue;
      }

      checkedCodePointCount += 1;

      if (renderer.hasVisibleGlyph(String.fromCodePoint(codePoint))) {
        present = true;
        break;
      }
    }

    pages.push({ page, present, checkedCodePointCount });
  }

  return pages;
}

function createGlyphRenderer(canvasSize: number, font: string, notdefFilter: boolean) {
  const canvas = new OffscreenCanvas(canvasSize, canvasSize);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Unicode glyph page scan failed: 2D canvas is not available.");
  }

  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = font;
  context.fillStyle = "#000000";

  const fallbackBits = new Set(
    FALLBACK_SAMPLE_CODE_POINTS.map((codePoint) => renderGlyph(context, canvasSize, String.fromCodePoint(codePoint)))
      .filter((signature) => signature.inkPixelCount > 0)
      .map((signature) => signature.bits),
  );

  return {
    hasVisibleGlyph(char: string) {
      const signature = renderGlyph(context, canvasSize, char);

      if (signature.inkPixelCount === 0) {
        return false;
      }

      return !notdefFilter || !fallbackBits.has(signature.bits);
    },
  };
}

function renderGlyph(context: OffscreenCanvasRenderingContext2D, canvasSize: number, char: string): GlyphSignature {
  context.clearRect(0, 0, canvasSize, canvasSize);
  context.fillText(char, canvasSize / 2, canvasSize / 2);

  const data = context.getImageData(0, 0, canvasSize, canvasSize).data;
  let inkPixelCount = 0;
  let bits = "";

  for (let index = 3; index < data.length; index += 4) {
    const hasInk = data[index] > 12;

    if (hasInk) {
      inkPixelCount += 1;
    }

    bits += hasInk ? "1" : "0";
  }

  return { inkPixelCount, bits };
}

function shouldSkipCodePoint(codePoint: number) {
  return isSurrogateCodePoint(codePoint) || isNonCharacterCodePoint(codePoint);
}

function isSurrogateCodePoint(codePoint: number) {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

function isNonCharacterCodePoint(codePoint: number) {
  return (codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe;
}

export {};
