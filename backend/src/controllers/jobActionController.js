const actions = require('../services/jobActionService');
const hidden = require('../services/jobsHiddenAccessService');
const respond = (work) => async (req, res) => {
  try {
    return res.json(await work(req));
  } catch (error) {
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    return res.status(error.status || 503).json({
      message: error.status ? error.message : 'Job actions are temporarily unavailable.',
      ...(/^JOBS_HIDDEN_/.test(error.code || '') ? { code: error.code } : {})
    });
  }
};
const update = respond(async (req) => ({
  action: await actions.update(req.user._id, req.params.id, req.body, {
    allowHidden: await hidden.isUnlocked(req)
  })
}));
const list = respond(async (req) =>
  actions.list(req.user._id, req.query, { allowHidden: await hidden.isUnlocked(req) })
);
const toggle = (field, value) =>
  respond(async (req) => ({
    action: await actions.update(
      req.user._id,
      req.params.id,
      { [field]: value },
      { allowHidden: await hidden.isUnlocked(req) }
    )
  }));
const unlockHidden = respond((req) => hidden.unlock(req));
const lockHidden = respond(async (req) => {
  await hidden.lock(req);
  return { locked: true };
});
module.exports = { update, list, toggle, unlockHidden, lockHidden };
