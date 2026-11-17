import { Gunzip, gzipSync } from 'fflate';
import { MAX_WORKSPACE_BYTES } from '../../shared/validation';

export const COMPRESSED_WORKSPACE_PREFIX = 'cofounder-gzip-v1:';
// localStorage stores UTF-16. The logical workspace can be much larger than
// this record; repeated exact request contexts compress without losing data.
const MAX_STORED_CHARS = 2_000_000;
const COMPRESSION_THRESHOLD = 256_000;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function checksum(bytes: Uint8Array, crc = 0xffffffff): number {
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return crc;
}
function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(''));
}

/** Storage-only lossless encoding; JSON exports and paid request payloads stay exact. */
export function encodeStoredWorkspace(raw: string): string {
  let stored = raw;
  if (raw.length >= COMPRESSION_THRESHOLD) {
    const packed = COMPRESSED_WORKSPACE_PREFIX + toBase64(gzipSync(new TextEncoder().encode(raw), { level: 6, mtime: 0 }));
    if (packed.length < raw.length) stored = packed;
  }
  if (stored.length > MAX_STORED_CHARS) throw new Error('Хранилище браузера заполнено. Текущая работа доступна в этой сессии; скачайте резервную копию JSON.');
  return stored;
}

/** Read both existing JSON and compact records, with bounded inflation and CRC. */
export function decodeStoredWorkspace(stored: string): string {
  if (!stored.startsWith(COMPRESSED_WORKSPACE_PREFIX)) return stored;
  if (stored.length > MAX_STORED_CHARS) throw new Error('Слишком большая запись хранилища.');
  const encoded = stored.slice(COMPRESSED_WORKSPACE_PREFIX.length);
  if (encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Повреждена запись хранилища.');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (bytes.length < 18) throw new Error('Повреждена запись хранилища.');
  const footer = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 8);
  const expectedCrc = footer.getUint32(0, true), expectedLength = footer.getUint32(4, true);
  if (expectedLength > MAX_WORKSPACE_BYTES) throw new Error('Распакованная запись превышает 64 МиБ.');
  const chunks: Uint8Array[] = [];
  let size = 0, crc = 0xffffffff, finished = false;
  const stream = new Gunzip((chunk, final) => {
    size += chunk.length;
    if (size > expectedLength || size > MAX_WORKSPACE_BYTES) throw new Error('Повреждён размер записи хранилища.');
    crc = checksum(chunk, crc); chunks.push(chunk); finished = final;
  });
  // Small compressed input chunks also bound temporary inflater allocations.
  for (let offset = 0; offset < bytes.length; offset += 1024) stream.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  if (!finished || size !== expectedLength || ((crc ^ 0xffffffff) >>> 0) !== expectedCrc) throw new Error('Не совпала контрольная сумма записи хранилища.');
  const decoded = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { decoded.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
}
