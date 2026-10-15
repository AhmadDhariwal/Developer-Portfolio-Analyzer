'use strict';
const mongoose = require('mongoose');
const courseSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, maxlength: 120 },
    title: { type: String, required: true, maxlength: 200 },
    url: { type: String, required: true, maxlength: 1000 },
    platform: {
      type: String,
      required: true,
      enum: ['Udemy', 'Coursera', 'YouTube', 'edX', 'freeCodeCamp'],
    },
    topics: { type: [String], default: [] },
    instructor: { type: String, maxlength: 120, default: null },
    provenance: {
      source: String,
      availability: String,
      metadataVerifiedAt: { type: Date, default: null },
    },
  },
  { _id: false },
);
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    courseId: { type: String, required: true, maxlength: 120 },
    course: { type: courseSchema, required: true },
    status: { type: String, enum: ['saved', 'in_progress', 'completed'], required: true },
    notes: { type: String, maxlength: 2000, default: '' },
    progressPercent: { type: Number, min: 0, max: 100, default: null },
    progressSource: { type: String, enum: ['user-entered'], default: 'user-entered' },
    completionSource: { type: String, enum: ['self-reported'], default: 'self-reported' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: 'throw' },
);
schema.index({ userId: 1, courseId: 1 }, { unique: true, name: 'user_course_identity' });
schema.index({ userId: 1, status: 1, updatedAt: -1, _id: -1 }, { name: 'user_course_status' });
module.exports = mongoose.model('UserCourseProgress', schema);
