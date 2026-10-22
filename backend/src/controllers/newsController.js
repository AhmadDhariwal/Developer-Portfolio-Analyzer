const mongoose = require('mongoose');
const NewsSavedItem = require('../models/newsSavedItem');
const { getNewsFeed } = require('../services/newsService');
const logger = require('../utils/logger');

const normalizeSavedType = (value) => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'read_later' || normalized === 'read-later' || normalized === 'read later') return 'read_later';
  if (normalized === 'bookmark') return 'bookmark';
  return '';
};

const sanitizeString = (value, maxLength, fallback = '') =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, maxLength) || fallback;

const { safeNewsUrl: sanitizeUrl } = require('../utils/newsUrl');

const normalizePublishedAt = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const mapSavedItem = (item) => ({
  id: String(item?._id || ''),
  articleId: String(item?.articleId || ''),
  title: String(item?.title || ''),
  url: String(item?.url || ''),
  source: String(item?.source || 'Unknown'),
  image: String(item?.image || ''),
  publishedAt: item?.publishedAt || null,
  category: String(item?.category || 'Backend'),
  type: item?.type,
  createdAt: item?.createdAt || null,
  readAt: item?.readAt || null,
  firstReadAt: item?.firstReadAt || item?.readAt || item?.lastReadAt || null,
  lastReadAt: item?.lastReadAt || item?.readAt || null,
  readCount: Math.max(Number(item?.readCount) || 0, item?.readAt || item?.lastReadAt ? 1 : 0)
});

const getNews = async (req, res) => {
  try {
    const payload = await getNewsFeed({
      user: req.user,
      query: req.query
    });
    const totalPages = Math.max(1, Math.ceil(payload.total / payload.filters.limit));
    res.json({
      items: payload.items,
      total: payload.total,
      page: payload.filters.page,
      limit: payload.filters.limit,
      totalPages,
      hasMore: payload.filters.page < totalPages,
      sourceSummary: payload.sourceSummary || {},
      trendingTopics: payload.trendingTopics || [],
      activeTab: payload.filters.tab,
      fromCache: payload.fromCache,
      recommendedBasedOn: payload.recommendedBasedOn || {},
      telemetry: payload.telemetry || {
        cacheHit: false,
        providerFailureCount: 0,
        providerUsed: [],
        providerDiagnostics: [],
        signalHash: '',
        responseTimeMs: 0
      }
    });
  } catch (error) {
    logger.error('news feed failed', {
      ...logger.withRequest(req),
      error: error.message
    });
    res.status(500).json({ message: 'Failed to fetch tech news feed.' });
  }
};

