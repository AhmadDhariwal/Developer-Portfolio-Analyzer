const mongoose = require('mongoose');
const NewsCache = require('./news');

// Reuse validated article storage/indexes in a separate collection so Dashboard's
// existing public-pool lookup cannot accidentally select a narrow topic document.
module.exports = mongoose.model('NewsTopicCache', NewsCache.schema.clone());
