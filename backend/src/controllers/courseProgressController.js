'use strict';
const progress = require('../services/courseProgressService');
const { handoff } = require('../services/courseHandoffService');
const endpoint = (work) => async (req, res) => {
  if (!req.user?._id) return res.status(401).json({ message: 'Authentication required.' });
  res.set?.('Cache-Control', 'private, no-store');
  try {
    return await work(req, res);
  } catch (error) {
    const status = [400, 404, 409, 503].includes(error.status) ? error.status : 503;
    return res.status(status).json({
      message: error.status
        ? error.message
        : 'Learning progress is temporarily unavailable. Please retry.',
    });
  }
};
module.exports = {
  listProgress: endpoint(async (req, res) =>
    res.json(await progress.listProgress(req.user._id, req.query)),
  ),
  saveProgress: endpoint(async (req, res) =>
    res.json(await progress.saveProgress(req.user._id, req.params.courseId, req.body)),
  ),
  removeProgress: endpoint(async (req, res) => {
    await progress.removeProgress(req.user._id, req.params.courseId);
    return res.status(204).send();
  }),
  handoffToSprint: endpoint(async (req, res) =>
    res.json(await handoff(req.user._id, req.params.courseId, req.body)),
  ),
};
