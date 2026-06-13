import type { WidthMode } from "../model/widthMode";
import type { UnicodeGlyphPageData } from "./similarGlyphSearch";

export type ImageToAsciiGlyphPolarity = "white-on-black" | "black-on-white";

export type ImageToAsciiApplyCell = {
  char: string;
  width: 1 | 2;
};

export type ImageToAsciiApplyGrid = (ImageToAsciiApplyCell | null)[][];

export type ImageToAsciiCellUpdate = {
  layer: "half" | "full";
  x: number;
  y: number;
  cell: (ImageToAsciiApplyCell & { score: number }) | null;
};

export type ImageToAsciiProcessingCell = {
  phase: "match-half" | "match-full";
  x: number;
  y: number;
  width: 1 | 2;
};

export type ImageToAsciiMatchResult = {
  halfText: string;
  fullText: string;
  compositeText: string;
  cells: ImageToAsciiApplyGrid;
  matchedHalfCount: number;
  matchedFullCount: number;
  averageScore: number;
};

export type ImageToAsciiMatchRowResult = {
  y: number;
  cells: (ImageToAsciiApplyCell | null)[];
  halfText: string;
  fullText: string;
  compositeText: string;
};

export type ImageToAsciiMatchRangeResult = {
  rowStart: number;
  rowEnd: number;
  rows: ImageToAsciiMatchRowResult[];
  matchedHalfCount: number;
  matchedFullCount: number;
  scoreTotal: number;
};

export type ImageToAsciiMatchProgress = {
  phase: "load-cache" | "index-half" | "index-full" | "save-cache" | "match-half" | "match-full";
  checkedCodePointCount: number;
  totalCodePointCount: number;
  matchedCellCount: number;
  totalCellCount: number;
};

export type ImageToAsciiGlyphCacheOptions = {
  pageData: UnicodeGlyphPageData;
  fontFamily: string;
  glyphPolarity: ImageToAsciiGlyphPolarity;
  excludeColorEmoji: boolean;
  widthMode: WidthMode;
};

export type ImageToAsciiMatchOptions = ImageToAsciiGlyphCacheOptions & {
  imageAlpha: Uint8ClampedArray;
  threshold: number;
  includeFullWidth: boolean;
  workerCount?: number;
};

export type ImageToAsciiMatchHandle = {
  cancel: () => void;
};

export type ImageToAsciiGlyphCacheSummary = {
  halfCount: number;
  fullCount: number;
};

type WorkerRequest =
  | (Omit<ImageToAsciiMatchOptions, "workerCount"> & {
      id: number;
      kind: "match";
    })
  | (Omit<ImageToAsciiMatchOptions, "workerCount"> & {
      id: number;
      kind: "match-range";
      rowStart: number;
      rowEnd: number;
    })
  | (ImageToAsciiGlyphCacheOptions & {
      id: number;
      kind: "build-cache" | "prepare-cache";
    });

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

type ImageToAsciiMatchCallbacks = {
  onProgress: (progress: ImageToAsciiMatchProgress) => void;
  onCell?: (update: ImageToAsciiCellUpdate) => void;
  onProcessingCell?: (cell: ImageToAsciiProcessingCell | null) => void;
  onRangeResult?: (result: ImageToAsciiMatchRangeResult) => void;
  onResult: (result: ImageToAsciiMatchResult) => void;
  onError: (message: string) => void;
};

type ImageToAsciiGlyphCacheBuildCallbacks = {
  onProgress: (progress: ImageToAsciiMatchProgress) => void;
  onDone: (summary: ImageToAsciiGlyphCacheSummary) => void;
  onError: (message: string) => void;
};

let nextRequestId = 1;
const GRID_COLUMNS = 80;
const GRID_ROWS = 25;

export function startImageToAsciiMatching(options: ImageToAsciiMatchOptions, callbacks: ImageToAsciiMatchCallbacks): ImageToAsciiMatchHandle {
  const workerCount = normalizeWorkerCount(options.workerCount ?? 1);

  if (workerCount > 1) {
    return startParallelImageToAsciiMatching(options, workerCount, callbacks);
  }

  const imageAlpha = new Uint8ClampedArray(options.imageAlpha);
  const requestOptions: WorkerRequest = {
    ...options,
    id: nextRequestId,
    kind: "match",
    imageAlpha,
  };

  return startImageToAsciiWorker(requestOptions, callbacks, [imageAlpha.buffer as ArrayBuffer]);
}

