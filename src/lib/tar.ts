import { gunzipSync } from "node:zlib";

export type TarFile = { path: string; content: Buffer; executable: boolean };

function readString(block: Buffer, start: number, length: number) {
  const slice = block.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString("utf8");
}

function readOctal(block: Buffer, start: number, length: number) {
  const text = readString(block, start, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/** Reads the `path` key from a PAX extended header body. */
function paxPath(body: Buffer) {
  let offset = 0;
  while (offset < body.length) {
    const space = body.indexOf(32, offset);
    if (space === -1) break;
    const length = parseInt(body.subarray(offset, space).toString("utf8"), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = body.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (record.slice(0, equals) === "path") return record.slice(equals + 1);
    offset += length;
  }
  return null;
}

/**
 * Extracts regular files from a gzipped tar archive (ustar, GNU long names, and PAX paths).
 * Paths are normalized to project-relative form; anything that escapes the root is rejected.
 */
export function extractTarGz(archive: Buffer, limits: { maxFileBytes: number; maxTotalBytes: number }) {
  const data = gunzipSync(archive, { maxOutputLength: limits.maxTotalBytes + 64 * 1024 * 1024 });
  const files: TarFile[] = [];
  const skipped: string[] = [];
  let offset = 0;
  let total = 0;
  let pendingName: string | null = null;

  while (offset + 512 <= data.length) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const mode = readOctal(header, 100, 8);
    const prefix = readString(header, 345, 155);
    const name = readString(header, 0, 100);
    const bodyStart = offset + 512;
    const body = data.subarray(bodyStart, bodyStart + size);
    offset = bodyStart + Math.ceil(size / 512) * 512;

    if (type === "L") {
      pendingName = body.toString("utf8").replace(/\0+$/, "");
      continue;
    }
    if (type === "x") {
      pendingName = paxPath(body) ?? pendingName;
      continue;
    }
    if (type === "g") continue;

    const rawPath = pendingName ?? (prefix ? `${prefix}/${name}` : name);
    pendingName = null;
    if (type !== "0" && type !== "\0" && type !== "7") continue;

    const path = rawPath.replace(/^\.\//, "").replace(/^\/+/, "");
    const segments = path.split("/");
    if (!path || segments.some((segment) => segment === ".." || segment === "")) continue;
    if (size > limits.maxFileBytes) {
      skipped.push(path);
      continue;
    }
    total += size;
    if (total > limits.maxTotalBytes) {
      throw new Error(`The project is larger than ${Math.round(limits.maxTotalBytes / 1024 / 1024)} MB without dependencies.`);
    }
    files.push({ path, content: Buffer.from(body), executable: (mode & 0o111) !== 0 });
  }
  return { files, skipped };
}
