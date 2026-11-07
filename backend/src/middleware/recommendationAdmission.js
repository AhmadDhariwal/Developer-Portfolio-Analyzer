'use strict';
const controls = require('../services/recommendationGovernanceService');
const DEADLINE_MS = 45000;
const admit =
  (generation = false) =>
  async (req, res, next) => {
    const body = req.body || {};
    if (typeof body !== 'object' || Array.isArray(body))
      return res.status(400).json({ message: 'Invalid recommendations input.' });
    if (
      Buffer.byteLength(JSON.stringify(body), 'utf8') > 40000 ||
      (body.resumeText !== undefined &&
        (typeof body.resumeText !== 'string' || body.resumeText.length > 12000))
    )
      return res.status(413).json({ message: 'Recommendations input exceeds the supported size.' });
    if (
      [
        'username',
        'githubUsername',
        'careerStack',
        'experienceLevel',
        'previewResumeId',
        'resumeHash',
      ].some(
        (key) =>
          body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 200)
      )
    )
      return res.status(400).json({ message: 'Invalid recommendations input.' });
    const preview = body.isTemporary === true || body.isTemporary === 'true';
    if (!preview && !req.user?._id)
      return res.status(401).json({ message: 'Authentication required.' });
    const owner = req.user?._id ? `account:${req.user._id}` : `guest:${req.ip}`;
    const abort = new AbortController();
    res.once('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    let reservation;
    let timer;
    const release = () => {
      clearTimeout(timer);
      if (reservation) {
        const held = reservation;
        reservation = null;
        controls.release(held).catch(() => {});
      }
    };
    try {
      const actions = [
        generation ? (preview ? (req.user?._id ? 'preview' : 'guest') : 'profile') : 'read',
      ];
      if (generation && (body.forceRefresh === true || body.forceRefresh === 'true'))
        actions.push('refresh');
      await controls.consume(owner, req.ip, actions);
      if (generation) {
        reservation = await controls.acquire(owner, abort.signal);
        // A waiter reads the winner's compatible result instead of repeating paid work.
        if (reservation.joined) req.body.forceRefresh = false;
        req.recommendationGovernance = { owner, ip: req.ip, signal: abort.signal, reservation };
        timer = setTimeout(() => abort.abort(), DEADLINE_MS);
        timer.unref?.();
        req.releaseRecommendationReservation = release;
        res.once('finish', release);
      }
      next();
    } catch (error) {
      release();
      const status = error.status === 429 ? 429 : 503;
      res.set('Retry-After', String(error.retryAfter || 2));
      return res.status(status).json({ message: controls.failure(status).message });
    }
  };
module.exports = { admit, DEADLINE_MS };
