import type { Cell, CompositedCell, Document } from "./types";

export function composeDocument(documentModel: Document): CompositedCell[][] {
  const result = createEmptyCompositedGrid(documentModel);

  for (const layer of documentModel.layers) {
    if (!layer.visible) {
      continue;
    }

    for (let y = 0; y < documentModel.height; y += 1) {
      for (let x = 0; x < documentModel.width; x += 1) {
        const cell = layer.cells[y][x];

        if (cell.kind !== "char") {
          continue;
        }

        placeCompositedChar(result, documentModel, layer.id, cell, x, y);
      }
    }
  }

  normalizeWideCells(result, documentModel);

  return result;
}

function placeCompositedChar(result: CompositedCell[][], documentModel: Document, layerId: string, cell: Extract<Cell, { kind: "char" }>, x: number, y: number) {
  const bgc = cell.bgc ?? documentModel.canvasBGC;

  result[y][x] = {
    kind: "char",
    char: cell.char,
    width: cell.width,
    fgc: cell.fgc,
    bgc,
    sourceLayerId: layerId,
  };

  if (cell.width === 2 && x + 1 < documentModel.width) {
    result[y][x + 1] = {
      kind: "wide-tail",
      char: " ",
      width: 1,
      fgc: cell.fgc,
      bgc,
      sourceLayerId: layerId,
      headX: x,
    };
  }
}

function normalizeWideCells(result: CompositedCell[][], documentModel: Document) {
  for (let y = 0; y < documentModel.height; y += 1) {
    for (let x = 0; x < documentModel.width; x += 1) {
      const cell = result[y][x];

      if (cell.kind === "char" && cell.width === 2 && !hasValidCompositedTail(result, x, y, cell.sourceLayerId)) {
        result[y][x] = createEmptyCompositedCell(documentModel);
        continue;
      }

      if (cell.kind === "wide-tail" && !hasValidCompositedHead(result, cell.headX ?? -1, y, cell.sourceLayerId)) {
        result[y][x] = createEmptyCompositedCell(documentModel);
      }
    }
  }
}

function hasValidCompositedTail(result: CompositedCell[][], headX: number, y: number, sourceLayerId: string | null) {
  const tail = result[y][headX + 1];
  return tail?.kind === "wide-tail" && tail.headX === headX && tail.sourceLayerId === sourceLayerId;
}

function hasValidCompositedHead(result: CompositedCell[][], headX: number, y: number, sourceLayerId: string | null) {
  const head = result[y][headX];
  return head?.kind === "char" && head.width === 2 && head.sourceLayerId === sourceLayerId;
}

function createEmptyCompositedGrid(documentModel: Document): CompositedCell[][] {
  return Array.from({ length: documentModel.height }, () =>
    Array.from({ length: documentModel.width }, () => createEmptyCompositedCell(documentModel)),
  );
}

function createEmptyCompositedCell(documentModel: Document): CompositedCell {
  return {
    kind: "empty",
    char: " ",
    width: 1,
    fgc: null,
    bgc: documentModel.canvasBGC,
    sourceLayerId: null,
  };
}
