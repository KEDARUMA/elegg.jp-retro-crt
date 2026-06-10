export type UnicodeGlyphPageScanRun = {
  startPage: number;
  present: boolean;
  count: number;
};

export type UnicodeGlyphPageScanResult = {
  version: 1;
  source: "aa-maker-canvas-glyph-page-scan";
  pageSize: number;
  firstPage: number;
  pageCount: number;
  range: {
    start: number;
    end: number;
  };
  scan: {
    canvasSize: number;
    font: string;
    workerCount: number;
    notdefFilter: boolean;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    checkedCodePointCount: number;
    presentPageCount: number;
  };
  pageRuns: UnicodeGlyphPageScanRun[];
};

type UnicodeGlyphPageScanOptions = {
  firstPage: number;
  pageCount: number;
  pageSize: number;
  minCodePoint: number;
  maxCodePoint: number;
  canvasSize: number;
  font: string;
  workerCount: number;
  notdefFilter: boolean;
};

type UnicodeGlyphPageScanPage = {
  page: number;
  present: boolean;
  checkedCodePointCount: number;
};

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

type UnicodeGlyphPageScanWorkerResponse = {
  id: number;
  pages: UnicodeGlyphPageScanPage[];
};

const MAX_WORKER_COUNT = 4;

export async function scanUnicodeGlyphPages(options: UnicodeGlyphPageScanOptions): Promise<UnicodeGlyphPageScanResult> {
  const startedAt = new Date();
  const startTime = performance.now();
  const workerCount = getWorkerCount(options.workerCount, options.pageCount);
  const pageChunks = createPageChunks(options.firstPage, options.pageCount, workerCount);
  const pages = (
    await Promise.all(
      pageChunks.map((chunk, index) =>
        scanUnicodeGlyphPageChunk({
          id: index,
          firstPage: chunk.firstPage,
          pageCount: chunk.pageCount,
          pageSize: options.pageSize,
          minCodePoint: options.minCodePoint,
          maxCodePoint: options.maxCodePoint,
          canvasSize: options.canvasSize,
          font: options.font,
          notdefFilter: options.notdefFilter,
        }),
      ),
    )
  )
    .flat()
    .sort((left, right) => left.page - right.page);
  const finishedAt = new Date();

  return {
    version: 1,
    source: "aa-maker-canvas-glyph-page-scan",
    pageSize: options.pageSize,
    firstPage: options.firstPage,
    pageCount: options.pageCount,
    range: {
      start: Math.max(options.minCodePoint, options.firstPage * options.pageSize),
      end: Math.min(options.maxCodePoint, (options.firstPage + options.pageCount) * options.pageSize - 1),
    },
    scan: {
      canvasSize: options.canvasSize,
      font: options.font,
      workerCount,
      notdefFilter: options.notdefFilter,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: Math.round(performance.now() - startTime),
      checkedCodePointCount: pages.reduce((total, page) => total + page.checkedCodePointCount, 0),
      presentPageCount: pages.filter((page) => page.present).length,
    },
    pageRuns: createPageRuns(pages),
  };
}

function scanUnicodeGlyphPageChunk(request: UnicodeGlyphPageScanWorkerRequest) {
  return new Promise<UnicodeGlyphPageScanPage[]>((resolve, reject) => {
    const worker = new Worker(new URL("./unicodeGlyphPageScanWorker.ts", import.meta.url), { type: "module" });

    worker.onmessage = (event: MessageEvent<UnicodeGlyphPageScanWorkerResponse>) => {
      if (event.data.id !== request.id) {
        return;
      }

      worker.terminate();
      resolve(event.data.pages);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "Unicode glyph page scan worker failed."));
    };
    worker.postMessage(request);
  });
}

function createPageChunks(firstPage: number, pageCount: number, workerCount: number) {
  const chunks: { firstPage: number; pageCount: number }[] = [];
  const baseCount = Math.floor(pageCount / workerCount);
  const extraCount = pageCount % workerCount;
  let nextPage = firstPage;

  for (let index = 0; index < workerCount; index += 1) {
    const chunkPageCount = baseCount + (index < extraCount ? 1 : 0);

    if (chunkPageCount > 0) {
      chunks.push({ firstPage: nextPage, pageCount: chunkPageCount });
      nextPage += chunkPageCount;
    }
  }

  return chunks;
}

function createPageRuns(pages: UnicodeGlyphPageScanPage[]) {
  const runs: UnicodeGlyphPageScanRun[] = [];

  pages.forEach((page) => {
    const previousRun = runs.at(-1);

    if (previousRun && previousRun.present === page.present) {
      previousRun.count += 1;
      return;
    }

    runs.push({ startPage: page.page, present: page.present, count: 1 });
  });

  return runs;
}

function getWorkerCount(workerCount: number, pageCount: number) {
  return Math.max(1, Math.min(MAX_WORKER_COUNT, pageCount, Math.floor(workerCount)));
}
