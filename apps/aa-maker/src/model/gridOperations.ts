import { createEmptyCell } from "./createDocument";
import type { Cell, CharCell, Layer } from "./types";
import stringWidth from "string-width";

const MEASURE_FONT = '16px "MS Gothic"';
const measuredCharWidths = new Map<string, 1 | 2>();
let measureCanvasContext: CanvasRenderingContext2D | null | undefined;
let measuredHalfWidth: number | null = null;
let measuredFullWidth: number | null = null;

export function getCell(layer: Layer, x: number, y: number): Cell | null {
  return layer.cells[y]?.[x] ?? null;
}

export function getHeadCell(layer: Layer, x: number, y: number): CharCell | null {
  const cell = getCell(layer, x, y);

  if (!cell) {
    return null;
  }

  if (cell.kind === "char") {
    return cell;
  }

  if (cell.kind === "wide-tail") {
    const head = getCell(layer, cell.headX, y);
    return head?.kind === "char" ? head : null;
  }

  return null;
}

export function placeChar(
  layer: Layer,
  x: number,
  y: number,
  char: string,
  fgc: string,
  bgc: string | null,
  width = getCharWidth(char),
): boolean {
  if (!layer.cells[y] || x < 0 || x + width > layer.cells[y].length) {
    return false;
  }

  if (isSamePlacedChar(layer, x, y, char)) {
    return true;
  }

  if (width === 2 && isSamePlacedChar(layer, x + 1, y, char)) {
    return true;
  }

  eraseCell(layer, x, y);

  if (width === 2) {
    eraseCell(layer, x + 1, y);
  }

  layer.cells[y][x] = {
    kind: "char",
    char,
    width,
    fgc,
    bgc,
  };

  if (width === 2) {
    layer.cells[y][x + 1] = {
      kind: "wide-tail",
      headX: x,
    };
  }

  return true;
}

function isSamePlacedChar(layer: Layer, x: number, y: number, char: string): boolean {
  const cell = getCell(layer, x, y);

  if (!cell || cell.kind === "empty") {
    return false;
  }

  if (cell.kind === "char") {
    return cell.char === char;
  }

  const head = getCell(layer, cell.headX, y);
  return head?.kind === "char" && head.char === char;
}

export function eraseCell(layer: Layer, x: number, y: number): boolean {
  const cell = getCell(layer, x, y);

  if (!cell || cell.kind === "empty") {
    return false;
  }

  if (cell.kind === "wide-tail") {
    const head = getCell(layer, cell.headX, y);
    layer.cells[y][x] = createEmptyCell();

    if (head?.kind === "char") {
      layer.cells[y][cell.headX] = createEmptyCell();
    }

    return true;
  }

  layer.cells[y][x] = createEmptyCell();

  if (cell.width === 2 && x + 1 < layer.cells[y].length) {
    layer.cells[y][x + 1] = createEmptyCell();
  }

  return true;
}

export function getCharWidth(char: string): 1 | 2 {
  const measuredWidth = getMeasuredCharWidth(char);
  return measuredWidth ?? (stringWidth(char, { ambiguousIsNarrow: true }) > 1 ? 2 : 1);
}

export function getFirstGrapheme(value: string): string {
  const segmenter = new Intl.Segmenter();
  const iterator = segmenter.segment(value)[Symbol.iterator]();
  return iterator.next().value?.segment ?? "";
}

function getMeasuredCharWidth(char: string): 1 | 2 | null {
  if (char === "") {
    return 1;
  }

  const cachedWidth = measuredCharWidths.get(char);

  if (cachedWidth) {
    return cachedWidth;
  }

  const context = getMeasureCanvasContext();

  if (!context) {
    return null;
  }

  context.font = MEASURE_FONT;
  const halfWidth = getMeasuredHalfWidth(context);
  const fullWidth = getMeasuredFullWidth(context);
  const charWidth = context.measureText(char).width;
  const width = Math.abs(charWidth - fullWidth) < Math.abs(charWidth - halfWidth) ? 2 : 1;
  measuredCharWidths.set(char, width);
  return width;
}

function getMeasureCanvasContext() {
  if (measureCanvasContext !== undefined) {
    return measureCanvasContext;
  }

  if (typeof document === "undefined") {
    measureCanvasContext = null;
    return measureCanvasContext;
  }

  const canvas = document.createElement("canvas");
  measureCanvasContext = canvas.getContext("2d");
  return measureCanvasContext;
}

function getMeasuredHalfWidth(context: CanvasRenderingContext2D) {
  if (measuredHalfWidth === null) {
    measuredHalfWidth = context.measureText("A").width;
  }

  return measuredHalfWidth;
}

function getMeasuredFullWidth(context: CanvasRenderingContext2D) {
  if (measuredFullWidth === null) {
    measuredFullWidth = context.measureText("あ").width;
  }

  return measuredFullWidth;
}
