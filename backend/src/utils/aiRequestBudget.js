const budgetError = (reason) => Object.assign(new Error('AI request did not complete.'), { aiReason: reason });

// Also races uncooperative operations: aborting a transport must not be the only
// mechanism protecting the caller's deadline. Never abort successful requests.
const withAiBudget = async (operation, timeoutMs, signal) => {
  const controller = new AbortController();
  const cancel = () => controller.abort(budgetError('cancelled'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(budgetError('timeout')), Math.max(1, timeoutMs));
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true })
      )
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
};
module.exports = { withAiBudget };
