const nodemailer = require('nodemailer');
const sendgrid = require('@sendgrid/mail');

const FRONTEND_BASE_URL = String(process.env.FRONTEND_BASE_URL || 'http://localhost:4200').replace(/\/$/, '');
const APP_NAME = String(process.env.APP_NAME || 'DevInsight AI');
const APP_LOGO_URL = String(process.env.APP_LOGO_URL || '').trim();
const APP_PRIMARY_COLOR = String(process.env.APP_PRIMARY_COLOR || '#0f766e').trim();
const APP_ACCENT_COLOR = String(process.env.APP_ACCENT_COLOR || '#f59e0b').trim();

const getProvider = () => {
  if (process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL) {
    return 'sendgrid';
  }

  if (
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM_EMAIL
  ) {
    return 'smtp';
  }

  return null;
};

const getEmailProviderStatus = () => {
  const provider = getProvider();
  if (provider) {
    return {
      configured: true,
      provider,
      reason: null
    };
  }

  return {
    configured: false,
    provider: null,
    reason: 'No email provider configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL, or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM_EMAIL.'
  };
};

const toSafeText = (value) => String(value || '').replace(/[<>]/g, '').trim();

const buildInvitationPayload = ({
  to,
  token,
  organizationName,
  teamName,
  role,
  inviterName,
  organizationId,
  teamId,
  actorId
}) => ({
  to: String(to || '').trim().toLowerCase(),
  token: String(token || '').trim(),
  organizationName: toSafeText(organizationName),
  teamName: toSafeText(teamName),
  role: String(role || 'member').trim().toLowerCase(),
  inviterName: toSafeText(inviterName),
  organizationId: organizationId || null,
  teamId: teamId || null,
  actorId: actorId || null
});

const buildInviteEmailHtml = ({ organizationName, teamName, role, inviterName, invitationLink }) => {
  const teamLine = teamName
    ? `<div style="padding:10px 12px;border-radius:10px;background:#ffffff;border:1px solid #e2e8f0;"><strong style="color:#334155;">Team</strong><div style="margin-top:4px;color:#0f172a;">${teamName}</div></div>`
    : '';
  const inviterLine = inviterName
    ? `<div style="padding:10px 12px;border-radius:10px;background:#ffffff;border:1px solid #e2e8f0;"><strong style="color:#334155;">Invited by</strong><div style="margin-top:4px;color:#0f172a;">${inviterName}</div></div>`
    : '';
  const logoSection = APP_LOGO_URL
    ? `<img src="${APP_LOGO_URL}" alt="${APP_NAME} logo" style="height:42px;display:block;margin-bottom:14px;" />`
    : `<div style="font-size:14px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${APP_PRIMARY_COLOR};margin-bottom:14px;">${APP_NAME}</div>`;

  return `
  <div style="font-family:'Segoe UI',Tahoma,Arial,sans-serif;line-height:1.6;color:#0f172a;max-width:620px;margin:0 auto;padding:24px;background:linear-gradient(180deg,#f8fafc 0%,#eef2ff 100%);border:1px solid #dbeafe;border-radius:18px;">
    ${logoSection}
    <h2 style="margin:0 0 10px 0;color:#0f172a;">You are invited to join ${organizationName}</h2>
    <p style="margin:0 0 16px 0;color:#334155;">Your role is <strong style="color:${APP_PRIMARY_COLOR};text-transform:capitalize;">${role}</strong>. Click below to join instantly.</p>
    <div style="display:grid;gap:8px;margin-bottom:18px;">
      ${teamLine}
      ${inviterLine}
    </div>
    <p style="margin:20px 0 14px 0;">
      <a href="${invitationLink}" style="display:inline-block;padding:11px 18px;background:${APP_PRIMARY_COLOR};color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;">Accept Invitation</a>
    </p>
    <p style="font-size:13px;color:#475569;margin-bottom:6px;">If the button does not work, copy this URL into your browser:</p>
    <p style="font-size:13px;word-break:break-all;color:${APP_PRIMARY_COLOR};background:#ffffff;border:1px solid #dbeafe;padding:8px 10px;border-radius:8px;">${invitationLink}</p>
    <p style="font-size:12px;color:#64748b;margin-top:16px;">This invitation expires in 7 days. If you were not expecting this email, you can ignore it safely.</p>
    <p style="font-size:12px;color:${APP_ACCENT_COLOR};margin-top:8px;font-weight:600;">${APP_NAME} Team</p>
  </div>`;
};

const buildInviteEmailText = ({ organizationName, teamName, role, inviterName, invitationLink }) => {
  const lines = [
    `You are invited to join ${organizationName}.`,
    `Role: ${role}`,
    `From: ${APP_NAME}`
  ];

  if (teamName) lines.push(`Team: ${teamName}`);
  if (inviterName) lines.push(`Invited by: ${inviterName}`);

  lines.push('');
  lines.push(`Accept invitation: ${invitationLink}`);

  return lines.join('\n');
};

const sendWithSendGrid = async ({ to, subject, html, text }) => {
  sendgrid.setApiKey(process.env.SENDGRID_API_KEY);
  await sendgrid.send({
    to,
    from: process.env.SENDGRID_FROM_EMAIL,
    subject,
    html,
    text
  });
};

const sendWithSmtp = async ({ to, subject, html, text }) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number.parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_FROM_EMAIL,
    to,
    subject,
    html,
    text
  });
};

const sendInvitationEmail = async ({
  to,
  token,
  organizationName,
  teamName,
  role,
  inviterName
}) => {
  const normalized = buildInvitationPayload({
    to,
    token,
    organizationName,
    teamName,
    role,
    inviterName
  });

  const provider = getProvider();
  const invitationLink = `${FRONTEND_BASE_URL}/invitations/accept/${normalized.token}`;

  if (!provider) {
    const status = getEmailProviderStatus();
    return {
      sent: false,
      provider: null,
      invitationLink,
      reason: status.reason
    };
  }

  const subject = `Invitation to join ${normalized.organizationName}`;
  const html = buildInviteEmailHtml({
    organizationName: normalized.organizationName,
    teamName: normalized.teamName,
    role: normalized.role,
    inviterName: normalized.inviterName,
    invitationLink
  });
  const text = buildInviteEmailText({
    organizationName: normalized.organizationName,
    teamName: normalized.teamName,
    role: normalized.role,
    inviterName: normalized.inviterName,
    invitationLink
  });

  try {
    if (provider === 'sendgrid') {
      await sendWithSendGrid({ to: normalized.to, subject, html, text });
    } else {
      await sendWithSmtp({ to: normalized.to, subject, html, text });
    }

    return {
      sent: true,
      provider,
      invitationLink
    };
  } catch (error) {
    return {
      sent: false,
      provider,
      invitationLink,
      reason: error.message || 'Email provider error.'
    };
  }
};

module.exports = {
  sendInvitationEmail,
  buildInvitationPayload,
  getEmailProviderStatus
};
