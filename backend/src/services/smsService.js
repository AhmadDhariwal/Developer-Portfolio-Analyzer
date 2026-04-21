const twilio = require('twilio');

let client = null;

const getClient = () => {
  if (client) return client;

  const sid   = String(process.env.TWILIO_SID   || '').trim();
  const token = String(process.env.TWILIO_TOKEN || '').trim();
  if (!sid || !token) {
    throw new Error('Twilio credentials (TWILIO_SID / TWILIO_TOKEN) are not configured.');
  }

  client = twilio(sid, token);
  return client;
};

const sendSMSOTP = async (phone, otp) => {
  const to   = String(phone || '').trim();
  const from = String(process.env.TWILIO_PHONE_NUMBER || '').trim();

  if (!to || !from) {
    throw new Error('SMS service is not configured. Set TWILIO_PHONE_NUMBER in .env.');
  }

  // TWILIO_PHONE_NUMBER must be a Twilio-purchased number in E.164 format (e.g. +12015551234).
  // It cannot be a personal mobile number. Get your Twilio number from:
  // https://console.twilio.com/us1/develop/phone-numbers/manage/incoming
  const twilioClient = getClient();

  try {
    await twilioClient.messages.create({
      from,
      to,
      body: `Your DevInsight AI OTP is ${otp}. Expires in 5 minutes.`
    });
  } catch (err) {
    // Surface a clear message instead of the raw Twilio error
    const msg = String(err?.message || '');
    if (msg.includes('not a Twilio phone number') || msg.includes('country mismatch')) {
      throw new Error(
        'SMS sending failed: TWILIO_PHONE_NUMBER must be a Twilio-purchased number (e.g. +12015551234), not a personal mobile number. ' +
        'Get your Twilio number at https://console.twilio.com/us1/develop/phone-numbers/manage/incoming'
      );
    }
    if (msg.includes('unverified')) {
      throw new Error(
        'SMS sending failed: On a Twilio trial account the recipient number must be verified first at https://console.twilio.com/us1/develop/phone-numbers/manage/verified'
      );
    }
    throw new Error(`SMS sending failed: ${msg}`);
  }
};

module.exports = { sendSMSOTP };
