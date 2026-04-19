const { getNewsFeed } = require('../services/newsService');
const logger = require('../utils/logger');

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
      totalPages,
      hasMore: payload.filters.page < totalPages,
      sourceSummary: payload.sourceSummary,
      trendingTopics: payload.trendingTopics,
      activeTab: payload.filters.tab,
      fromCache: payload.fromCache
    });
  } catch (error) {
    logger.error('news feed failed', {
      ...logger.withRequest(req),
      error: error.message
    });
    res.status(500).json({ message: 'Failed to fetch tech news feed.' });
  }
};

module.exports = { getNews };
