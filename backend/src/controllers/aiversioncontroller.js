const AIVersion = require('../models/aiVersion');
const { createVersion, sanitizeSource } = require('../services/aiVersionService');

const listVersions = async (req, res) => {
  try {
    const source = req.query.source ? sanitizeSource(req.query.source) : null;
    const includeOutput = String(req.query.includeOutput || 'false').toLowerCase() === 'true';
    const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100));
    const filter = { userId: req.user._id };
    if (source) filter.source = source;

    let query = AIVersion.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit);

    if (!includeOutput) {
      query = query.select('_id source version metadata createdAt');
    }

    const versions = await query.lean();

    res.json({ versions });
  } catch (error) {
    console.error('List AI versions error:', error.message);
    res.status(500).json({ message: 'Failed to fetch AI versions.' });
  }
};

const createAiVersion = async (req, res) => {
  try {
    const { source, outputJson, metadata } = req.body;
    if (!outputJson || typeof outputJson !== 'object') {
      return res.status(400).json({ message: 'outputJson object is required.' });
    }

    const version = await createVersion({
      userId: req.user._id,
      source: source || 'manual',
      outputJson,
      metadata: metadata || {}
    });

    res.status(201).json({ version });
  } catch (error) {
    console.error('Create AI version error:', error.message);
    res.status(500).json({ message: 'Failed to create AI version.' });
  }
};

const compareVersions = async (req, res) => {
  try {
    const { id, compareId } = req.params;

    const [base, target] = await Promise.all([
      AIVersion.findOne({ _id: id, userId: req.user._id }).lean(),
      AIVersion.findOne({ _id: compareId, userId: req.user._id }).lean()
    ]);

    if (!base || !target) {
      return res.status(404).json({ message: 'One or both versions not found.' });
    }

    const baseText = JSON.stringify(base.outputJson, null, 2).split('\n');
    const targetText = JSON.stringify(target.outputJson, null, 2).split('\n');

    const maxLines = Math.max(baseText.length, targetText.length);
    const diff = [];

    for (let i = 0; i < maxLines; i++) {
      const left = baseText[i] ?? '';
      const right = targetText[i] ?? '';
      if (left === right) continue;
      diff.push({ line: i + 1, left, right });
    }

    res.json({
      base: { _id: base._id, source: base.source, version: base.version, createdAt: base.createdAt },
      target: { _id: target._id, source: target.source, version: target.version, createdAt: target.createdAt },
      diff
    });
  } catch (error) {
    console.error('Compare AI versions error:', error.message);
    res.status(500).json({ message: 'Failed to compare versions.' });
  }
};

const rollbackVersion = async (req, res) => {
  try {
    const source = req.body.source ? sanitizeSource(req.body.source) : null;
    const selected = await AIVersion.findOne({ _id: req.params.id, userId: req.user._id }).lean();

    if (!selected) {
      return res.status(404).json({ message: 'Version not found.' });
    }

    const rollback = await createVersion({
      userId: req.user._id,
      source: source || selected.source,
      outputJson: selected.outputJson,
      metadata: {
        rollbackOf: selected._id,
        rollbackOfVersion: selected.version,
        createdBy: 'rollback'
      }
    });

    res.json({ message: 'Rollback version created.', version: rollback });
  } catch (error) {
    console.error('Rollback AI version error:', error.message);
    res.status(500).json({ message: 'Failed to rollback AI version.' });
  }
};

module.exports = {
  listVersions,
  createAiVersion,
  compareVersions,
  rollbackVersion
};
