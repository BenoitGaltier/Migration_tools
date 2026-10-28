import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
const limit = 16 * 1024 * 1024;
function invalid(message) { throw new Error(`Invalid project ZIP archive: ${message}`); }
function parse(bytes) {
  const archive = Buffer.from(bytes); let end = -1;
  if (archive.length > limit) invalid("schematic archive exceeds the inspection limit");
  for (let offset = archive.length - 22; offset >= Math.max(0, archive.length - 65557); offset--) {
    if (archive.readUInt32LE(offset) === 0x06054b50 && offset + 22 + archive.readUInt16LE(offset + 20) === archive.length) { end = offset; break; }
  }
  if (end < 0) invalid("end record missing");
  const count = archive.readUInt16LE(end + 10), directory = archive.readUInt32LE(end + 16), directorySize = archive.readUInt32LE(end + 12);
  if (archive.readUInt32LE(end + 4) || count !== archive.readUInt16LE(end + 8) || count > 1000 || directory + directorySize !== end) invalid("unsupported split/ZIP64 directory");
  const records = [], names = new Set(); let offset = directory, total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > end || archive.readUInt32LE(offset) !== 0x02014b50) invalid("central directory corrupt");
    const flags = archive.readUInt16LE(offset + 8), compression = archive.readUInt16LE(offset + 10), size = archive.readUInt32LE(offset + 24), compressedSize = archive.readUInt32LE(offset + 20);
    const nameLength = archive.readUInt16LE(offset + 28), extra = archive.readUInt16LE(offset + 30), comment = archive.readUInt16LE(offset + 32), local = archive.readUInt32LE(offset + 42);
    const next = offset + 46 + nameLength + extra + comment;
    if (next > end || flags & 1 || ![0, 8].includes(compression) || size === 0xffffffff || compressedSize === 0xffffffff || local + 30 > directory) invalid("unsupported entry");
    const nameBytes = archive.subarray(offset + 46, offset + 46 + nameLength), name = nameBytes.toString(flags & 2048 ? "utf8" : "latin1");
    if (!name || /[\0\r\n]/.test(name) || name.replaceAll("\\", "/").split("/").includes("..") || name.startsWith("/") || names.has(name.toLowerCase())) invalid("duplicate or unsafe entry name");
    names.add(name.toLowerCase()); total += size; if (total > limit) invalid("expanded archive exceeds the inspection limit");
    if (archive.readUInt32LE(local) !== 0x04034b50 || archive.readUInt16LE(local + 8) !== compression) invalid("local header corrupt");
    const localNameLength = archive.readUInt16LE(local + 26), localExtra = archive.readUInt16LE(local + 28), dataOffset = local + 30 + localNameLength + localExtra;
    if (dataOffset + compressedSize > directory || !archive.subarray(local + 30, local + 30 + localNameLength).equals(nameBytes)) invalid("local entry bounds/name mismatch");
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    let data; try { data = compression === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) }); } catch { invalid(`cannot inflate ${name}`); }
    if (data.length !== size || crc32(data) !== archive.readUInt32LE(offset + 16)) invalid(`CRC/size mismatch for ${name}`);
    records.push({ name, data, compressed, localHeader: Buffer.from(archive.subarray(local, dataOffset)), centralHeader: Buffer.from(archive.subarray(offset, next)), flags, compression });
    offset = next;
  }
  if (offset !== end) invalid("directory size mismatch");
  return { records, end: Buffer.from(archive.subarray(end)) };
}
export function readProjectArchive(bytes) { return new Map(parse(bytes).records.map((record) => [record.name, record.data])); }
function assemble(records, end, replacements) {
  const locals = [], centrals = []; let offset = 0;
  for (const record of records) {
    const data = replacements.get(record.name), changed = data !== undefined;
    const payload = changed ? (record.compression === 8 ? deflateRawSync(data) : Buffer.from(data)) : record.compressed;
    const crc = changed ? crc32(data) : crc32(record.data), size = changed ? data.length : record.data.length;
    const local = Buffer.from(record.localHeader), central = Buffer.from(record.centralHeader), flags = record.flags & ~8;
    local.writeUInt16LE(flags, 6); local.writeUInt32LE(crc, 14); local.writeUInt32LE(payload.length, 18); local.writeUInt32LE(size, 22);
    central.writeUInt16LE(flags, 8); central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(size, 24); central.writeUInt32LE(offset, 42);
    locals.push(local, payload); centrals.push(central); offset += local.length + payload.length;
  }
  const directory = Buffer.concat(centrals), trailer = Buffer.from(end); trailer.writeUInt32LE(directory.length, 12); trailer.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, trailer]);
}
export function rewriteProjectArchive(bytes, replacements) {
  const parsed = parse(bytes), names = new Set(parsed.records.map((record) => record.name));
  for (const name of replacements.keys()) if (!names.has(name)) throw new Error(`Unknown archive entry: ${name}`);
  return assemble(parsed.records, parsed.end, replacements);
}
// Also used for small synthetic test projects; production rewrites preserve
// original compressed payloads for every stream that was not explicitly edited.
export function createProjectArchive(entries) {
  const records = [...entries].map(([name, value]) => {
    const data = Buffer.from(value), encoded = Buffer.from(name), localHeader = Buffer.alloc(30 + encoded.length), centralHeader = Buffer.alloc(46 + encoded.length);
    localHeader.writeUInt32LE(0x04034b50); localHeader.writeUInt16LE(20, 4); localHeader.writeUInt16LE(2048, 6); localHeader.writeUInt16LE(8, 8); localHeader.writeUInt16LE(33, 12); localHeader.writeUInt16LE(encoded.length, 26); encoded.copy(localHeader, 30);
    centralHeader.writeUInt32LE(0x02014b50); centralHeader.writeUInt16LE(20, 4); centralHeader.writeUInt16LE(20, 6); centralHeader.writeUInt16LE(2048, 8); centralHeader.writeUInt16LE(8, 10); centralHeader.writeUInt16LE(33, 14); centralHeader.writeUInt16LE(encoded.length, 28); encoded.copy(centralHeader, 46);
    return { name, data, flags: 2048, compression: 8, localHeader, centralHeader, compressed: deflateRawSync(data) };
  });
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(records.length, 8); end.writeUInt16LE(records.length, 10);
  return assemble(records, end, new Map(entries));
}
