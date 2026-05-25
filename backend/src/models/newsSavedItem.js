const mongoose = require('mongoose');

const newsSavedItemSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    articleId: {
      type: String,
      required: true,
      trim: true
    },
    title: {
      type: String,
      required: true,
      trim: true
    },
    url: {
      type: String,
      required: true,
      trim: true
    },
    source: {
      type: String,
      default: 'Unknown',
      trim: true
    },
    image: {
      type: String,
      default: '',
      trim: true
    },
    publishedAt: {
      type: Date,
      default: null
    },
    category: {
      type: String,
      default: 'Backend',
      trim: true
    },
    articleData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    type: {
      type: String,
      enum: ['bookmark', 'read_later'],
      required: true
    },
    readAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: { createdAt: true, updatedAt: false }
  }
);

newsSavedItemSchema.index({ userId: 1, url: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('NewsSavedItem', newsSavedItemSchema);
