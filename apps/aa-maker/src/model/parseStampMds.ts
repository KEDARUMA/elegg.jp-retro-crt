import { getCharWidth } from "./gridOperations";
import type { Color, Stamp, StampCell } from "./types";

type StampMdsSource = {
  id: string;
  name: string;
  content: string;
};

type StampStyleState = {
  fgc: Color | null;
  bgc: Color | null;
  fgcStack: (Color | null)[];
  bgcStack: (Color | null)[];
};

const COLOR_NAMES: Record<string, Color> = {
  black: "000000",
  blue: "0000ff",
  cyan: "00ffff",
  gray: "808080",
  green: "008000",
  grey: "808080",
  magenta: "ff00ff",
  red: "ff0000",
  white: "ffffff",
  yellow: "ffff00",
};

export function parseStampMdsSources(sources: StampMdsSource[]): Stamp[] {
  return sources.flatMap(parseStampMdsSource);
}

function parseStampMdsSource(source: StampMdsSource): Stamp[] {
  const normalized = source.content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const setAttributes = parseAttributes(normalized.match(/<stamp-set(?=\s|>)([^>]*)>/i)?.[1] ?? "");
  const setId = setAttributes.id ?? source.id;
  const setName = setAttributes.name ?? source.name;
  const stamps: Stamp[] = [];

  for (const match of normalized.matchAll(/<stamp(?=\s|>)([^>]*)>([\s\S]*?)<\/stamp>/gi)) {
    const attributes = parseAttributes(match[1]);
    const id = attributes.id ?? `${setId}-${String(stamps.length + 1).padStart(3, "0")}`;
    const name = attributes.name ?? `${setName} ${String(stamps.length + 1).padStart(3, "0")}`;
    stamps.push(createStampFromMdsBlock(id, name, match[2]));
  }

  return stamps;
}

function createStampFromMdsBlock(id: string, name: string, block: string): Stamp {
  const body = block.replace(/^\n/, "").replace(/\n$/, "");
  const state: StampStyleState = {
    fgc: null,
    bgc: null,
    fgcStack: [],
    bgcStack: [],
  };
  const rows = body.split("\n").map((line) => parseStampLine(line.trimEnd(), state));
  const width = Math.max(1, ...rows.map((row) => row.length));
  const height = Math.max(1, rows.length);
  const cells = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => null)]);

  return {
    kind: "mono",
    id,
    name,
    width,
    height,
    cells,
  };
}

function parseStampLine(line: string, state: StampStyleState) {
  const cells: (StampCell | null)[] = [];
  let cursor = 0;

  while (cursor < line.length) {
    const tag = readStyleTag(line, cursor);

    if (tag) {
      applyStyleTag(tag, state);
      cursor = tag.end;
      continue;
    }

    const segment = getFirstSegment(line.slice(cursor));
    const width = getCharWidth(segment);

    if (isTransparentSpace(segment)) {
      appendTransparentCells(cells, width);
    } else {
      cells.push({
        char: segment,
        width,
        fgc: state.fgc,
        bgc: state.bgc,
      });

      if (width === 2) {
        cells.push(null);
      }
    }

    cursor += segment.length;
  }

  return cells;
}

function parseAttributes(value: string) {
  const attributes: Record<string, string> = {};

  for (const match of value.matchAll(/([a-zA-Z][\w-]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = decodeAttributeValue(match[2]);
  }

  return attributes;
}

function readStyleTag(line: string, cursor: number) {
  const rest = line.slice(cursor);
  const match = rest.match(/^<(color|bgcolor)(?:="([^"]*)")?>/);

  if (!match) {
    return null;
  }

  return {
    name: match[1],
    value: match[2] ?? null,
    end: cursor + match[0].length,
  };
}

function applyStyleTag(tag: { name: string; value: string | null }, state: StampStyleState) {
  if (tag.name === "color") {
    if (tag.value === null) {
      state.fgc = state.fgcStack.pop() ?? null;
      return;
    }

    state.fgcStack.push(state.fgc);
    state.fgc = normalizeColorValue(tag.value);
    return;
  }

  if (tag.value === null) {
    state.bgc = state.bgcStack.pop() ?? null;
    return;
  }

  state.bgcStack.push(state.bgc);
  state.bgc = normalizeColorValue(tag.value);
}

function normalizeColorValue(value: string): Color | null {
  const normalized = value.trim().toLowerCase().replace(/^#/, "");

  if (/^[0-9a-f]{6}$/.test(normalized)) {
    return normalized;
  }

  return COLOR_NAMES[normalized] ?? null;
}

function getFirstSegment(value: string) {
  return Array.from(value)[0] ?? "";
}

function isTransparentSpace(value: string) {
  return value === " " || value === "　" || value === "\t";
}

function appendTransparentCells(cells: (StampCell | null)[], width: 1 | 2) {
  cells.push(null);

  if (width === 2) {
    cells.push(null);
  }
}

function decodeAttributeValue(value: string) {
  return value.replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}