const getSavedNews = async (req, res) => {
  try {
    const type = normalizeSavedType(req.query?.type);
    if (req.query?.type && !type) {
      return res.status(400).json({ message: 'Saved news type is invalid.' });
    }

    const rawPage = req.query?.page;
    const rawLimit = req.query?.limit;
    const page = rawPage === undefined ? 1 : Number(rawPage);
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ message: 'Saved news pagination is invalid.' });
    }

    const filter = { userId: req.user._id };
    if (type) filter.type = type;

    const [items, total] = await Promise.all([
      NewsSavedItem.find(filter)
        .select(
          'articleId title url source image publishedAt category type createdAt readAt firstReadAt lastReadAt readCount'
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NewsSavedItem.countDocuments(filter)
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    res.json({
      items: items.map(mapSavedItem),
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages
    });
  } catch (error) {
    logger.error('saved news fetch failed', {
      ...logger.withRequest(req),
      error: error.message
    });
    res.status(500).json({ message: 'Failed to load saved news items.' });
  }
};

const saveNews = async (req, res) => {
  try {
    for (const key of ['articleId', 'title', 'url', 'source', 'image', 'category', 'type', 'publishedAt']) {
      if (req.body?.[key] !== undefined && req.body[key] !== null && typeof req.body[key] !== 'string')
        return res.status(400).json({ message: 'Saved news fields must be strings.' });
    }
    const articleId = sanitizeString(req.body?.articleId, 160);
    const title = sanitizeString(req.body?.title, 220);
    const url = sanitizeUrl(req.body?.url);
    const source = sanitizeString(req.body?.source, 80, 'Unknown');
    const image = req.body?.image ? sanitizeUrl(req.body.image) : '';
    const category = sanitizeString(req.body?.category, 80, 'Backend');
    const type = normalizeSavedType(req.body?.type);
    const publishedAt = normalizePublishedAt(req.body?.publishedAt);

    if (
      !articleId ||
      !title ||
      !url ||
      !type ||
      (req.body?.publishedAt && !publishedAt) ||
      (req.body?.image && !image)
    ) {
      return res.status(400).json({
        message: 'Valid articleId, title, url, and type are required.'
      });
    }

    const existing = await NewsSavedItem.findOne({
      userId: req.user._id,
      url,
      type
    }).lean();

    if (existing) {
      return res.status(200).json({
        item: mapSavedItem(existing),
        message: 'Article already saved.'
      });
    }

    const created = await NewsSavedItem.create({
      userId: req.user._id,
      articleId,
      title,
      url,
      source,
      image,
      publishedAt,
      category,
      type,
      articleData: {
        articleId,
        title,
        url,
        source,
        image,
        publishedAt,
        category
      }
    });

    res.status(201).json({
      item: mapSavedItem(created.toObject()),
      message: type === 'bookmark' ? 'Article bookmarked.' : 'Article saved for later.'
    });
  } catch (error) {
    if (error?.code === 11000) {
      const type = normalizeSavedType(req.body?.type);
      const url = sanitizeUrl(req.body?.url);
      const existing = type && url ? await NewsSavedItem.findOne({ userId: req.user._id, url, type }).lean() : null;
      if (existing) {
        return res.status(200).json({
          item: mapSavedItem(existing),
          message: 'Article already saved.'
        });
      }
      return res.status(409).json({ message: 'This article is already saved.' });
    }
    logger.error('saved news create failed', {
      ...logger.withRequest(req),
      error: error.message
    });
    res.status(500).json({ message: 'Failed to save this news item.' });
  }
};

const removeSavedNews = async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Saved news id is invalid.' });
    }

    const removed = await NewsSavedItem.findOneAndDelete({
      _id: id,
      userId: req.user._id
    }).lean();

    if (!removed) {
      return res.status(404).json({ message: 'Saved news item was not found.' });
    }

    res.json({
      message: 'Saved news item removed.',
      id
    });
  } catch (error) {
    logger.error('saved news delete failed', {
      ...logger.withRequest(req),
      error: error.message
    });
    res.status(500).json({ message: 'Failed to remove this saved news item.' });
  }
};

const markSavedNewsAsRead = async (req, res) => {
  try {
    const body = req.body === undefined ? {} : req.body;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => key !== 'read') ||
      (Object.hasOwn(body, 'read') && typeof body.read !== 'boolean')
    )
      return res.status(400).json({ message: 'Read status must be a boolean read field or an empty object.' });
    const read = body.read !== false;
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Saved news id is invalid.' });
    }

    const previousRead = { $ifNull: ['$readAt', null] };
    const previousHistory = { $ifNull: ['$lastReadAt', previousRead] };
    // Atomic, lazy legacy hydration preserves the original completion before
    // clearing readAt. A repeated state does not add a completion or change time.
    const history = {
      firstReadAt: { $ifNull: ['$firstReadAt', { $ifNull: [previousRead, previousHistory] }] },
      lastReadAt: previousHistory,
      readCount: { $max: [{ $ifNull: ['$readCount', 0] }, { $cond: [{ $ne: [previousHistory, null] }, 1, 0] }] }
    };
    const transition = read
      ? {
          firstReadAt: { $ifNull: ['$firstReadAt', '$$NOW'] },
          lastReadAt: { $cond: [{ $ne: [previousRead, null] }, '$lastReadAt', '$$NOW'] },
          readAt: { $ifNull: ['$readAt', '$$NOW'] },
          readCount: { $add: ['$readCount', { $cond: [{ $ne: [previousRead, null] }, 0, 1] }] }
        }
      : { readAt: null };
    const item = await NewsSavedItem.findOneAndUpdate(
      { _id: id, userId: req.user._id, type: 'read_later' },
      [{ $set: history }, { $set: transition }],
      { returnDocument: 'after', updatePipeline: true }
    ).lean();

    if (!item) {
      return res.status(404).json({ message: 'Read later item was not found.' });
    }

    res.json({
      item: mapSavedItem(item),
      message: read ? 'Read later item marked as read.' : 'Read later item marked as unread.'
    });
  } catch (error) {
    logger.error('saved news read update failed', {
      ...logger.withRequest(req),
      error: error.message
    });
    res.status(500).json({ message: 'Failed to update this saved news item.' });
  }
};

module.exports = { getNews, getSavedNews, saveNews, removeSavedNews, markSavedNewsAsRead };
