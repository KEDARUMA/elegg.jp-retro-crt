import stringWidth from "string-width";

export type WidthMode = "web" | "terminal";

export const DEFAULT_WIDTH_MODE: WidthMode = "web";

const terminalCharWidthCache = new Map<string, 1 | 2>();

export function isWidthMode(value: unknown): value is WidthMode {
  return value === "web" || value === "terminal";
}

export function normalizeWidthMode(value: unknown, fallback: WidthMode = DEFAULT_WIDTH_MODE): WidthMode {
  return isWidthMode(value) ? value : fallback;
}

export function getTerminalCharWidth(char: string): 1 | 2 {
  const cachedWidth = terminalCharWidthCache.get(char);

  if (cachedWidth) {
    return cachedWidth;
  }

  const width = stringWidth(char, { ambiguousIsNarrow: true }) > 1 ? 2 : 1;
  terminalCharWidthCache.set(char, width);
  return width;
}
