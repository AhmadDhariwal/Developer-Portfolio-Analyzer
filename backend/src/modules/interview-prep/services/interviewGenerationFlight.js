// Public generation work is shared, but one disconnected caller must not cancel
// another caller. The provider is aborted only when the last caller leaves.
const flights = new Map();
const cancelled = () =>
  Object.assign(new Error('Request cancelled.'), { statusCode: 499, code: 'cancelled' });

const generationFlight = (key, operation, signal) => {
  if (signal?.aborted) return Promise.reject(cancelled());
  let entry = flights.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = { controller, callers: 0 };
    entry.promise = Promise.resolve()
      .then(() => operation(controller.signal))
      .finally(() => {
        if (flights.get(key) === entry) flights.delete(key);
      });
    flights.set(key, entry);
  }
  entry.callers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      entry.callers--;
      callback(value);
    };
    const abort = () => {
      finish(reject, cancelled());
      if (!entry.callers) {
        if (flights.get(key) === entry) flights.delete(key);
        entry.controller.abort();
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    entry.promise.then(
      (result) => finish(resolve, result),
      (error) => finish(reject, error)
    );
    if (signal?.aborted) abort();
  });
};

module.exports = { generationFlight };
