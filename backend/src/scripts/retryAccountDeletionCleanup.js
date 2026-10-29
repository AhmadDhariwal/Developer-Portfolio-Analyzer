// Both operational entry points use the same bounded, durable cleanup batch.
require('../services/storageCleanupWorkerService')
  .runCli()
  .catch(() => {
    console.error('Storage cleanup incomplete; durable receipts retained.');
    process.exitCode = 1;
  });
