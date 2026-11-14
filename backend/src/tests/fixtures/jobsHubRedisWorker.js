const { fixture, load } = require('./jobsHubRedisFixture');
let cleanup;
let governance;
(async () => {
  const setup = await fixture({
    after: (callback) => {
      cleanup = callback;
    },
    diagnostic: () => {}
  });
  const worker = await setup.worker();
  governance = load('../services/jobGovernanceService.js', { './redisCacheService': worker.cache });
  process.send({ ready: true });
  process.once('message', async () => {
    try {
      const result = await governance.withLease('cross-process', 5, async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { upstreamCalls: 1 };
      });
      process.send({ result });
      // Parent owns shared-namespace cleanup after both child workers exit.
      await worker.client.quit();
      process.disconnect();
    } catch {
      process.send({ failed: true });
      await worker.client.quit();
      process.exitCode = 1;
      process.disconnect();
    }
  });
})().catch(async () => {
  process.send?.({ failed: true });
  if (cleanup) await cleanup().catch(() => {});
  process.exitCode = 1;
  process.disconnect?.();
});
