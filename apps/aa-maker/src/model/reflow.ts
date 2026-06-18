import { createEmptyCell } from "./createDocument";
import { getCharWidth } from "./gridOperations";
import type { Cell, CellGrid, Document, Stamp, StampCell } from "./types";
import type { WidthMode } from "./widthMode";

type StampCollection = {
  stamps: Stamp[];
};

type ReflowedStampRows = {
  rows: (StampCell | null)[][];
  width: number;
  height: number;
};

export function reflowDocumentToWidthMode(documentModel: Document, widthMode: WidthMode) {
  for (const layer of documentModel.layers) {
    const nextCells = reflowCellGrid(layer.cells, widthMode, documentModel.width);
    layer.cells.splice(0, layer.cells.length, ...nextCells);
  }
}

export function reflowStampCollectionsToWidthMode(stampCollections: StampCollection[], widthMode: WidthMode) {
  for (const collection of stampCollections) {
    for (const stamp of collection.stamps) {
      const nextStamp = reflowStamp(stamp, widthMode);
      stamp.cells.splice(0, stamp.cells.length, ...nextStamp.rows);
      stamp.width = nextStamp.width;
      stamp.height = nextStamp.height;
    }
  }
}

function reflowStamp(stamp: Stamp, widthMode: WidthMode): ReflowedStampRows {
  const rows = stamp.cells.map((row) => reflowStampRow(row, widthMode));
  const width = Math.max(1, ...rows.map((row) => row.length));
  const height = Math.max(1, rows.length);
  const paddedRows = (rows.length > 0 ? rows : [Array.from({ length: 1 }, () => null as StampCell | null)]).map((row) => [
    ...row,
    ...Array.from({ length: Math.max(0, width - row.length) }, () => null as StampCell | null),
  ]);

  return {
    rows: paddedRows,
    width,
    height,
  };
}

function reflowStampRow(row: (StampCell | null)[], widthMode: WidthMode) {
  const nextRow: (StampCell | null)[] = [];

  for (let sourceX = 0; sourceX < row.length; sourceX += 1) {
    const cell = row[sourceX];

    if (cell === null) {
      nextRow.push(null);
      continue;
    }

    const width = getCharWidth(cell.char, widthMode);
    nextRow.push({
      char: cell.char,
      width,
      fgc: cell.fgc,
      bgc: cell.bgc,
    });

    if (width === 2) {
      nextRow.push(null);
    }

    if (cell.width === 2) {
      sourceX += 1;
    }
  }

  return nextRow;
}

function reflowCellGrid(cellGrid: CellGrid, widthMode: WidthMode, gridWidth: number) {
  return cellGrid.map((row) => reflowRow(row, widthMode, gridWidth));
}

function reflowRow(row: Cell[], widthMode: WidthMode, gridWidth: number) {
  const nextRow: Cell[] = [];

  for (let sourceX = 0; sourceX < row.length; sourceX += 1) {
    const cell = row[sourceX];

    if (cell.kind === "empty") {
      nextRow.push(createEmptyCell());
      continue;
    }

    if (cell.kind === "wide-tail") {
      continue;
    }

    const width = getCharWidth(cell.char, widthMode);

    if (nextRow.length + width > gridWidth) {
      break;
    }

    nextRow.push({
      kind: "char",
      char: cell.char,
      width,
      fgc: cell.fgc,
      bgc: cell.bgc,
    });

    if (width === 2) {
      nextRow.push({
        kind: "wide-tail",
        headX: nextRow.length - 1,
      });
    }

    if (cell.width === 2) {
      sourceX += 1;
    }

    if (nextRow.length >= gridWidth) {
      break;
    }
  }

  while (nextRow.length < gridWidth) {
    nextRow.push(createEmptyCell());
  }

  return nextRow.slice(0, gridWidth);
}
