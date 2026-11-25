const { performance } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');

const WORKFLOW_BUDGET_MS = 5000;
const MAX_TRANSACTION_ATTEMPTS = 64;
const deadline = () => performance.now() + WORKFLOW_BUDGET_MS;
const exceeded = () =>
  Object.assign(new Error('Application request exceeded its deadline. Refresh before retrying.'), {
    statusCode: 503
  });

function remaining(deadlineAt) {
  const milliseconds = Math.floor(deadlineAt - performance.now());
  if (milliseconds < 1) throw exceeded();
  return milliseconds;
}

function cursorOptions(session) {
  // The installed driver does not propagate a withTransaction CSOT context to
  // cursor construction. Without it, getMore receives illegal maxTimeMS on a
  // non-tailable cursor. Share the exact context, never a fresh per-batch timeout.
  return session?.timeoutContext ? { timeoutContext: session.timeoutContext } : {};
}

function retryGuard(deadlineAt) {
  let attempts = 0;
  return async () => {
    remaining(deadlineAt);
    if (++attempts > MAX_TRANSACTION_ATTEMPTS)
      throw Object.assign(
        new Error('Application request exhausted its retry budget. Refresh before retrying.'),
        { statusCode: 503 }
      );
    // Mongoose's installed driver retries callbacks immediately. Yield before the
    // next attempt's first Mongo operation, when it holds no server-side locks.
    if (attempts > 1) {
      const maximumDelay = Math.min(100, 5 * 2 ** Math.min(attempts - 2, 5));
      await delay(Math.min(remaining(deadlineAt), Math.ceil(Math.random() * maximumDelay)));
      remaining(deadlineAt);
    }
  };
}

function failure(error, mutation = false) {
  // CSOT may expire during commit without a definitive server reply. Never claim
  // rollback or replay the mutation after such an outcome; the driver retries
  // unknown commits, not the application callback, within the same deadline.
  if (
    mutation &&
    (error.hasErrorLabel?.('UnknownTransactionCommitResult') ||
      error.name === 'MongoOperationTimeoutError')
  ) {
    return Object.assign(
      new Error(
        'Application update outcome is unconfirmed. Refresh its status before trying again.'
      ),
      { statusCode: 503, cause: error }
    );
  }
  if (
    error.name === 'MongoOperationTimeoutError' ||
    error.hasErrorLabel?.('TransientTransactionError') ||
    error.code === 50
  ) {
    return Object.assign(exceeded(), { cause: error });
  }
  return error;
}

module.exports = {
  WORKFLOW_BUDGET_MS,
  MAX_TRANSACTION_ATTEMPTS,
  deadline,
  remaining,
  cursorOptions,
  retryGuard,
  failure
};
