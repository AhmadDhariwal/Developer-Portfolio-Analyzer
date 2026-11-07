'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const EXTRACTION_VERSION = 'pdf-parse-1.1.1-layout-v3';
const LIMITS = Object.freeze({
  bytes: 10 * 1024 * 1024,
  pages: 50,
  characters: 200000,
  timeoutMs: 15000,
  workers: 2
});
let active = 0;
const failure = (message, code, status = 422) =>
  Object.assign(new Error(message), { code, status });
const fingerprint = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function parse(bytes, parser = require('pdf-parse')) {
  let characters = 0;
  // Detect common image-only documents without rendering or decoding image pixels.
  const hasRaster = /\/Subtype\s*\/Image\b/.test(Buffer.from(bytes).toString('latin1'));
  const result = await parser(Uint8Array.from(bytes), {
    max: LIMITS.pages + 1,
    pagerender: async (page) => {
      const content = await page.getTextContent({
        normalizeWhitespace: false,
        disableCombineTextItems: false
      });
      // Preserve content-stream column order. Arbitrary table semantics are not inferred.
      let y = null;
      let text = '';
      for (const item of content.items) {
        const nextY = item.transform?.[5];
        text += (y === null || nextY === y ? ' ' : '\n') + item.str;
        y = nextY;
        characters += item.str.length + 1;
        if (characters > LIMITS.characters)
          throw failure('PDF extracted text exceeds the supported limit.', 'RESUME_PDF_TEXT_LIMIT');
      }
      return text;
    }
  });
  if (result.numpages > LIMITS.pages)
    throw failure('PDF exceeds the 50-page limit.', 'RESUME_PDF_PAGE_LIMIT');
  if ((result.text || '').length > LIMITS.characters)
    throw failure('PDF extracted text exceeds the supported limit.', 'RESUME_PDF_TEXT_LIMIT');
  return {
    text: result.text || '',
    pages: result.numpages || 0,
    rasterOnly: hasRaster && !(result.text || '').trim()
  };
}
async function extract(bytes, { timeoutMs = LIMITS.timeoutMs } = {}) {
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString('ascii') !== '%PDF-')
    throw failure('Only valid PDF files are allowed.', 'RESUME_INVALID_PDF', 400);
  if (bytes.length > LIMITS.bytes)
    throw failure('Resume PDF must be 10 MB or smaller.', 'RESUME_PDF_SIZE_LIMIT', 413);
  if (active >= LIMITS.workers)
    throw failure('PDF processing is busy. Please retry shortly.', 'RESUME_PDF_BUSY', 429);
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(__filename, {
        workerData: bytes,
        resourceLimits: {
          maxOldGenerationSizeMb: 128,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4
        }
      });
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.terminate().finally(() => (error ? reject(error) : resolve(value)));
      };
      const timer = setTimeout(
        () => finish(failure('PDF processing exceeded the time limit.', 'RESUME_PDF_TIMEOUT')),
        timeoutMs
      );
      worker.once('message', (message) =>
        message.error
          ? finish(failure(message.error.message, message.error.code))
          : finish(null, message)
      );
      worker.once('error', () =>
        finish(
          failure(
            'PDF processing failed within the supported resource limits.',
            'RESUME_PARSER_FAILURE'
          )
        )
      );
      worker.once('exit', () => {
        if (!settled)
          finish(failure('PDF processing stopped before completion.', 'RESUME_PARSER_FAILURE'));
      });
    });
  } finally {
    active--;
  }
}
if (!isMainThread) {
  parse(workerData)
    .then((value) => parentPort.postMessage(value))
    .catch((error) =>
      parentPort.postMessage({
        error: {
          code: error.code || 'RESUME_PARSER_FAILURE',
          message: error.code?.startsWith('RESUME_')
            ? error.message
            : 'The PDF could not be parsed. Upload an uncorrupted, unencrypted text-based PDF.'
        }
      })
    );
}
module.exports = { extract, fingerprint, EXTRACTION_VERSION, LIMITS, __test: { parse } };
