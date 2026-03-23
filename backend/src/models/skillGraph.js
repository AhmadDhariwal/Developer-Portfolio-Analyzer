const mongoose = require('mongoose');

const skillNodeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true },
  category: { type: String, default: 'General' },
  demandScore: { type: Number, default: 50 },
  proficiency: { type: Number, default: 0 },
  kind: { type: String, enum: ['current', 'missing'], default: 'missing' },
  relatedSkills: [{ type: String }]
}, { _id: false });

const skillEdgeSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  type: { type: String, enum: ['prerequisite', 'dependency', 'related'], default: 'related' },
  weight: { type: Number, default: 0.5 }
}, { _id: false });

const weeklyRoadmapSchema = new mongoose.Schema({
  week: { type: Number, required: true },
  focusSkills: [{ type: String }],
  reason: { type: String, default: '' },
  outcomes: [{ type: String }]
}, { _id: false });

const skillGraphSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  careerStack: {
    type: String,
    enum: ['Frontend', 'Backend', 'Full Stack', 'AI/ML'],
    default: 'Full Stack'
  },
  experienceLevel: {
    type: String,
    default: 'Student'
  },
  nodes: [skillNodeSchema],
  edges: [skillEdgeSchema],
  weeklyRoadmap: [weeklyRoadmapSchema],
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('SkillGraph', skillGraphSchema);
