const PublicProfile = require('../models/publicProfile');
const User = require('../models/user');
const { sendConfiguredEmail } = require('./emailService');
const { isPortfolioEnabled } = require('./publicPortfolioVisibilityService');

const fail = (message, statusCode) => Object.assign(new Error(message), { statusCode });
function validateContact(sender, body) {
  if (
    sender?.role !== 'recruiter' ||
    sender?.isActive === false ||
    (!sender.isVerified && !sender.emailVerified)
  )
    throw fail('Verified recruiter authentication required.', 403);
  const message = body?.message;
  if (
    typeof message !== 'string' ||
    message.trim().length < 20 ||
    message.length > 4000 ||
    /[<>\x00-\x08]/.test(message) ||
    body.website
  )
    throw fail('Invalid contact message.', 400);
  return message;
}

async function deliverContact(slug, sender, body) {
  const message = validateContact(sender, body);
  if (!(await isPortfolioEnabled())) throw fail('Public profile not found.', 404);
  const profile = await PublicProfile.findOne({ slug, isPublic: true }).select('userId').lean();
  const recipient =
    profile && (await User.findById(profile.userId).select('email isActive').lean());
  if (!recipient?.email || recipient.isActive === false)
    throw fail('Public profile not found.', 404);
  if (String(profile.userId) === String(sender._id))
    throw fail('Cannot contact your own portfolio.', 400);
  // Use the authenticated account address, never a caller-supplied reply-to.
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender.email || ''))
    throw fail('Valid account email required.', 400);
  try {
    const result = await sendConfiguredEmail({
      to: recipient.email,
      replyTo: sender.email,
      subject: 'DevInsight AI portfolio recruiter enquiry',
      text: `Recruiter: ${String(sender.name || '').slice(0, 120)}\nReply to: ${sender.email}\n\n${message.trim()}`
    });
    if (!result?.accepted?.length) throw new Error('Delivery not accepted');
  } catch {
    throw fail('Contact delivery is currently unavailable.', 503);
  }
  return { sent: true };
}
function validateContactRequest(req, res, next) {
  try {
    validateContact(req.user, req.body);
    return next();
  } catch (error) {
    return res.status(error.statusCode || 400).json({ message: error.message });
  }
}

module.exports = { deliverContact, validateContactRequest };
