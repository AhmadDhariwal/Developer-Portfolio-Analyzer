const AIVersion = require('../models/aiVersion');

const sanitizeSource = (source) => String(source || 'manual').trim().toLowerCase().slice(0, 60) || 'manual';

const getNextVersionNumber = async (userId, source) => {
  const latest = await AIVersion.findOne({ userId, source })
    .sort({ version: -1 })
    .select('version')
    .lean();
  return latest ? Number(latest.version || 0) + 1 : 1;
};

const createVersion = async ({ userId, source, outputJson, metadata = {} }) => {
  const cleanSource = sanitizeSource(source);
  const version = await getNextVersionNumber(userId, cleanSource);

  return AIVersion.create({
    userId,
    source: cleanSource,
    version,
    outputJson,
    metadata,
    createdAt: new Date()
  });
};

module.exports = {
  createVersion,
  sanitizeSource
};
