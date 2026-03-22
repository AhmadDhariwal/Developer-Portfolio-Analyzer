const WorkflowRun = require('../models/workflowRun');
const {
  PIPELINES,
  buildPipelineSteps,
  runPipeline
} = require('../services/workflowExecutorService');

const normalizePipeline = (value) => {
  const key = String(value || '').trim().toLowerCase().split(/\s+/).join('_');
  if (key === 'github_only') return 'github_only';
  if (key === 'resume_only') return 'resume_only';
  if (key === 'combined') return 'combined';
  if (key === 'deep_scan') return 'deep_scan';
  return null;
};

const startWorkflow = async (req, res) => {
  try {
    const pipeline = normalizePipeline(req.body.pipeline);
    if (!pipeline || !PIPELINES[pipeline]) {
      return res.status(400).json({ message: 'Invalid pipeline type.' });
    }

    const maxRetriesPerStep = Math.max(0, Math.min(5, Number(req.body.maxRetriesPerStep ?? 1)));
    const retryDelayMs = Math.max(100, Math.min(15000, Number(req.body.retryDelayMs ?? 600)));

    const input = {
      userId: req.user._id,
      pipeline,
      username: req.body.username || req.user.activeGithubUsername || req.user.githubUsername,
      resumeText: req.body.resumeText || '',
      fileName: req.body.fileName || 'workflow-resume.txt',
      fileSize: req.body.fileSize || 0,
      careerStack: req.user.careerStack || req.body.careerStack || 'Full Stack',
      experienceLevel: req.user.experienceLevel || req.body.experienceLevel || 'Student'
    };

    const workflow = await WorkflowRun.create({
      userId: req.user._id,
      pipeline,
      status: 'queued',
      input,
      steps: buildPipelineSteps(pipeline, maxRetriesPerStep),
      retryPolicy: {
        maxRetriesPerStep,
        retryDelayMs
      }
    });

    // Fire-and-forget execution
    runPipeline(workflow._id).catch((error) => {
      console.error(`Workflow ${workflow._id} execution error:`, error.message);
    });

    res.status(202).json({ message: 'Workflow queued.', workflowId: workflow._id, pipeline });
  } catch (error) {
    console.error('Start workflow error:', error.message);
    res.status(500).json({ message: 'Failed to start workflow.' });
  }
};

const getWorkflowById = async (req, res) => {
  try {
    const workflow = await WorkflowRun.findOne({
      _id: req.params.id,
      userId: req.user._id
    }).lean();

    if (!workflow) {
      return res.status(404).json({ message: 'Workflow not found.' });
    }

    res.json(workflow);
  } catch (error) {
    console.error('Get workflow error:', error.message);
    res.status(500).json({ message: 'Failed to fetch workflow.' });
  }
};

const listWorkflows = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 10));

    const filter = { userId: req.user._id };
    const pipeline = normalizePipeline(req.query.pipeline);
    if (pipeline) filter.pipeline = pipeline;

    const [workflows, total] = await Promise.all([
      WorkflowRun.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WorkflowRun.countDocuments(filter)
    ]);

    res.json({ workflows, total, page, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error('List workflows error:', error.message);
    res.status(500).json({ message: 'Failed to fetch workflows.' });
  }
};

module.exports = {
  startWorkflow,
  getWorkflowById,
  listWorkflows
};
