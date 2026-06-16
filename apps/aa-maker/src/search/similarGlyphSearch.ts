import type { WidthMode } from "../model/widthMode";
import { DEFAULT_IMAGE_TO_ASCII_MATCHING_PARAMS } from "./imageToAsciiMatching";
import type { ImageToAsciiMatchingMethod, ImageToAsciiMatchingParams } from "./imageToAsciiMatching";

export type SimilarGlyphSearchMatchingMethod = ImageToAsciiMatchingMethod;
export type SimilarGlyphSearchMatchingParams = ImageToAsciiMatchingParams;

export const DEFAULT_SIMILAR_GLYPH_SEARCH_MATCHING_METHOD: SimilarGlyphSearchMatchingMethod = "contour-shape";

export function createDefaultSimilarGlyphSearchMatchingParams() {
  return JSON.parse(JSON.stringify(DEFAULT_IMAGE_TO_ASCII_MATCHING_PARAMS)) as SimilarGlyphSearchMatchingParams;
}

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
  targetBitmap?: number[];
  fontFamily: string;
  canvasSize: number;
  threshold: number;
  maxResults: number;
  matchingMethod: SimilarGlyphSearchMatchingMethod;
  matchingParams: SimilarGlyphSearchMatchingParams;
  workerCount: number;
  widthMode: WidthMode;
};

export type SimilarGlyphSearchProgress = {
  phase: "preparing" | "scanning";
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
  const targetBitmap = options.targetBitmap ? [...options.targetBitmap] : undefined;
  const matchingParams = JSON.parse(JSON.stringify(options.matchingParams)) as SimilarGlyphSearchMatchingParams;
  let cancelled = false;
  let resultCount = 0;

  callbacks.onProgress(createProgress(workerProgress, resultCount, pages.length, "preparing"));

  if (pages.length === 0) {
    queueMicrotask(() => finish(false));

    return {
      cancel() {
        finish(true);
      },
    };
  }

  try {
    pageChunks.forEach((chunk, index) => {
      const worker = new Worker(new URL("./similarGlyphSearchWorker.ts", import.meta.url), { type: "module" });
      workers.push(worker);

      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        const message = event.data;

        if (cancelled) {
          return;
        }

        if (message.type === "error") {
          cancelled = true;
          workers.forEach((item) => item.terminate());
          callbacks.onError(message.message || "Similar glyph search worker failed.");
          return;
        }

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
            callbacks.onProgress(createProgress(workerProgress, resultCount, pages.length, "scanning"));
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

        const currentProgress = createProgress(
          workerProgress,
          resultCount,
          pages.length,
          message.type === "progress" ? (message.phase ?? "scanning") : "scanning",
        );
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
        callbacks.onError(createWorkerErrorMessage(event));
      };

      worker.postMessage({
        id: index,
        pages: chunk,
        pageSize: options.pageData.pageSize,
        minCodePoint: options.pageData.range.start,
        maxCodePoint: options.pageData.range.end,
        targetChar: options.targetChar,
        targetCodePoint: options.targetChar.codePointAt(0) ?? -1,
        targetBitmap,
        fontFamily: options.fontFamily,
        canvasSize: options.canvasSize,
        threshold: options.threshold,
        matchingMethod: options.matchingMethod,
        matchingParams,
        widthMode: options.widthMode,
      } satisfies WorkerRequest);
    });
  } catch (error) {
    cancelled = true;
    workers.forEach((worker) => worker.terminate());
    throw error;
  }

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
    callbacks.onDone(createProgress(workerProgress, resultCount, pages.length, "scanning"), wasCancelled);
  }
}

function createWorkerErrorMessage(event: ErrorEvent) {
  if (!event.message) {
    return "Similar glyph search worker failed.";
  }

  const location = event.filename ? `${event.filename}${event.lineno ? `:${event.lineno}${event.colno ? `:${event.colno}` : ""}` : ""}` : "";

  return location ? `Similar glyph search worker failed: ${event.message} (${location})` : `Similar glyph search worker failed: ${event.message}`;
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

function createProgress(
  workerProgress: { checkedPageCount: number; checkedCodePointCount: number }[],
  resultCount: number,
  totalPageCount: number,
  phase: SimilarGlyphSearchProgress["phase"],
) {
  return {
    phase,
    checkedPageCount: workerProgress.reduce((total, progress) => total + progress.checkedPageCount, 0),
    checkedCodePointCount: workerProgress.reduce((total, progress) => total + progress.checkedCodePointCount, 0),
    resultCount,
    totalPageCount,
  };
}

function getWorkerCount(workerCount: number, pageCount: number) {
  if (!Number.isFinite(workerCount)) {
    return 1;
  }

  return Math.max(1, Math.min(MAX_WORKER_COUNT, pageCount, Math.floor(workerCount)));
}
