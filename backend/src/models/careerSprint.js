const mongoose = require('mongoose');

const sprintTaskSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  points:      { type: Number, default: 3 },
  priority:    { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
  category:    { type: String, enum: ['learning', 'project', 'practice'], default: 'learning' },
  taskType:    { type: String, enum: ['ai', 'manual'], default: 'manual' },
  isCompleted: { type: Boolean, default: false },
  completedAt: { type: Date, default: null },
  // Task timeline (set by AI generator based on sprint duration)
  startDate:   { type: Date, default: null },
  endDate:     { type: Date, default: null },
  // Legacy aliases kept for backward compat
  dueDate:     { type: Date, default: null },
  deadline:    { type: Date, default: null },
}, { _id: true });

const careerSprintSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  title:         { type: String, default: 'Career Sprint' },

  // ── Sprint date range (user-selectable) ───────────────────────────────
  // sprintStartDate / sprintEndDate = user-chosen range (may differ from week)
  sprintStartDate: { type: Date, default: null },
  sprintEndDate:   { type: Date, default: null },
  // Legacy week fields kept for backward compat
  weekStartDate: { type: Date, required: true },
  weekEndDate:   { type: Date, required: true },

  weeklyGoal: { type: Number, default: 5 },

  // ── Day-based streak ──────────────────────────────────────────────────
  currentStreak:  { type: Number, default: 0 },   // days
  longestStreak:  { type: Number, default: 0 },   // days
  lastActiveDate: { type: Date, default: null },   // last day a task was completed
  // Legacy week-streak kept for backward compat
  streak:              { type: Number, default: 0 },
  lastCompletedWeekAt: { type: Date, default: null },

  streakBroken:    { type: Boolean, default: false },
  streakBrokenAt:  { type: Date, default: null },
  streakWarning:   { type: Boolean, default: false },
  streakStatus:    { type: String, enum: ['active', 'warning', 'broken'], default: 'active' },

  // ── XP & Level ────────────────────────────────────────────────────────
  xpPoints: { type: Number, default: 0 },
  level:    { type: Number, default: 1 },

  // ── Sprint Goal (optional) ────────────────────────────────────────────
  goalStack:           { type: String, default: '' },
  goalTechnology:      { type: String, default: '' },
  goalTitle:           { type: String, default: '' },
  goalExperienceLevel: { type: String, default: '' },

  tasks: [sprintTaskSchema]
}, { timestamps: true });

module.exports = mongoose.model('CareerSprint', careerSprintSchema);
