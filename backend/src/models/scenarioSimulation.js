const mongoose = require('mongoose');

const scenarioProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    impact: { type: Number, default: 65, min: 0, max: 100 },
    complexity: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium'
    },
    weeks: { type: Number, default: 3, min: 1, max: 24 }
  },
  { _id: false }
);

const scorePairSchema = new mongoose.Schema(
  {
    hiringScore: { type: Number, default: 0 },
    jobMatch: { type: Number, default: 0 }
  },
  { _id: false }
);

const scenarioSimulationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120
    },
    baselineHiringScore: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    baselineJobMatch: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    role: {
      type: String,
      default: 'full stack',
      trim: true
    },
    experienceLevel: {
      type: String,
      default: 'mid',
      trim: true
    },
    durationWeeks: {
      type: Number,
      default: 6,
      min: 1,
      max: 24
    },
    skills: [{ type: String, trim: true }],
    projects: [scenarioProjectSchema],
    predicted: { type: scorePairSchema, default: () => ({}) },
    improvements: { type: scorePairSchema, default: () => ({}) },
    confidenceScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    scenarioHash: {
      type: String,
      default: '',
      index: true
    },
    breakdown: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    uncertaintyRange: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    warnings: [{ type: String }],
    sourceContextSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

scenarioSimulationSchema.index({ userId: 1, createdAt: -1 });

scenarioSimulationSchema.index({ userId: 1, scenarioHash: 1 });
scenarioSimulationSchema.index({ userId: 1, role: 1, experienceLevel: 1 });
module.exports = mongoose.model('ScenarioSimulation', scenarioSimulationSchema);
