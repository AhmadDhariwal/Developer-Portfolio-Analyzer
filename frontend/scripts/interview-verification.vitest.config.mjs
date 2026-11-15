// Opt-in resource bound for full-suite verification on shared developer machines.
// Angular supplies the test environment and discovery; keep default assertions/timeouts.
export default {
  test: {
    maxWorkers: 2,
  },
};
