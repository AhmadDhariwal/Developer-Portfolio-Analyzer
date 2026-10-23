const mongoose = require('mongoose');
const NewsCache = require('./news');

// Reuse validated article storage/indexes in a separate collection so Dashboard's
// existing public-pool lookup cannot accidentally select a narrow topic document.
const schema = NewsCache.schema.clone();
schema.set('bufferCommands', false);
// Query lookup is an exact bounded hash, with publication-date/source/category filters
// applied over at most forty embedded validated articles before pagination.
schema.index({ 'filters.topic': 1, expiresAt: 1 });
module.exports = mongoose.model('NewsTopicCache', schema);
