const nodemailer = require('nodemailer');

let transporter = null;

const value = (key, fallback = '') => String(process.env[key] || fallback).trim();
const numberValue = (key, fallback) => Number.parseInt(process.env[key] || '', 10) || fallback;

const getEmailConfig = () => {
  const user = value('SMTP_USER', value('EMAIL_USER'));
  const pass = value('SMTP_PASS', value('EMAIL_PASS'));
  if (!user || !pass) {
    throw new Error('Email service is not configured.');
  }

  const port = numberValue('SMTP_PORT', 587);
  return {
    transport: {
      host: value('SMTP_HOST', 'smtp.gmail.com'),
      port,
      secure: value('SMTP_SECURE', port === 465 ? 'true' : 'false') === 'true',
      auth: { user, pass },
      connectionTimeout: numberValue('SMTP_CONNECTION_TIMEOUT_MS', 10000),
      socketTimeout: numberValue('SMTP_SOCKET_TIMEOUT_MS', 15000)
    },
    from: value('SMTP_FROM_EMAIL', user)
  };
};

const getTransporter = () => {
  if (transporter) return transporter;

  const { transport } = getEmailConfig();

  transporter = nodemailer.createTransport(transport);

  return transporter;
};

const sendConfiguredEmail = async ({ from, ...mailOptions }) => {
  const { from: defaultFrom } = getEmailConfig();
  return getTransporter().sendMail({ from: from || defaultFrom, ...mailOptions });
};

const sendEmailOTP = async (email, otp) => {
  const recipient = String(email || '').trim().toLowerCase();
  if (!recipient) {
    throw new Error('Recipient email is required.');
  }

  await sendConfiguredEmail({
    to: recipient,
    subject: 'DevInsight AI OTP Verification',
    text: `Your OTP is ${otp}. It expires in 5 minutes.`,
    html: `<p>Your OTP is <strong>${otp}</strong>.</p><p>It expires in <strong>5 minutes</strong>.</p>`
  });
};

const sendRecruiterInvitationEmail = async ({ to, inviteeName, organizationName, invitationLink }) => {
  const recipient = String(to || '').trim().toLowerCase();
  if (!recipient) throw new Error('Recipient email is required.');
  if (!String(invitationLink || '').trim()) throw new Error('Invitation link is required.');

  try {
    const { from } = getEmailConfig();
    const safeName = String(inviteeName || 'there').trim();
    const safeOrg  = String(organizationName || 'DevInsight').trim();

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Recruiter Invitation — DevInsight AI</title>
</head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 16px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

          <!-- Logo / Brand -->
          <tr>
            <td align="center" style="padding-bottom:28px;">
              <span style="font-size:22px;font-weight:800;color:#818cf8;letter-spacing:-0.5px;">DevInsight AI</span>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#1e293b;border:1px solid #334155;border-radius:16px;padding:36px 32px;">

              <!-- Greeting -->
              <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Recruiter Invitation</p>
              <h1 style="margin:0 0 16px;font-size:24px;font-weight:700;color:#f1f5f9;line-height:1.3;">
                You're invited to join<br/><span style="color:#818cf8;">${safeOrg}</span>
              </h1>
              <p style="margin:0 0 28px;font-size:15px;color:#94a3b8;line-height:1.6;">
                Hi ${safeName}, an admin at <strong style="color:#e2e8f0;">${safeOrg}</strong> has invited you to join as a <strong style="color:#e2e8f0;">Recruiter</strong> on DevInsight AI — the AI-powered developer intelligence platform.
              </p>

              <!-- CTA button -->
              <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td style="background:#6366f1;border-radius:10px;">
                    <a href="${invitationLink}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.01em;">
                      Accept Invitation →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Divider -->
              <hr style="border:none;border-top:1px solid #334155;margin:0 0 28px;" />

              <!-- What is DevInsight -->
              <p style="margin:0 0 12px;font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;">What is DevInsight AI?</p>
              <p style="margin:0 0 20px;font-size:14px;color:#94a3b8;line-height:1.65;">
                DevInsight AI analyzes developer GitHub activity, resumes, and career trajectories to produce verified skill scores and growth signals — giving recruiters a data-driven edge when sourcing talent.
              </p>

              <!-- Feature list -->
              <table cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:10px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;margin-bottom:8px;">
                    <p style="margin:0;font-size:14px;color:#e2e8f0;"><strong style="color:#818cf8;">🔍 Talent Pool</strong> — Browse verified developer profiles with real GitHub scores and skill breakdowns.</p>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:10px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;">
                    <p style="margin:0;font-size:14px;color:#e2e8f0;"><strong style="color:#818cf8;">🤖 AI Matching</strong> — Post a job and let AI rank the best-fit candidates by skills, experience, and growth potential.</p>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:10px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;">
                    <p style="margin:0;font-size:14px;color:#e2e8f0;"><strong style="color:#818cf8;">📊 Score Insights</strong> — See GitHub activity, resume quality, consistency streaks, and growth signals in one view.</p>
                  </td>
                </tr>
              </table>

              <!-- Expiry notice -->
              <p style="margin:0;font-size:13px;color:#64748b;text-align:center;">
                This invitation expires in <strong style="color:#94a3b8;">7 days</strong>. If you did not expect this email, you can safely ignore it.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top:24px;">
              <p style="margin:0;font-size:12px;color:#475569;">
                DevInsight AI · AI-powered developer career intelligence<br/>
                <a href="${invitationLink}" style="color:#6366f1;text-decoration:none;">View invitation</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const text = `Hi ${safeName},\n\nYou've been invited to join ${safeOrg} as a Recruiter on DevInsight AI.\n\nDevInsight AI is an AI-powered developer intelligence platform. As a recruiter you can:\n- Browse verified developer profiles with GitHub scores\n- Post jobs and run AI candidate matching\n- View skill breakdowns, growth signals, and consistency scores\n\nAccept your invitation here:\n${invitationLink}\n\nThis link expires in 7 days.\n\n— DevInsight AI Team`;

    await sendConfiguredEmail({
      from: `"DevInsight AI" <${from}>`,
      to: recipient,
      subject: `You're invited to join ${safeOrg} as a Recruiter — DevInsight AI`,
      text,
      html
    });

    return { sent: true, reason: null };
  } catch (error) {
    return { sent: false, reason: error.message || 'Failed to send recruiter invitation email.' };
  }
};

module.exports = { getEmailConfig, getTransporter, sendConfiguredEmail, sendEmailOTP, sendRecruiterInvitationEmail };
