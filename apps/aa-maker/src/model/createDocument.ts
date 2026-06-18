import type { CellGrid, Document, EmptyCell, Layer, ToolState } from "./types";

export const DEFAULT_GRID_WIDTH = 80;
export const DEFAULT_GRID_HEIGHT = 25;
export const MIN_GRID_SIZE = 1;
export const MAX_GRID_SIZE = 256;
export const DEFAULT_CANVAS_BGC = "000000";
export const DEFAULT_DOCUMENT_NAME = "aa-maker";
export const NBSP = "\u00a0";
export const CP437_FULL_BLOCK = "\u2588";

export function createEmptyDocument(canvasBGC = DEFAULT_CANVAS_BGC, width = DEFAULT_GRID_WIDTH, height = DEFAULT_GRID_HEIGHT): Document {
  const layer = createLayer("layer-1", "Layer 1", width, height);

  return {
    version: 1,
    name: DEFAULT_DOCUMENT_NAME,
    width,
    height,
    canvasBGC,
    layers: [layer],
    activeLayerId: layer.id,
    nextLayerNumber: 2,
  };
}

export function createInitialToolState(canvasBGC = DEFAULT_CANVAS_BGC): ToolState {
  return {
    activeTool: "pen",
    selectedChar: CP437_FULL_BLOCK,
    selectedCharWidth: 1,
    selectedFGC: invertHexColor(canvasBGC),
    selectedBGC: null,
    highlight: { kind: "none" },
    zoom: 1,
  };
}

export function createLayer(id: string, name: string, width = DEFAULT_GRID_WIDTH, height = DEFAULT_GRID_HEIGHT): Layer {
  return {
    id,
    name,
    visible: true,
    locked: false,
    cells: createEmptyGrid(width, height),
  };
}

export function createEmptyGrid(width = DEFAULT_GRID_WIDTH, height = DEFAULT_GRID_HEIGHT): CellGrid {
  return Array.from({ length: height }, () => Array.from({ length: width }, createEmptyCell));
}

export function createEmptyCell(): EmptyCell {
  return { kind: "empty" };
}

function invertHexColor(color: string) {
  return color
    .match(/.{2}/g)!
    .map((value) => (255 - Number.parseInt(value, 16)).toString(16).padStart(2, "0"))
    .join("");
}
