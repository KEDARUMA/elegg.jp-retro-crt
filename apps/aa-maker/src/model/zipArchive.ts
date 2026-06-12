type ZipEntrySource = {
  path: string;
  content: string;
};

type ZipEntryRecord = {
  path: string;
  data: Uint8Array;
  crc: number;
  localHeaderOffset: number;
};

const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_STORE_METHOD = 0;
const ZIP_DEFLATE_METHOD = 8;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
let crc32Table: Uint32Array | null = null;

export function createZipBlob(entries: ZipEntrySource[]) {
  const chunks: Uint8Array[] = [];
  const records: ZipEntryRecord[] = [];
  let offset = 0;
  const { time, date } = createDosDateTime(new Date());

  for (const entry of entries) {
    const pathBytes = textEncoder.encode(entry.path);
    const data = textEncoder.encode(entry.content);
    const crc = calculateCrc32(data);
    const localHeader = createLocalFileHeader(pathBytes, data.length, crc, time, date);

    records.push({
      path: entry.path,
      data,
      crc,
      localHeaderOffset: offset,
    });
    chunks.push(localHeader, pathBytes, data);
    offset += localHeader.length + pathBytes.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectoryChunks: Uint8Array[] = [];

  for (const record of records) {
    const pathBytes = textEncoder.encode(record.path);
    const centralDirectoryHeader = createCentralDirectoryHeader(pathBytes, record.data.length, record.crc, record.localHeaderOffset, time, date);

    centralDirectoryChunks.push(centralDirectoryHeader, pathBytes);
    offset += centralDirectoryHeader.length + pathBytes.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endOfCentralDirectory = createEndOfCentralDirectory(records.length, centralDirectorySize, centralDirectoryOffset);

  return new Blob([...chunks, ...centralDirectoryChunks, endOfCentralDirectory], { type: "application/zip" });
}

export async function readZipTextEntries(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = await readZipEntries(data);
  const textEntries = new Map<string, string>();

  for (const [path, entryData] of entries) {
    textEntries.set(path, textDecoder.decode(entryData));
  }

  return textEntries;
}

function createLocalFileHeader(pathBytes: Uint8Array, size: number, crc: number, time: number, date: number) {
  const header = new Uint8Array(30);
  const view = new DataView(header.buffer);

  view.setUint32(0, ZIP_LOCAL_FILE_HEADER_SIGNATURE, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, ZIP_UTF8_FLAG, true);
  view.setUint16(8, ZIP_STORE_METHOD, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, pathBytes.length, true);
  view.setUint16(28, 0, true);

  return header;
}

function createCentralDirectoryHeader(pathBytes: Uint8Array, size: number, crc: number, localHeaderOffset: number, time: number, date: number) {
  const header = new Uint8Array(46);
  const view = new DataView(header.buffer);

  view.setUint32(0, ZIP_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, ZIP_UTF8_FLAG, true);
  view.setUint16(10, ZIP_STORE_METHOD, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, pathBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);

  return header;
}

function createEndOfCentralDirectory(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  const header = new Uint8Array(22);
  const view = new DataView(header.buffer);

  view.setUint32(0, ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);

  return header;
}

async function readZipEntries(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(endOfCentralDirectoryOffset + 10, true);
  const centralDirectoryOffset = view.getUint32(endOfCentralDirectoryOffset + 16, true);
  const entries = new Map<string, Uint8Array>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP central directory.");
    }

    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraFieldLength = view.getUint16(cursor + 30, true);
    const fileCommentLength = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const path = textDecoder.decode(data.slice(cursor + 46, cursor + 46 + fileNameLength));

    if (!path.endsWith("/")) {
      entries.set(path, await readZipEntryData(data, view, localHeaderOffset, compressedSize, compressionMethod));
    }

    cursor += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

async function readZipEntryData(data: Uint8Array, view: DataView, localHeaderOffset: number, compressedSize: number, compressionMethod: number) {
  if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error("Invalid ZIP local file header.");
  }

  const fileNameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraFieldLength = view.getUint16(localHeaderOffset + 28, true);
  const dataOffset = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
  const compressedData = data.slice(dataOffset, dataOffset + compressedSize);

  if (compressionMethod === ZIP_STORE_METHOD) {
    return compressedData;
  }

  if (compressionMethod === ZIP_DEFLATE_METHOD) {
    return inflateRaw(compressedData);
  }

  throw new Error(`Unsupported ZIP compression method: ${compressionMethod}`);
}

async function inflateRaw(data: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("ZIP deflate is not supported in this browser.");
  }

  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function findEndOfCentralDirectory(view: DataView) {
  const minimumOffset = Math.max(0, view.byteLength - 65557);

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      return offset;
    }
  }

  throw new Error("Invalid ZIP file.");
}

function createDosDateTime(dateValue: Date) {
  const year = Math.max(1980, dateValue.getFullYear());

  return {
    time: (dateValue.getHours() << 11) | (dateValue.getMinutes() << 5) | Math.floor(dateValue.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((dateValue.getMonth() + 1) << 5) | dateValue.getDate(),
  };
}

function calculateCrc32(data: Uint8Array) {
  const table = getCrc32Table();
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function getCrc32Table() {
  if (crc32Table) {
    return crc32Table;
  }

  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  crc32Table = table;
  return table;
}
