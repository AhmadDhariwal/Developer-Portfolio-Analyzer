const service = require('./services/jobApplicationService');
const { getRecruiterScope } = require('../recruiter/utils/hub/recruiterAccess');
const workflowBudget = require('../recruiter/utils/hub/applicationWorkflowBudget');
const handle = (work) => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    await work(req, res);
  } catch (error) {
    res.status(error.statusCode || error.status || 503).json({
      message:
        error.statusCode || error.status
          ? error.message
          : 'Applications are temporarily unavailable. Please retry.'
    });
  }
};
const developerOnly = (req, res, next) =>
  ['developer', 'user', 'guest'].includes(String(req.user?.role).toLowerCase())
    ? next()
    : res.status(403).json({ message: 'Developer access required.' });
module.exports = {
  developerOnly,
  discover: handle(async (_req, res) => res.json({ jobs: await service.discover() })),
  options: handle(async (req, res) => res.json(await service.options(req.user._id))),
  mine: handle(async (req, res) => res.json({ applications: await service.mine(req.user._id) })),
  submit: handle(async (req, res) => {
    const result = await service.submit(req.user, req.params.id, req.body);
    res.status(result.created ? 201 : 200).json(result);
  }),
  withdraw: handle(async (req, res) => {
    if (!req.body || Object.keys(req.body).some((key) => key !== 'expectedStatus'))
      return res.status(400).json({ message: 'Only expectedStatus may be supplied.' });
    res.json({
      application: await service.withdraw(
        req.user._id,
        req.params.applicationId,
        req.body.expectedStatus
      )
    });
  }),
  applicants: handle(async (req, res) =>
    res.json({
      applications: await service.applicants(await getRecruiterScope(req), req.params.id)
    })
  ),
  status: handle(async (req, res) => {
    const deadline = workflowBudget.deadline();
    if (
      !req.body ||
      Object.keys(req.body).some((key) => !['status', 'expectedStatus'].includes(key))
    )
      return res.status(400).json({ message: 'Only status and expectedStatus may be supplied.' });
    res.json({
      application: await service.changeStatus(
        { ...(await getRecruiterScope(req)), deadline },
        req.params.id,
        req.params.applicationId,
        req.body.status,
        req.body.expectedStatus
      )
    });
  }),
  resume: handle(async (req, res) => {
    const bytes = await service.submittedResume(
      await getRecruiterScope(req),
      req.params.id,
      req.params.applicationId
    );
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'attachment; filename="submitted-resume.pdf"');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.buffer));
  })
};
