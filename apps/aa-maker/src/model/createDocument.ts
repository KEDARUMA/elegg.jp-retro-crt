import type { CellGrid, Document, EmptyCell, Layer, ToolState } from "./types";

export const GRID_WIDTH = 80;
export const GRID_HEIGHT = 25;
export const DEFAULT_CANVAS_BGC = "ffffff";
export const DEFAULT_SELECTED_FGC = "000000";
export const DEFAULT_DOCUMENT_NAME = "aa-maker";
export const NBSP = "\u00a0";
export const CP437_FULL_BLOCK = "\u2588";

export function createEmptyDocument(canvasBGC = DEFAULT_CANVAS_BGC): Document {
  const layer = createLayer("layer-1", "Layer 1");

  return {
    version: 1,
    name: DEFAULT_DOCUMENT_NAME,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    canvasBGC,
    layers: [layer],
    activeLayerId: layer.id,
    nextLayerNumber: 2,
  };
}

export function createInitialToolState(): ToolState {
  return {
    activeTool: "pen",
    selectedChar: CP437_FULL_BLOCK,
    selectedCharWidth: 1,
    selectedFGC: DEFAULT_SELECTED_FGC,
    selectedBGC: null,
    highlight: { kind: "none" },
    zoom: 1,
  };
}

export function createLayer(id: string, name: string): Layer {
  return {
    id,
    name,
    visible: true,
    locked: false,
    cells: createEmptyGrid(),
  };
}

export function createEmptyGrid(): CellGrid {
  return Array.from({ length: GRID_HEIGHT }, () => Array.from({ length: GRID_WIDTH }, createEmptyCell));
}

export function createEmptyCell(): EmptyCell {
  return { kind: "empty" };
}
