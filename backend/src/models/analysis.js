const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    githubScore: {
        type: Number,
        default: 0
    },
    skillScore: {
        type: Number,
        default: 0
    },
    readinessScore: {
        type: Number,
        default: 0
    },
    missingSkills: [{
        type: String
    }],
    recommendations: [{
        type: mongoose.Schema.Types.Mixed
    }],
    githubStats: {
        repos: { type: Number, default: 0 },
        stars: { type: Number, default: 0 },
        forks: { type: Number, default: 0 },
        followers: { type: Number, default: 0 }
    },
    githubAnalysisVersion: {
        type: String,
        default: 'github-v1'
    },
    githubSignals: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    githubAnalysisHistory: [{
        analyzedAt: { type: Date, default: Date.now },
        healthScore: { type: Number, default: 0 },
        repos: { type: Number, default: 0 },
        stars: { type: Number, default: 0 },
        forks: { type: Number, default: 0 },
        followers: { type: Number, default: 0 },
        topLanguages: [{ type: String }],
        topTechnologies: [{ type: String }]
    }],
    languageDistribution: {
        type: Map,
        of: Number,
        default: {}
    },
    contributionActivity: [{
        month: String,
        count: Number
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Analysis', analysisSchema);
