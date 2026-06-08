import { createEmptyCell } from "./createDocument";
import type { Cell, CharCell, Layer } from "./types";

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

export function placeChar(layer: Layer, x: number, y: number, char: string, fgc: string, bgc: string | null): boolean {
  const width = getCharWidth(char);

  if (!layer.cells[y] || x < 0 || x + width > layer.cells[y].length) {
    return false;
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
  const codePoint = char.codePointAt(0) ?? 0;

  if (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 2;
  }

  return 1;
}
