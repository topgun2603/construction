import { inflateRawSync } from 'node:zlib';

/**
 * Reads a ZIP into a map of entry name → bytes, for asserting on exports.
 *
 * A test helper, not a general reader: it walks the central directory (whose sizes are right even
 * when an entry was streamed with a data descriptor, as archiver does), handles stored and deflated
 * entries, and does not do ZIP64 — a test export is never four gigabytes.
 */
export function readZip(zip: Buffer): Map<string, Buffer> {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip: no end of central directory');
  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  const out = new Map<string, Buffer>();
  for (let i = 0; i < entries; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad central directory');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    const localName = zip.readUInt16LE(local + 26);
    const localExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + localName + localExtra;
    const data = zip.subarray(start, start + compressed);
    out.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return out;
}
