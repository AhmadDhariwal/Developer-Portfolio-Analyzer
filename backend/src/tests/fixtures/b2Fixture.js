const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const env = {
  STORAGE_DRIVER: 'b2',
  B2_IMAGES_REGION: 'us-west-004',
  B2_IMAGES_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  B2_IMAGES_BUCKET: 'fixture-images',
  B2_IMAGES_KEY_ID: 'fixture-image-key-id',
  B2_IMAGES_APPLICATION_KEY: 'fixture-image-secret',
  B2_RESUMES_REGION: 'us-west-004',
  B2_RESUMES_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
  B2_RESUMES_BUCKET: 'fixture-resumes',
  B2_RESUMES_KEY_ID: 'fixture-resume-key-id',
  B2_RESUMES_APPLICATION_KEY: 'fixture-resume-secret'
};
function fixture() {
  const objects = new Map();
  const calls = [];
  const configs = [];
  let failure = '';
  let corrupt = false;
  const clientFactory = (options, alias) => {
    configs.push({ options, alias });
    return {
      send: async (command) => {
        const op = command.constructor.name;
        const p = command.input;
        calls.push({ op, ...p, Body: undefined });
        if (failure === op)
          throw Error('provider secret and private endpoint must never escape');
        const identity = p.Bucket + '/' + p.Key;
        if (op === 'PutObjectCommand') {
          const VersionId = crypto.randomUUID();
          const versions = objects.get(identity) || [];
          versions.push({ VersionId, body: Buffer.from(p.Body) });
          objects.set(identity, versions);
          return { VersionId };
        }
        if (op === 'GetObjectCommand') {
          const version = (objects.get(identity) || []).find(
            (item) => item.VersionId === p.VersionId
          );
          if (!version) throw Error('NoSuchKey');
          return {
            ContentLength: version.body.length,
            Body: Readable.from([corrupt ? Buffer.alloc(version.body.length) : version.body])
          };
        }
        if (op === 'ListObjectVersionsCommand') {
          const Versions = [];
          for (const [name, versions] of objects)
            if (name.startsWith(p.Bucket + '/' + p.Prefix))
              for (const v of versions)
                Versions.push({ Key: name.slice(p.Bucket.length + 1), VersionId: v.VersionId });
          return { Versions, IsTruncated: false };
        }
        if (op === 'DeleteObjectCommand') {
          objects.set(
            identity,
            (objects.get(identity) || []).filter((v) => v.VersionId !== p.VersionId)
          );
          return {};
        }
        throw Error('Unexpected fixture operation');
      }
    };
  };
  return {
    objects,
    calls,
    configs,
    clientFactory,
    fail: (value) => {
      failure = value;
    },
    corrupt: (value) => {
      corrupt = value;
    }
  };
}
module.exports = { env, fixture };

const textPDF = (text) => {
  const newline = String.fromCharCode(10);
  const stream = 'BT /F1 12 Tf 50 760 Td (' + text + ') Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' +
      Buffer.byteLength(stream) +
      ' >>' +
      newline +
      'stream' +
      newline +
      stream +
      newline +
      'endstream'
  ];
  let document = '%PDF-1.4' + newline;
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document));
    document += index + 1 + ' 0 obj' + newline + object + newline + 'endobj' + newline;
  });
  const xref = Buffer.byteLength(document);
  document += 'xref' + newline + '0 6' + newline + '0000000000 65535 f ' + newline;
  offsets.slice(1).forEach((offset) => {
    document += String(offset).padStart(10, '0') + ' 00000 n ' + newline;
  });
  document +=
    'trailer' +
    newline +
    '<< /Size 6 /Root 1 0 R >>' +
    newline +
    'startxref' +
    newline +
    xref +
    newline +
    '%%EOF';
  return Buffer.from(document);
};

module.exports.textPDF = textPDF;
