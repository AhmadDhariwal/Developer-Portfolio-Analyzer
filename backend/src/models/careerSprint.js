const mongoose = require('mongoose');
const recommendationProvenance = {
  sourceRecommendationId: { type: String },
  sourceRecommendationSnapshotId: { type: String },
  sourceRecommendationHash: { type: String },
  sourceRule: { type: String },
  evidenceLimitation: { type: String }
};

const sprintTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    points: {
      type: Number,
      min: 1,
      max: 10,
      default: function () {
        return { learning: 3, project: 5, practice: 4 }[this.category] || 3;
      }
    },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    category: { type: String, enum: ['learning', 'project', 'practice'], default: 'learning' },
    taskType: { type: String, enum: ['ai', 'manual'], default: 'manual' },
    isCompleted: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
    // Task timeline (set by AI generator based on sprint duration)
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    // Legacy aliases kept for backward compat
    dueDate: { type: Date, default: null },
    deadline: { type: Date, default: null },
    sourceScenarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScenarioSimulation', default: null },
    sourceScenarioHash: { type: String, default: '' },
    ...recommendationProvenance
  },
  { _id: true }
);

const aiPlanTaskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 1000 },
    points: {
      type: Number,
      min: 1,
      max: 10,
      default: function () {
        return { learning: 3, project: 5, practice: 4 }[this.category] || 3;
      }
    },
    priority: { type: String, enum: ['high', 'medium', 'low'], default: 'medium' },
    category: { type: String, enum: ['learning', 'project', 'practice'], default: 'learning' },
    taskType: { type: String, enum: ['ai', 'manual'], default: 'ai' },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    sourceScenarioId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScenarioSimulation', default: null },
    sourceScenarioHash: { type: String, default: '' },
    ...recommendationProvenance
  },
  { _id: false }
);

const aiPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, default: 'AI Sprint Plan' },
    context: { type: mongoose.Schema.Types.Mixed },
    origin: { type: String, enum: ['manual', 'deterministic', 'ai', 'scenario'] },
    source: { type: String, enum: ['ai', 'scenario'], default: 'ai' },
    generatorType: { type: String, enum: ['deterministic', 'llm', 'scenario'], default: 'deterministic' },
    goalStack: { type: String, default: '' },
    goalTechnology: { type: String, default: '' },
    goalExperienceLevel: { type: String, default: '' },
    summary: { type: String, default: '' },
    confidenceScore: { type: Number, default: 0 },
    consistencyScore: { type: Number, default: 0 },
    signalsUsed: [{ type: String }],
    tasks: [aiPlanTaskSchema],
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const careerSprintSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    title: { type: String, default: 'Career Sprint' },
    // New windows are retry-safe without rewriting or deleting legacy records.
    creationKey: { type: String },
    occupiedDays: { type: [String], default: undefined },
    timeZone: { type: String },
    calendarPolicy: { type: String },
    tzdbVersion: { type: String },
    scheduleToken: { type: String },
    migrationCalendarTimeZone: { type: String },
    reservationPolicy: { type: String },
    legacyException: {
      owner: String,
      start: String,
      end: String,
      reason: String,
      evidence: String
    },

    // ── Sprint date range (user-selectable) ───────────────────────────────
    // sprintStartDate / sprintEndDate = user-chosen range (may differ from week)
    sprintStartDate: { type: Date, default: null },
    sprintEndDate: { type: Date, default: null },
    // Legacy week fields kept for backward compat
    weekStartDate: { type: Date, required: true },
    weekEndDate: { type: Date, required: true },

    weeklyGoal: { type: Number, default: 5 },

    // ── Day-based streak ──────────────────────────────────────────────────
    currentStreak: { type: Number, default: 0 }, // days
    longestStreak: { type: Number, default: 0 }, // days
    lastActiveDate: { type: Date, default: null }, // last day a task was completed
    // Legacy week-streak kept for backward compat
    streak: { type: Number, default: 0 },
    lastCompletedWeekAt: { type: Date, default: null },

    streakBroken: { type: Boolean, default: false },
    streakBrokenAt: { type: Date, default: null },
    streakRestoredAt: { type: Date, default: null },
    restoredIntervalId: { type: String },
    streakWarning: { type: Boolean, default: false },
    streakStatus: { type: String, enum: ['active', 'warning', 'broken'], default: 'active' },

    // ── XP & Level ────────────────────────────────────────────────────────
    xpPoints: { type: Number, default: 0 },
    level: { type: Number, default: 1 },

    // ── Sprint Goal (optional) ────────────────────────────────────────────
    goalStack: { type: String, default: '' },
    goalTechnology: { type: String, default: '' },
    goalTitle: { type: String, default: '' },
    goalExperienceLevel: { type: String, default: '' },

    tasks: [sprintTaskSchema],
    aiPlans: [aiPlanSchema]
  },
  { timestamps: true, optimisticConcurrency: true, read: 'primary' }
);

careerSprintSchema.index({ userId: 1, updatedAt: -1 });
careerSprintSchema.index(
  { userId: 1, creationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { creationKey: { $type: 'string' } }
  }
);
careerSprintSchema.index(
  { userId: 1, occupiedDays: 1 },
  {
    unique: true,
    partialFilterExpression: { 'occupiedDays.0': { $exists: true } }
  }
);
careerSprintSchema.index({ userId: 1, sprintStartDate: 1, sprintEndDate: 1 });
careerSprintSchema.index({ userId: 1, 'tasks.isCompleted': 1, 'tasks.endDate': 1 });
careerSprintSchema.index({ userId: 1, weekStartDate: -1 });
careerSprintSchema.index({ userId: 1, weekStartDate: 1, weekEndDate: 1 });

module.exports = mongoose.model('CareerSprint', careerSprintSchema);
