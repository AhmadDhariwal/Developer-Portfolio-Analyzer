const AIVersion = require('../models/aiVersion');

const sanitizeSource = (source) => String(source || 'manual').trim().toLowerCase().slice(0, 60) || 'manual';

const getNextVersionNumber = async (userId, source) => {
  const latest = await AIVersion.findOne({ userId, source })
    .sort({ version: -1 })
    .select('version')
    .lean();
  return latest ? Number(latest.version || 0) + 1 : 1;
};

const persistVersion = async ({ userId, source, outputJson, metadata = {}, provenance }) => {
  const cleanSource = sanitizeSource(source);
  const version = await getNextVersionNumber(userId, cleanSource);

  return AIVersion.create({
    userId,
    source: cleanSource,
    version,
    outputJson,
    metadata,
    ...(provenance ? { provenance } : {}),
    createdAt: new Date()
  });
};

// Public create/rollback paths intentionally cannot forward provenance, even through
// a future spread of request fields. Only the canonical scorer uses the separate writer.
const createVersion = ({ userId, source, outputJson, metadata }) =>
  persistVersion({ userId, source, outputJson, metadata });

const createPortfolioVersion = ({ userId, outputJson, metadata, provenance }) =>
  persistVersion({ userId, source: 'portfolio_score', outputJson, metadata, provenance });

module.exports = {
  createVersion,
  createPortfolioVersion,
  sanitizeSource
};
