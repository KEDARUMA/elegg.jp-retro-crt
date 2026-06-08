import type { CellGrid, Document, EmptyCell, Layer, ToolState } from "./types";

export const GRID_WIDTH = 80;
export const GRID_HEIGHT = 25;
export const DEFAULT_CANVAS_BGC = "ffffff";
export const DEFAULT_SELECTED_FGC = "000000";
export const NBSP = "\u00a0";

export function createEmptyDocument(): Document {
  const layer = createLayer("layer-1", "Layer 1");

  return {
    version: 1,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    canvasBGC: DEFAULT_CANVAS_BGC,
    layers: [layer],
    activeLayerId: layer.id,
    nextLayerNumber: 2,
  };
}

export function createInitialToolState(): ToolState {
  return {
    activeTool: "pen",
    selectedChar: NBSP,
    selectedFGC: DEFAULT_SELECTED_FGC,
    selectedBGC: null,
    selection: { kind: "none" },
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
