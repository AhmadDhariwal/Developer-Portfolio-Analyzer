const actions = require('../services/jobActionService');
const respond = (work) => async (req, res) => {
  try {
    return res.json(await work(req));
  } catch (error) {
    return res
      .status(error.status || 503)
      .json({ message: error.status ? error.message : 'Job actions are temporarily unavailable.' });
  }
};
const update = respond(async (req) => ({
  action: await actions.update(req.user._id, req.params.id, req.body)
}));
const list = respond((req) => actions.list(req.user._id, req.query));
const toggle = (field, value) =>
  respond(async (req) => ({
    action: await actions.update(req.user._id, req.params.id, { [field]: value })
  }));
module.exports = { update, list, toggle };
