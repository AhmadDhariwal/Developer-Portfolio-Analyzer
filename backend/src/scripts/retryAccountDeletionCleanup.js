// Both operational entry points use the same bounded, durable cleanup batch.
require('../core/storage/storageCleanupWorkerService')
  .runCli()
  .catch(() => {
    console.error('Storage cleanup incomplete; durable receipts retained.');
    process.exitCode = 1;
  });