function startParallelImageToAsciiMatching(
  options: ImageToAsciiMatchOptions,
  workerCount: number,
  callbacks: ImageToAsciiMatchCallbacks,
): ImageToAsciiMatchHandle {
  let finished = false;
  let prepareHandle: ImageToAsciiMatchHandle | null = null;
  const workerHandles: ImageToAsciiMatchHandle[] = [];

  const stopAll = () => {
    prepareHandle?.cancel();
    prepareHandle = null;
    workerHandles.splice(0).forEach((handle) => handle.cancel());
  };

  const fail = (message: string) => {
    if (finished) {
      return;
    }

    finished = true;
    stopAll();
    callbacks.onProcessingCell?.(null);
    callbacks.onError(message);
  };

  prepareHandle = startImageToAsciiWorker(
    {
      pageData: options.pageData,
      fontFamily: options.fontFamily,
      glyphPolarity: options.glyphPolarity,
      excludeColorEmoji: options.excludeColorEmoji,
      widthMode: options.widthMode,
      id: nextRequestId,
      kind: "prepare-cache",
    },
    {
      onProgress(progress) {
        if (!finished) {
          callbacks.onProgress(progress);
        }
      },
      onDone() {
        if (finished) {
          return;
        }

        prepareHandle = null;
        startRangeWorkers();
      },
      onError: fail,
    },
  );

  const startRangeWorkers = () => {
    const ranges = createRowRanges(workerCount);
    const rangeResults: (ImageToAsciiMatchRangeResult | null)[] = Array.from({ length: ranges.length }, () => null);
    const progressStates = ranges.map((range) => ({
      half: 0,
      full: 0,
      halfTotal: (range.rowEnd - range.rowStart) * GRID_COLUMNS,
      fullTotal: (range.rowEnd - range.rowStart) * (GRID_COLUMNS - 1),
    }));
    let remaining = ranges.length;

    ranges.forEach((range, index) => {
      const imageAlpha = new Uint8ClampedArray(options.imageAlpha);
      const handle = startImageToAsciiWorker(
        {
          pageData: options.pageData,
          imageAlpha,
          fontFamily: options.fontFamily,
          glyphPolarity: options.glyphPolarity,
          excludeColorEmoji: options.excludeColorEmoji,
          threshold: options.threshold,
          includeFullWidth: options.includeFullWidth,
          widthMode: options.widthMode,
          id: nextRequestId,
          kind: "match-range",
          rowStart: range.rowStart,
          rowEnd: range.rowEnd,
        },
        {
          onProgress(progress) {
            if (finished) {
              return;
            }

            updateParallelProgress(progressStates, index, progress, options.includeFullWidth, callbacks);
          },
          onCell(update) {
            if (!finished) {
              callbacks.onCell?.(update);
            }
          },
          onProcessingCell(cell) {
            if (!finished) {
              callbacks.onProcessingCell?.(cell);
            }
          },
          onRangeResult(result) {
            if (finished) {
              return;
            }

            rangeResults[index] = result;
            progressStates[index].half = progressStates[index].halfTotal;
            progressStates[index].full = options.includeFullWidth ? progressStates[index].fullTotal : 0;
            remaining -= 1;

            if (remaining > 0) {
              return;
            }

            finished = true;
            callbacks.onProcessingCell?.(null);
            callbacks.onResult(mergeRangeResults(rangeResults));
          },
          onResult() {
            fail("Image to AA matching failed: unexpected worker result.");
          },
          onError: fail,
        },
        [imageAlpha.buffer as ArrayBuffer],
      );

      workerHandles.push(handle);
    });
  };

  return {
    cancel() {
      if (finished) {
        return;
      }

      finished = true;
      stopAll();
    },
  };
}

export function startImageToAsciiGlyphCacheBuild(
  options: ImageToAsciiGlyphCacheOptions,
  callbacks: ImageToAsciiGlyphCacheBuildCallbacks,
): ImageToAsciiMatchHandle {
  return startImageToAsciiWorker(
    {
      ...options,
      id: nextRequestId,
      kind: "build-cache",
    },
    callbacks,
  );
}

