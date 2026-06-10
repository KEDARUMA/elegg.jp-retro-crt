export type SimilarGlyphSearchResult = {
  char: string;
  codePoint: number;
  score: number;
  width: 1 | 2;
};

export type UnicodeGlyphPageData = {
  pageSize: number;
  range: {
    start: number;
    end: number;
  };
  pageRuns: {
    startPage: number;
    present: boolean;
    count: number;
  }[];
};

export type SimilarGlyphSearchOptions = {
  pageData: UnicodeGlyphPageData;
  targetChar: string;
  targetWidth: 1 | 2;
  fontFamily: string;
  canvasSize: number;
  threshold: number;
  widthMatch: boolean;
  maxResults: number;
  workerCount: number;
};

export type SimilarGlyphSearchProgress = {
  checkedPageCount: number;
  checkedCodePointCount: number;
  resultCount: number;
  totalPageCount: number;
};

export type SimilarGlyphSearchHandle = {
  cancel: () => void;
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

type SimilarGlyphSearchCallbacks = {
  onResults: (results: SimilarGlyphSearchResult[]) => void;
  onProgress: (progress: SimilarGlyphSearchProgress) => void;
  onDone: (progress: SimilarGlyphSearchProgress, cancelled: boolean) => void;
  onError: (message: string) => void;
};

const MAX_WORKER_COUNT = 4;

export function startSimilarGlyphSearch(options: SimilarGlyphSearchOptions, callbacks: SimilarGlyphSearchCallbacks): SimilarGlyphSearchHandle {
  const pages = expandPresentPages(options.pageData);
  const workerCount = getWorkerCount(options.workerCount, pages.length);
  const pageChunks = createPageChunks(pages, workerCount);
  const workers: Worker[] = [];
  const workerProgress = pageChunks.map(() => ({ checkedPageCount: 0, checkedCodePointCount: 0, done: false }));
  let cancelled = false;
  let resultCount = 0;

  pageChunks.forEach((chunk, index) => {
    const worker = new Worker(new URL("./similarGlyphSearchWorker.ts", import.meta.url), { type: "module" });
    workers.push(worker);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      const progress = workerProgress[message.id];

      if (!progress || cancelled) {
        return;
      }

      if (message.type === "batch") {
        progress.checkedPageCount = message.checkedPageCount;
        progress.checkedCodePointCount = message.checkedCodePointCount;

        const availableCount = options.maxResults - resultCount;
        const nextResults = message.results.slice(0, availableCount);

        if (nextResults.length > 0) {
          resultCount += nextResults.length;
          callbacks.onResults(nextResults);
          callbacks.onProgress(createProgress(workerProgress, resultCount, pages.length));
        }

        if (resultCount >= options.maxResults) {
          finish(true);
        }

        return;
      }

      progress.checkedPageCount = message.checkedPageCount;
      progress.checkedCodePointCount = message.checkedCodePointCount;

      if (message.type === "done") {
        progress.done = true;
      }

      const currentProgress = createProgress(workerProgress, resultCount, pages.length);
      callbacks.onProgress(currentProgress);

      if (workerProgress.every((item) => item.done)) {
        finish(false);
      }
    };

    worker.onerror = (event) => {
      if (cancelled) {
        return;
      }

      cancelled = true;
      workers.forEach((item) => item.terminate());
      callbacks.onError(event.message || "Similar glyph search worker failed.");
    };

    worker.postMessage({
      id: index,
      pages: chunk,
      pageSize: options.pageData.pageSize,
      minCodePoint: options.pageData.range.start,
      maxCodePoint: options.pageData.range.end,
      targetChar: options.targetChar,
      targetCodePoint: options.targetChar.codePointAt(0) ?? -1,
      targetWidth: options.targetWidth,
      fontFamily: options.fontFamily,
      canvasSize: options.canvasSize,
      threshold: options.threshold,
      widthMatch: options.widthMatch,
    } satisfies WorkerRequest);
  });

  return {
    cancel() {
      finish(true);
    },
  };

  function finish(wasCancelled: boolean) {
    if (cancelled) {
      return;
    }

    cancelled = true;
    workers.forEach((worker) => worker.terminate());
    callbacks.onDone(createProgress(workerProgress, resultCount, pages.length), wasCancelled);
  }
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

function createPageChunks(pages: number[], workerCount: number) {
  const chunks = Array.from({ length: workerCount }, () => [] as number[]);

  pages.forEach((page, index) => {
    chunks[index % workerCount].push(page);
  });

  return chunks.filter((chunk) => chunk.length > 0);
}

function createProgress(workerProgress: { checkedPageCount: number; checkedCodePointCount: number }[], resultCount: number, totalPageCount: number) {
  return {
    checkedPageCount: workerProgress.reduce((total, progress) => total + progress.checkedPageCount, 0),
    checkedCodePointCount: workerProgress.reduce((total, progress) => total + progress.checkedCodePointCount, 0),
    resultCount,
    totalPageCount,
  };
}

function getWorkerCount(workerCount: number, pageCount: number) {
  return Math.max(1, Math.min(MAX_WORKER_COUNT, pageCount, Math.floor(workerCount)));
}
