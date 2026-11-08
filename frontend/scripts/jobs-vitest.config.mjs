// Limit worker contention without changing test assertions or timeouts.
export default { test: { maxWorkers: 1, fileParallelism: false } };
