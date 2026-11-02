'use strict';
const governance = require('../services/integrationMongoGovernanceService');
const budgets = Object.freeze({ upload: [10, 30], analyze: [20, 60], guide: [5, 20] });
const deny = (res, error) => {
  const status = error.status === 429 ? 429 : 503;
  res.set('Retry-After', String(error.retryAfter || 2));
  return res.status(status).json({
    message:
      status === 429
        ? 'Resume request limit reached. Please retry later.'
        : 'Resume controls temporarily unavailable.'
  });
};
const limit = (action) => async (req, res, next) => {
  try {
    await governance.resumeWindow(req.user._id, req.ip, action, budgets[action]);
    next();
  } catch (error) {
    deny(res, error);
  }
};
const reserveJob = (kind) => async (req, res, next) => {
  // Authorization is checked again inside the pipeline, before reading file bytes.
  const file = kind === 'upload' ? 'upload' : String(req.body?.fileId || '');
  if (kind === 'analyze' && !/^[a-f0-9]{24}$/i.test(file)) return next();
  const until = Date.now() + (kind === 'upload' ? 0 : 30000);
  let joined = false;
  try {
    while (!req.resumeReservation) {
      if (res.destroyed) return;
      try {
        req.resumeReservation = await governance.resumeLease(req.user._id, file);
      } catch (error) {
        if (error.status !== 429 || Date.now() >= until) throw error;
        joined = true;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (joined) {
      req.body.forceRefresh = false;
      if (req.query) req.query.forceRefresh = 'false';
    }
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        governance.release(req.resumeReservation).catch(() => {});
      }
    };
    req.releaseResumeReservation = release;
    res.once('finish', release);
    // A disconnected response does not mean parsing/provider work has finished.
    // The controller releases in finally; an abandoned multipart request expires safely.
    next();
  } catch (error) {
    deny(res, error);
  }
};
module.exports = {
  limit,
  analysisLease: reserveJob('analyze'),
  uploadLease: reserveJob('upload'),
  budgets
};
