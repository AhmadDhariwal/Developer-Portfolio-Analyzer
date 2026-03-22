const AuditLog = require('../models/auditLog');

const toDeliveryStatus = (result) => {
  if (result?.sent) return 'delivered';
  if (result?.reason === 'No email provider configured.') return 'provider_not_configured';
  return 'failed';
};

const logEmailDeliveryAudit = async ({
  actor,
  organizationId,
  teamId,
  invitationId,
  email,
  role,
  provider,
  result,
  attemptType,
  attemptNumber
}) => {
  try {
    await AuditLog.create({
      actor: actor || null,
      action: 'EMAIL_INVITATION_DELIVERY',
      method: 'POST',
      route: `/api/tenant/organizations/${organizationId}/invitations/email`,
      before: {
        organizationId,
        teamId: teamId || null,
        invitationId,
        email,
        role,
        attemptType,
        attemptNumber
      },
      after: {
        provider: provider || null,
        deliveryStatus: toDeliveryStatus(result),
        sent: Boolean(result?.sent),
        reason: result?.reason || null
      },
      statusCode: result?.sent ? 200 : 502
    });
  } catch (error) {
    console.error('Email delivery audit log failed:', error.message);
  }
};

module.exports = {
  logEmailDeliveryAudit
};
