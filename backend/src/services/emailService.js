const nodemailer = require('nodemailer');

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const user = String(process.env.EMAIL_USER || '').trim();
  const pass = String(process.env.EMAIL_PASS || '').trim();
  if (!user || !pass) {
    throw new Error('Email service is not configured.');
  }

  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });

  return transporter;
};

const sendEmailOTP = async (email, otp) => {
  const recipient = String(email || '').trim().toLowerCase();
  if (!recipient) {
    throw new Error('Recipient email is required.');
  }

  const tx = getTransporter();
  await tx.sendMail({
    from: String(process.env.EMAIL_USER || '').trim(),
    to: recipient,
    subject: 'DevInsight AI OTP Verification',
    text: `Your OTP is ${otp}. It expires in 5 minutes.`,
    html: `<p>Your OTP is <strong>${otp}</strong>.</p><p>It expires in <strong>5 minutes</strong>.</p>`
  });
};

const sendRecruiterInvitationEmail = async ({ to, inviteeName, organizationName, invitationLink }) => {
  const recipient = String(to || '').trim().toLowerCase();
  if (!recipient) {
    throw new Error('Recipient email is required.');
  }

  if (!String(invitationLink || '').trim()) {
    throw new Error('Invitation link is required.');
  }

  try {
    const tx = getTransporter();
    const safeName = String(inviteeName || 'there').trim();
    const safeOrg = String(organizationName || 'DevInsight').trim();

    await tx.sendMail({
      from: String(process.env.EMAIL_USER || '').trim(),
      to: recipient,
      subject: `You are invited as a recruiter at ${safeOrg}`,
      text: `Hello ${safeName},\n\nYou have been invited to join ${safeOrg} as a recruiter.\n\nAccept invitation: ${invitationLink}\n\nThis invitation expires in 7 days.`,
      html: `<p>Hello ${safeName},</p><p>You have been invited to join <strong>${safeOrg}</strong> as a recruiter.</p><p><a href="${invitationLink}">Accept recruiter invitation</a></p><p>This invitation expires in <strong>7 days</strong>.</p>`
    });

    return { sent: true, reason: null };
  } catch (error) {
    return { sent: false, reason: error.message || 'Failed to send recruiter invitation email.' };
  }
};

module.exports = { sendEmailOTP, sendRecruiterInvitationEmail };
