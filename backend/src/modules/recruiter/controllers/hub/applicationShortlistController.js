const service = require('../../services/hub/applicationShortlistService');
const { getRecruiterScope } = require('../../utils/hub/recruiterAccess');
const workflowBudget = require('../../utils/hub/applicationWorkflowBudget');

const handle = (work) => async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const deadline = workflowBudget.deadline();
    await work(req, res, { ...(await getRecruiterScope(req)), deadline });
  } catch (error) {
    res.status(error.statusCode || 503).json({
      message: error.statusCode
        ? error.message
        : 'Application evaluation is temporarily unavailable. Please retry.'
    });
  }
};

module.exports = {
  link: handle(async (req, res, scope) => {
    const result = await service.linkApplication({
      ...scope,
      jobId: req.params.id,
      applicationId: req.params.applicationId,
      payload: req.body
    });
    res.status(result.created ? 201 : 200).json(result);
  }),
  list: handle(async (req, res, scope) =>
    res.json(await service.listApplicationShortlists({ ...scope, query: req.query }))
  ),
  update: handle(async (req, res, scope) =>
    res.json({
      shortlist: await service.updateApplicationShortlist({
        ...scope,
        shortlistId: req.params.id,
        payload: req.body
      })
    })
  ),
  details: handle(async (req, res, scope) =>
    res.json({
      application: await service.applicationDetails({
        ...scope,
        jobId: req.params.id,
        applicationId: req.params.applicationId
      })
    })
  )
};
