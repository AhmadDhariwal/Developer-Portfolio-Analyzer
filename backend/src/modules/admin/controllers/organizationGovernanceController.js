const service = require('../services/organizationGovernanceService');

const scope = (req) => ({
  actorId: req.user._id,
  organizationId: req.organizationId,
  sessionRevision: Number(req.user.sessionRevision || 0)
});

const handle = (work) => async (req, res) => {
  try {
    return res.json(await work(req));
  } catch (error) {
    const status = error.statusCode || error.status || 500;
    return res.status(status).json({
      message: status < 500 ? error.message : 'Organization governance is temporarily unavailable.',
      ...(error.restriction && { restriction: error.restriction })
    });
  }
};

module.exports = {
  getGovernance: handle((req) => service.getGovernance(scope(req))),
  updateGovernance: handle(async (req) => {
    const organization = await service.updateGovernance(scope(req), req.body);
    req.organizationGovernanceAuditRecorded = true;
    return service.configurationView(organization);
  }),
  getDirectory: handle((req) => service.getDirectory(scope(req))),
  getInvitations: handle((req) => service.getInvitations(scope(req), req.query.status)),
  getCapabilities: handle((req) => service.getCapabilities(scope(req))),
  scope
};
