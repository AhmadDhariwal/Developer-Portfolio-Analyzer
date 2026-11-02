// Bound verification workers on developer machines; keep product deadline assertions unchanged.
export default { test: { maxWorkers: 2, fileParallelism: false } };
