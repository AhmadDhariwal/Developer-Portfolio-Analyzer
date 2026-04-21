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
  weekStartDate: { type: Date, required: true },
  weekEndDate:   { type: Date, required: true },
  weeklyGoal:    { type: Number, default: 5 },

  // ── Streak ────────────────────────────────────────────────────────────
  streak:              { type: Number, default: 0 },
  longestStreak:       { type: Number, default: 0 },
  lastCompletedWeekAt: { type: Date, default: null },
  streakBroken:        { type: Boolean, default: false },
  streakBrokenAt:      { type: Date, default: null },
  streakWarning:       { type: Boolean, default: false },
  streakStatus:        { type: String, enum: ['active', 'warning', 'broken'], default: 'active' },

  // ── XP & Level ────────────────────────────────────────────────────────
  xpPoints: { type: Number, default: 0 },
  level:    { type: Number, default: 1 },

  // ── Sprint Goal (optional) ────────────────────────────────────────────
  goalStack:       { type: String, default: '' },
  goalTechnology:  { type: String, default: '' },
  goalTitle:       { type: String, default: '' },
  goalExperienceLevel: { type: String, default: '' },

  tasks: [sprintTaskSchema]
}, { timestamps: true });

module.exports = mongoose.model('CareerSprint', careerSprintSchema);
