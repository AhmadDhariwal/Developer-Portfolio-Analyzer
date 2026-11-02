'use strict';
// Local synthetic PDF resource characterization. Never accepts production resume paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pdf = require('../src/services/resumePdfExtraction');
async function run() {
  const root = path.resolve(__dirname, '../src/tests/fixtures/resume');
  const observations = [];
  for (const fixture of ['standard', 'columns', 'standard', 'columns']) {
    const started = performance.now();
    const result = await pdf.extract(fs.readFileSync(path.join(root, fixture + '.pdf')));
    observations.push({
      fixture,
      milliseconds: Math.round(performance.now() - started),
      characters: result.text.length,
      pages: result.pages
    });
  }
  const bytes = fs.readFileSync(path.join(root, 'standard.pdf'));
  const running = [pdf.extract(bytes), pdf.extract(bytes)];
  await assert.rejects(pdf.extract(bytes), { status: 429, code: 'RESUME_PDF_BUSY' });
  await Promise.all(running);
  let peakRssKiB = null;
  try {
    peakRssKiB = process.resourceUsage().maxRSS;
  } catch {
    /* Not supported by every host. */
  }
  const evidence = {
    limits: pdf.LIMITS,
    observations,
    concurrentExtractions: 2,
    thirdConcurrentStatus: 429,
    processPeakRssKiB: peakRssKiB,
    postRunRssBytes: process.memoryUsage().rss,
    note: 'Small synthetic local sample, including two concurrent workers. Peak RSS covers this dedicated Node process and its workers; it is not a production capacity or hard RSS limit.'
  };
  fs.writeFileSync(
    path.resolve(__dirname, '../verification/resume/resource-observations.json'),
    JSON.stringify(evidence, null, 2)
  );
  console.log(JSON.stringify(evidence));
}
run().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
