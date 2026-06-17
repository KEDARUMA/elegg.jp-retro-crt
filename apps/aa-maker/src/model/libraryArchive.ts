import { parseStampMdsSources } from "./parseStampMds";
import type { Stamp, StampCell } from "./types";
import { createZipBlob, readZipTextEntries } from "./zipArchive";

export const LIBRARY_ARCHIVE_FILENAME = "aa-maker-library.zip";
export const LIBRARY_CHAR_PALETTES_PATH = "library/char-palettes.json";
export const LIBRARY_STAMP_INDEX_PATH = "library/stamps/index.json";

export type LibraryCharPalette = {
  id: string;
  name: string;
  columns?: number;
  startCode?: number;
  chars: (string | null)[];
};

export type LibraryStampIndexItem = {
  id: string;
  name: string;
  file: string;
};

export type LibraryStampSet = {
  id: string;
  name: string;
  file: string;
  stamps: Stamp[];
};

export type AaMakerLibrary = {
  palettes: LibraryCharPalette[];
  stampSets: LibraryStampSet[];
};

export function createLibraryArchiveBlob(library: AaMakerLibrary) {
  const stampIndex = library.stampSets.map(({ id, name, file }) => ({
    id,
    name,
    file,
  }));
  const stampEntries = library.stampSets.map((stampSet) => ({
    path: `library/stamps/${stampSet.file}`,
    content: createStampSetMds(stampSet),
  }));

  return createZipBlob([
    {
      path: LIBRARY_CHAR_PALETTES_PATH,
      content: `${JSON.stringify(library.palettes.map(createSerializablePalette), null, 2)}\n`,
    },
    {
      path: LIBRARY_STAMP_INDEX_PATH,
      content: `${JSON.stringify(stampIndex, null, 2)}\n`,
    },
    ...stampEntries,
  ]);
}

export async function readLibraryArchiveFile(file: File): Promise<AaMakerLibrary | null> {
  const entries = await readZipTextEntries(file);
  const rawPalettes = entries.get(LIBRARY_CHAR_PALETTES_PATH);
  const rawStampIndex = entries.get(LIBRARY_STAMP_INDEX_PATH);

  if (rawPalettes === undefined || rawStampIndex === undefined) {
    return null;
  }

  const palettes = normalizeLibraryPalettes(JSON.parse(rawPalettes) as unknown);
  const stampIndex = normalizeLibraryStampIndex(JSON.parse(rawStampIndex) as unknown);

  if (!palettes || !stampIndex) {
    return null;
  }

  const stampSets: LibraryStampSet[] = [];

  for (const item of stampIndex) {
    const content = entries.get(`library/stamps/${item.file}`);

    if (content === undefined) {
      return null;
    }

    stampSets.push({
      id: item.id,
      name: item.name,
      file: item.file,
      stamps: parseStampMdsSources([{ id: item.id, name: item.name, content }]),
    });
  }

  return {
    palettes,
    stampSets,
  };
}

function createSerializablePalette(palette: LibraryCharPalette) {
  return {
    id: palette.id,
    name: palette.name,
    ...(palette.columns === undefined ? {} : { columns: palette.columns }),
    ...(palette.startCode === undefined ? {} : { startCode: palette.startCode }),
    chars: serializeLibraryPaletteRows(palette.chars),
  };
}

function createStampSetMds(stampSet: LibraryStampSet) {
  return [`<stamp-set id="${escapeAttribute(stampSet.id)}" name="${escapeAttribute(stampSet.name)}">`, stampSet.stamps.map(createStampMds).join("\n\n"), "</stamp-set>", ""].join("\n");
}

function createStampMds(stamp: Stamp) {
  return [`<stamp id="${escapeAttribute(stamp.id)}" name="${escapeAttribute(stamp.name)}">`, ...stamp.cells.map(createStampMdsRow), "</stamp>"].join("\n");
}

function createStampMdsRow(row: (StampCell | null)[]) {
  let currentFGC: string | null = null;
  let currentBGC: string | null = null;
  let line = "";

  for (let x = 0; x < row.length; x += 1) {
    const cell = row[x];

    if (cell === null) {
      line += " ";
      continue;
    }

    if (cell.fgc !== currentFGC) {
      line += currentFGC === null ? "" : "<color>";
      line += cell.fgc === null ? "" : `<color="#${cell.fgc}">`;
      currentFGC = cell.fgc;
    }

    if (cell.bgc !== currentBGC) {
      line += currentBGC === null ? "" : "<bgcolor>";
      line += cell.bgc === null ? "" : `<bgcolor="#${cell.bgc}">`;
      currentBGC = cell.bgc;
    }

    line += cell.char;

    if (cell.width === 2) {
      x += 1;
    }
  }

  if (currentBGC !== null) {
    line += "<bgcolor>";
  }

  if (currentFGC !== null) {
    line += "<color>";
  }

  return line;
}

function normalizeLibraryPalettes(value: unknown): LibraryCharPalette[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const palettes: LibraryCharPalette[] = [];
  const seenIds = new Set<string>();

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || !Array.isArray(item.chars) || item.chars.some((row) => typeof row !== "string")) {
      return null;
    }

    const id = item.id.trim();

    if (!id || seenIds.has(id)) {
      continue;
    }

    const chars = flattenLibraryPaletteRows(item.chars);

    palettes.push({
      id,
      name: item.name.trim(),
      ...(Number.isInteger(item.columns) ? { columns: item.columns as number } : {}),
      ...(Number.isInteger(item.startCode) ? { startCode: item.startCode as number } : {}),
      chars,
    });
    seenIds.add(id);
  }

  return palettes;
}

function serializeLibraryPaletteRows(chars: (string | null)[]) {
  const rows: string[] = [];

  for (let index = 0; index < chars.length; index += 16) {
    const rowChars = chars.slice(index, index + 16).map((char) => char ?? " ");

    while (rowChars.length < 16) {
      rowChars.push(" ");
    }

    rows.push(rowChars.join(""));
  }

  return rows;
}

function flattenLibraryPaletteRows(rows: string[]) {
  const chars: string[] = [];

  for (const row of rows) {
    chars.push(...Array.from(row));
  }

  return chars;
}

function normalizeLibraryStampIndex(value: unknown): LibraryStampIndexItem[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items: LibraryStampIndexItem[] = [];
  const seenIds = new Set<string>();
  const seenFiles = new Set<string>();

  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.file !== "string") {
      return null;
    }

    const id = item.id.trim();
    const file = item.file.trim();

    if (!id || !isSafeStampFilename(file) || seenIds.has(id) || seenFiles.has(file)) {
      return null;
    }

    items.push({
      id,
      name: item.name.trim(),
      file,
    });
    seenIds.add(id);
    seenFiles.add(file);
  }

  return items;
}

function isSafeStampFilename(value: string) {
  return /^[^/\\]+\.mds$/i.test(value) && !value.includes("..");
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
