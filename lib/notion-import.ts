import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

export type NotionImportRow = Record<string, string>;

function readUInt16(buffer: Buffer, offset: number) { return buffer.readUInt16LE(offset); }
function readUInt32(buffer: Buffer, offset: number) { return buffer.readUInt32LE(offset); }

/** Small, dependency-free ZIP reader for the CSV/Markdown exports produced by Notion. */
export function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocdSignature = 0x06054b50;
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("The uploaded file is not a valid ZIP export.");
  const entries = readUInt16(buffer, eocd + 10);
  const directorySize = readUInt32(buffer, eocd + 12);
  const directoryOffset = readUInt32(buffer, eocd + 16);
  if (entries > 10000 || directorySize > buffer.length) throw new Error("The ZIP export is too large or malformed.");

  const result = new Map<string, Buffer>();
  let cursor = directoryOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entries; index += 1) {
    if (readUInt32(buffer, cursor) !== 0x02014b50) throw new Error("The ZIP export has an invalid directory.");
    const method = readUInt16(buffer, cursor + 10);
    const compressedSize = readUInt32(buffer, cursor + 20);
    const uncompressedSize = readUInt32(buffer, cursor + 24);
    const nameLength = readUInt16(buffer, cursor + 28);
    const extraLength = readUInt16(buffer, cursor + 30);
    const commentLength = readUInt16(buffer, cursor + 32);
    const localOffset = readUInt32(buffer, cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    if (!name || name.endsWith("/")) continue;
    if (uncompressedSize > 25_000_000 || (totalUncompressed += uncompressedSize) > 100_000_000) {
      throw new Error("The ZIP export exceeds the safe import size limit.");
    }
    if (readUInt32(buffer, localOffset) !== 0x04034b50) throw new Error("The ZIP export has an invalid file entry.");
    const localNameLength = readUInt16(buffer, localOffset + 26);
    const localExtraLength = readUInt16(buffer, localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
    if (!content) throw new Error(`Unsupported ZIP compression for ${name}.`);
    result.set(name, content);
  }
  return result;
}

export function parseCsv(input: string): NotionImportRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim().replace(/^\uFEFF/, ""));
  return rows.slice(1).filter((values) => values.some((value) => value.trim() !== "")).map((values) => Object.fromEntries(headers.map((header, i) => [header, (values[i] ?? "").trim()])));
}

export function displayRelation(value: string | undefined): string {
  if (!value) return "";
  return value.replace(/\s*\([^)]*\/([^/]+)\)\s*$/, "").trim();
}

export function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const long = new Date(text);
  return Number.isNaN(long.getTime()) ? null : long.toISOString().slice(0, 10);
}

export function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  if (!text || text === "-") return null;
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const numeric = Number(text.replace(/[(),$£€\s]/g, "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(numeric)) return null;
  return Math.round((negative ? -numeric : numeric) * 100);
}

export function stableId(prefix: string, ...parts: string[]) {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 24);
  return `${prefix}-${digest}`;
}

export type NotionExport = {
  accounts: NotionImportRow[];
  categories: NotionImportRow[];
  transactions: NotionImportRow[];
  income: NotionImportRow[];
  allocations: NotionImportRow[];
  obligations: NotionImportRow[];
};

function canonicalCsv(entries: Map<string, Buffer>, predicate: (name: string) => boolean) {
  const entry = [...entries.entries()].find(([name]) => name.toLowerCase().endsWith("_all.csv") && predicate(name));
  if (!entry) return [];
  return parseCsv(entry[1].toString("utf8"));
}

export function readNotionExport(buffer: Buffer): NotionExport {
  const entries = readZipEntries(buffer);
  return {
    accounts: canonicalCsv(entries, (name) => name.includes("Credit Cards & Accounts")),
    categories: canonicalCsv(entries, (name) => name.includes("Categories")),
    transactions: canonicalCsv(entries, (name) => name.includes("Transactions")),
    income: canonicalCsv(entries, (name) => name.includes("Income")),
    allocations: canonicalCsv(entries, (name) => name.includes("Budget Allocations") && !name.includes("Upcoming Payments")),
    obligations: canonicalCsv(entries, (name) => name.includes("Upcoming Payments")),
  };
}
