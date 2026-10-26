import { ConnectorError } from '@openflix/connector-core';
/** Accept only bounded JPEG derivatives; never serve active SVG/HTML from upstream. */
export function validateArtwork(data: unknown, contentType: unknown): Buffer {
  if (
    !Buffer.isBuffer(data) ||
    data.length < 4 ||
    data.length > 2 * 1024 * 1024 ||
    contentType !== 'image/jpeg' ||
    data.readUInt16BE(0) !== 0xffd8
  )
    throw new ConnectorError('invalid_response');
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset++] !== 0xff) break;
    while (data[offset] === 0xff) offset++;
    const marker = data[offset++];
    if (marker === undefined || marker === 0xda || marker === 0xd9 || offset + 2 > data.length)
      break;
    const length = data.readUInt16BE(offset);
    if (length < 2 || offset + length > data.length) break;
    if (marker === 0xc0 || marker === 0xc2) {
      if (length < 8) break;
      const height = data.readUInt16BE(offset + 3),
        width = data.readUInt16BE(offset + 5);
      if (width > 0 && height > 0 && width <= 1920 && height <= 1920) return data;
      break;
    }
    offset += length;
  }
  throw new ConnectorError('invalid_response');
}