function startImageToAsciiWorker(
  request: WorkerRequest,
  callbacks: ImageToAsciiMatchCallbacks | ImageToAsciiGlyphCacheBuildCallbacks,
  transfer?: Transferable[],
): ImageToAsciiMatchHandle {
  const worker = new Worker(new URL("./imageToAsciiMatchingWorker.ts", import.meta.url), { type: "module" });
  const requestId = nextRequestId;
  nextRequestId += 1;

  let finished = false;

  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data;

    if (finished || message.id !== requestId) {
      return;
    }

    if (message.type === "progress") {
      callbacks.onProgress(message.progress);
      return;
    }

    if (message.type === "cell") {
      if ("onCell" in callbacks) {
        callbacks.onCell?.(message.update);
      }
      return;
    }

    if (message.type === "processing-cell") {
      if ("onProcessingCell" in callbacks) {
        callbacks.onProcessingCell?.(message.cell);
      }
      return;
    }

    finished = true;
    worker.terminate();

    if (message.type === "result") {
      if ("onResult" in callbacks) {
        callbacks.onResult(message.result);
      }
      return;
    }

    if (message.type === "range-result") {
      if ("onRangeResult" in callbacks) {
        callbacks.onRangeResult?.(message.result);
      }
      return;
    }

    if (message.type === "cache-built") {
      if ("onDone" in callbacks) {
        callbacks.onDone(message.summary);
      }
      return;
    }

    callbacks.onError(message.message);
  };

  worker.onerror = (event) => {
    if (finished) {
      return;
    }

    finished = true;
    worker.terminate();
    callbacks.onError(event.message || "Image to AA matching worker failed.");
  };

  worker.postMessage({ ...request, id: requestId }, transfer ?? []);

  return {
    cancel() {
      if (finished) {
        return;
      }

      finished = true;
      worker.terminate();
    },
  };
}

function normalizeWorkerCount(workerCount: number) {
  if (!Number.isFinite(workerCount)) {
    return 1;
  }

  return Math.min(GRID_ROWS, Math.max(1, Math.round(workerCount)));
}

function createRowRanges(workerCount: number) {
  const rangeCount = Math.min(workerCount, GRID_ROWS);
  const baseRows = Math.floor(GRID_ROWS / rangeCount);
  const extraRows = GRID_ROWS % rangeCount;
  const ranges: { rowStart: number; rowEnd: number }[] = [];
  let rowStart = 0;

  for (let index = 0; index < rangeCount; index += 1) {
    const rowCount = baseRows + (index < extraRows ? 1 : 0);
    ranges.push({ rowStart, rowEnd: rowStart + rowCount });
    rowStart += rowCount;
  }

  return ranges;
}

function updateParallelProgress(
  states: { half: number; full: number; halfTotal: number; fullTotal: number }[],
  index: number,
  progress: ImageToAsciiMatchProgress,
  includeFullWidth: boolean,
  callbacks: ImageToAsciiMatchCallbacks,
) {
  if (progress.phase !== "match-half" && progress.phase !== "match-full") {
    if (progress.phase !== "load-cache") {
      callbacks.onProgress(progress);
    }
    return;
  }

  const state = states[index];

  if (!state) {
    return;
  }

  if (progress.phase === "match-half") {
    state.half = Math.min(state.halfTotal, progress.matchedCellCount);
  } else {
    state.half = state.halfTotal;
    state.full = Math.min(state.fullTotal, progress.matchedCellCount);
  }

  const halfMatched = states.reduce((total, item) => total + item.half, 0);
  const halfTotal = states.reduce((total, item) => total + item.halfTotal, 0);

  if (!includeFullWidth || halfMatched < halfTotal) {
    callbacks.onProgress({
      ...progress,
      phase: "match-half",
      matchedCellCount: halfMatched,
      totalCellCount: halfTotal,
    });
    return;
  }

  const fullMatched = states.reduce((total, item) => total + item.full, 0);
  const fullTotal = states.reduce((total, item) => total + item.fullTotal, 0);
  callbacks.onProgress({
    ...progress,
    phase: "match-full",
    matchedCellCount: fullMatched,
    totalCellCount: fullTotal,
  });
}

function mergeRangeResults(results: (ImageToAsciiMatchRangeResult | null)[]): ImageToAsciiMatchResult {
  const rows = results
    .flatMap((result) => result?.rows ?? [])
    .sort((left, right) => left.y - right.y);
  const scoreTotal = results.reduce((total, result) => total + (result?.scoreTotal ?? 0), 0);

  return {
    halfText: rows.map((row) => row.halfText).join("\n"),
    fullText: rows.map((row) => row.fullText).join("\n"),
    compositeText: rows.map((row) => row.compositeText).join("\n"),
    cells: rows.map((row) => row.cells),
    matchedHalfCount: results.reduce((total, result) => total + (result?.matchedHalfCount ?? 0), 0),
    matchedFullCount: results.reduce((total, result) => total + (result?.matchedFullCount ?? 0), 0),
    averageScore: Math.round((scoreTotal / (GRID_COLUMNS * GRID_ROWS)) * 100) / 100,
  };
}
