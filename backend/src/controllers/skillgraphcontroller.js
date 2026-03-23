const SkillGraph = require('../models/skillGraph');
const { buildSkillGraph, generateWeeklyLearningRoadmap } = require('../services/skillGraphService');

const generateSkillGraph = async (req, res) => {
  try {
    const {
      currentSkills = [],
      missingSkills = [],
      careerStack = req.user?.careerStack || 'Full Stack',
      experienceLevel = req.user?.experienceLevel || 'Student',
      weeks = 8
    } = req.body || {};

    const graph = buildSkillGraph({ currentSkills, missingSkills });
    const weeklyRoadmap = generateWeeklyLearningRoadmap(graph, weeks);

    if (req.user?._id) {
      await SkillGraph.findOneAndUpdate(
        { userId: req.user._id },
        {
          $set: {
            userId: req.user._id,
            careerStack,
            experienceLevel,
            nodes: graph.nodes,
            edges: graph.edges,
            weeklyRoadmap,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
    }

    return res.json({
      careerStack,
      experienceLevel,
      graph,
      weeklyRoadmap
    });
  } catch (error) {
    console.error('Generate skill graph error:', error.message);
    return res.status(500).json({ message: 'Failed to generate skill graph.' });
  }
};

const getLatestSkillGraph = async (req, res) => {
  try {
    if (!req.user?._id) {
      return res.status(401).json({ message: 'Not authorized.' });
    }

    const graph = await SkillGraph.findOne({ userId: req.user._id }).lean();
    if (!graph) {
      return res.status(404).json({ message: 'Skill graph not found. Generate one first.' });
    }

    return res.json({
      careerStack: graph.careerStack,
      experienceLevel: graph.experienceLevel,
      graph: {
        nodes: graph.nodes || [],
        edges: graph.edges || []
      },
      weeklyRoadmap: graph.weeklyRoadmap || [],
      updatedAt: graph.updatedAt
    });
  } catch (error) {
    console.error('Get skill graph error:', error.message);
    return res.status(500).json({ message: 'Failed to load skill graph.' });
  }
};

module.exports = { generateSkillGraph, getLatestSkillGraph };
