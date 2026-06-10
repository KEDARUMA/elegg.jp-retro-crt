export type Color = string;

export type Cell = EmptyCell | CharCell | WideTailCell;

export type EmptyCell = {
  kind: "empty";
};

export type CharCell = {
  kind: "char";
  char: string;
  width: 1 | 2;
  fgc: Color;
  bgc: Color | null;
};

export type WideTailCell = {
  kind: "wide-tail";
  headX: number;
};

export type CellGrid = Cell[][];

export type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  cells: CellGrid;
};

export type Document = {
  version: 1;
  name: string;
  width: 80;
  height: 25;
  canvasBGC: Color;
  layers: Layer[];
  activeLayerId: string;
  nextLayerNumber: number;
};

export type CompositedCell = {
  kind: "empty" | "char" | "wide-tail";
  char: string;
  width: 1 | 2;
  fgc: Color | null;
  bgc: Color;
  sourceLayerId: string | null;
  headX?: number;
};

export type Highlight =
  | { kind: "none" }
  | {
      kind: "rect";
      x: number;
      y: number;
      width: number;
      height: number;
      contents: CellGrid;
      origin: HighlightOrigin | null;
    };

export type HighlightOrigin = {
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  cells: CellGrid;
};

export type Tool = "select" | "eyedropper" | "pen" | "eraser" | "text" | "stamp";

export type ToolState = {
  activeTool: Tool;
  selectedChar: string | null;
  selectedCharWidth: 1 | 2;
  selectedFGC: Color;
  selectedBGC: Color | null;
  highlight: Highlight;
  zoom: number;
};

export type CharPalette = NormalCharPalette | HistoryPalette | KeyboardInputPalette | UnicodePalette | SimilarPalette;

export type NormalCharPalette = {
  kind: "normal";
  id: string;
  name: string;
  cells: string[];
  cellWidth: 1 | 2;
};

export type HistoryPalette = {
  kind: "history";
  history: string[];
  editableCells: string[];
};

export type KeyboardInputPalette = {
  kind: "keyboard-input";
  value: string;
};

export type UnicodePalette = {
  kind: "unicode";
  query: string;
  scrollOffset: number;
};

export type SimilarPalette = {
  kind: "similar";
  query: string;
  fontFamily: string;
  canvasSize: 16 | 32;
  threshold: number;
  widthMatch: boolean;
  maxResults: number;
  results: {
    char: string;
    codePoint: number;
    score: number;
    width: 1 | 2;
  }[];
  isSearching: boolean;
  status: string;
  checkedPageCount: number;
  totalPageCount: number;
  checkedCodePointCount: number;
};

export type Stamp = MonoStamp | ColorStamp;

export type StampCell = {
  char: string;
  width: 1 | 2;
  fgc: Color | null;
  bgc: Color | null;
};

export type MonoStamp = {
  kind: "mono";
  id: string;
  name: string;
  width: number;
  height: number;
  cells: (StampCell | null)[][];
};

export type ColorStamp = {
  kind: "color";
  id: string;
  name: string;
  width: number;
  height: number;
  cells: (StampCell | null)[][];
};

export type ColorScheme = {
  id: string;
  name: string;
  colors: Color[];
};
