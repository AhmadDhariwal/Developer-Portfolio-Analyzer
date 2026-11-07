'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { optimize } = require('../services/imageOptimizationService');

test('image processing caps dimensions, preserves aspect ratio and strips metadata', async () => {
  const source = await sharp({
    create: { width: 2400, height: 1600, channels: 3, background: '#336699' }
  })
    .png()
    .toBuffer();
  const result = await optimize(source, 'avatars');
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.mimeType, 'image/webp');
  assert.equal(result.width, 512);
  assert.equal(result.height, 341);
  assert.equal(result.size, result.buffer.length);
  assert.equal(metadata.exif, undefined);
  assert.ok(result.size < source.length);
  require('node:fs').writeFileSync(
    require('node:path').resolve(
      __dirname,
      '../../verification/profile/ui-media/media-comparison.json'
    ),
    JSON.stringify(
      {
        source: { format: 'png', bytes: source.length, width: 2400, height: 1600 },
        processed: {
          format: 'webp',
          bytes: result.size,
          width: result.width,
          height: result.height
        }
      },
      null,
      2
    )
  );
});
test('EXIF orientation is applied and small images are not enlarged', async () => {
  const source = await sharp({
    create: { width: 200, height: 100, channels: 3, background: '#997733' }
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await optimize(source, 'avatars');
  assert.equal(result.width, 100);
  assert.equal(result.height, 200);
  assert.equal((await sharp(result.buffer).metadata()).orientation, undefined);
});
test('malformed and oversized compressed inputs are rejected before storage', async () => {
  await assert.rejects(optimize(Buffer.from('%PDF-1.4'), 'avatars'), { status: 400 });
  await assert.rejects(optimize(Buffer.alloc(2097153), 'avatars'), { status: 413 });
  await assert.rejects(optimize(Buffer.from('89504e470d0a1a0a', 'hex'), 'avatars'), {
    status: 400
  });
});
test('decoded pixel limit prevents a small compressed decompression bomb', async () => {
  const source = await sharp({
    create: { width: 5000, height: 4000, channels: 3, background: '#123456' }
  })
    .png()
    .toBuffer();
  assert.ok(source.length < 2097152);
  await assert.rejects(optimize(source, 'avatars'), { status: 400 });
});
test('processing saturation has no unbounded work queue and recovers', async () => {
  const source = await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: '#123456' }
  })
    .png()
    .toBuffer();
  const first = optimize(source, 'avatars');
  const second = optimize(source, 'avatars');
  await assert.rejects(optimize(source, 'avatars'), { status: 503 });
  await Promise.all([first, second]);
  assert.ok((await optimize(source, 'avatars')).size > 0);
});
