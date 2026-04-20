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

module.exports = { sendEmailOTP };
