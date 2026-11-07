'use strict';
const controls = require('../services/skillGapGovernanceService');
const DEADLINE_MS = 25000;
async function admit(req, res, next) {
  const started = Date.now();
  const mode =
    req.body?.isTemporary === true || req.body?.isTemporary === 'true'
      ? req.user?._id
        ? 'preview'
        : 'guest'
      : 'profile';
  res.once('finish', () => require('../services/skillGapMetrics').request(res, mode, started));
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return res.status(400).json({ message: 'Invalid analysis input.' });
  if (
    Buffer.byteLength(JSON.stringify(body), 'utf8') > 20000 ||
    (body.resumeText !== undefined &&
      (typeof body.resumeText !== 'string' || body.resumeText.length > 12000))
  ) {
    return res.status(413).json({ message: 'Skill Gap input exceeds the supported size.' });
  }
  if (
    ['username', 'careerStack', 'experienceLevel', 'previewResumeId', 'resumeHash'].some(
      (key) => body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 200)
    )
  ) {
    return res.status(400).json({ message: 'Invalid analysis input.' });
  }
  const preview = body.isTemporary === true || body.isTemporary === 'true';
  if (!preview && !req.user?._id)
    return res.status(401).json({ message: 'Authentication required for profile mode.' });
  const owner = req.user?._id ? `account:${req.user._id}` : `guest:${req.ip}`;
  try {
    const actions = [preview ? (req.user?._id ? 'preview' : 'guest') : 'profile'];
    if (body.forceRefresh === true || body.forceRefresh === 'true')
      actions.push('refresh', 'source');
    await controls.consume(owner, req.ip, actions);
    const abort = new AbortController();
    req.skillGapGovernance = { owner, signal: abort.signal };
    const timer = setTimeout(() => {
      abort.abort();
      if (!res.headersSent && !res.destroyed) {
        res.set('Retry-After', '2');
        res.status(503).json({ message: 'Skill Gap analysis deadline exceeded. Please retry.' });
      }
    }, DEADLINE_MS);
    timer.unref?.();
    res.once('finish', () => clearTimeout(timer));
    res.once('close', () => {
      clearTimeout(timer);
      if (!res.writableFinished) abort.abort();
    });
    next();
  } catch (error) {
    const status = error.status === 429 ? 429 : 503;
    res.set('Retry-After', String(error.retryAfter || 2));
    res.status(status).json({ message: controls.failure(status).message });
  }
}
module.exports = { admit, DEADLINE_MS };
