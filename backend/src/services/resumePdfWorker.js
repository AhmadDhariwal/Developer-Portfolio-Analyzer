const pdfParse = require('pdf-parse');

const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.once('end', async () => {
  try {
    const result = await pdfParse(Buffer.concat(chunks), { max: 0 });
    process.stdout.write(JSON.stringify({ text: String(result?.text || '') }));
  } catch (_) {
    process.exitCode = 1;
  }
});