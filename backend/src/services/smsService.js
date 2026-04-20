const twilio = require('twilio');

let client = null;

const getClient = () => {
  if (client) return client;

  const sid = String(process.env.TWILIO_SID || '').trim();
  const token = String(process.env.TWILIO_TOKEN || '').trim();
  if (!sid || !token) {
    throw new Error('Twilio is not configured.');
  }

  client = twilio(sid, token);
  return client;
};

const sendSMSOTP = async (phone, otp) => {
  const to = String(phone || '').trim();
  const from = String(process.env.TWILIO_PHONE_NUMBER || '').trim();
  if (!to || !from) {
    throw new Error('SMS service is not configured.');
  }

  const twilioClient = getClient();
  await twilioClient.messages.create({
    from,
    to,
    body: `Your DevInsight AI OTP is ${otp}. Expires in 5 minutes.`
  });
};

module.exports = { sendSMSOTP };
