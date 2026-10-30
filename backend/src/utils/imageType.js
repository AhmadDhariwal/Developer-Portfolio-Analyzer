function imageType(buffer) {
  const dimensions = (width, height) =>
    width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16777216;
  if (
    buffer.length >= 45 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.toString('ascii', 12, 16) === 'IHDR' &&
    buffer.readUInt32BE(8) === 13 &&
    dimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20))
  ) {
    let data = false;
    for (let offset = 8; offset + 12 <= buffer.length; ) {
      const length = buffer.readUInt32BE(offset);
      const name = buffer.toString('ascii', offset + 4, offset + 8);
      const end = offset + 12 + length;
      if (end > buffer.length) return null;
      if (name === 'IDAT' && length > 0) data = true;
      if (name === 'IEND')
        return data && length === 0 && end === buffer.length ? ['png', 'image/png'] : null;
      offset = end;
    }
  }
  if (
    buffer.length > 20 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer.at(-2) === 255 &&
    buffer.at(-1) === 217
  ) {
    let sized = false;
    for (let offset = 2; offset + 4 < buffer.length; ) {
      if (buffer[offset] !== 255) return null;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > buffer.length) return null;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8)
        sized = dimensions(buffer.readUInt16BE(offset + 7), buffer.readUInt16BE(offset + 5));
      if (marker === 0xda) return sized ? ['jpg', 'image/jpeg'] : null;
      offset += 2 + length;
    }
  }
  if (
    buffer.length >= 30 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' &&
    buffer.readUInt32LE(4) === buffer.length - 8
  ) {
    const kind = buffer.toString('ascii', 12, 16);
    if (buffer.readUInt32LE(16) > buffer.length - 20) return null;
    if (
      kind === 'VP8 ' &&
      buffer[23] === 0x9d &&
      buffer[24] === 0x01 &&
      buffer[25] === 0x2a &&
      dimensions(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff)
    )
      return ['webp', 'image/webp'];
    if (kind === 'VP8L' && buffer[20] === 0x2f) {
      const bits = buffer.readUInt32LE(21);
      if (dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1))
        return ['webp', 'image/webp'];
    }
    if (
      kind === 'VP8X' &&
      dimensions(buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1) &&
      (buffer.includes(Buffer.from('VP8 '), 30) || buffer.includes(Buffer.from('VP8L'), 30))
    )
      return ['webp', 'image/webp'];
  }
  return null;
}
module.exports = { imageType };
