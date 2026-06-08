import type { CompositedCell, Document } from "./types";

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

        result[y][x] = {
          char: cell.char,
          fgc: cell.fgc,
          bgc: cell.bgc ?? documentModel.canvasBGC,
          sourceLayerId: layer.id,
        };
      }
    }
  }

  return result;
}

function createEmptyCompositedGrid(documentModel: Document): CompositedCell[][] {
  return Array.from({ length: documentModel.height }, () =>
    Array.from({ length: documentModel.width }, () => ({
      char: " ",
      fgc: null,
      bgc: documentModel.canvasBGC,
      sourceLayerId: null,
    })),
  );
}
