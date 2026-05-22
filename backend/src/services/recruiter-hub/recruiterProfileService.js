const User = require('../../models/user');

const getRecruiterProfile = async ({ recruiterId, organizationId }) => {
  return User.findOne({ _id: recruiterId, organizationId, role: 'recruiter' })
    .select('name email avatar phoneNumber countryCode githubUsername linkedin location bio jobTitle notifications recruiterPreferences')
    .lean();
};

const updateRecruiterProfile = async ({ recruiterId, organizationId, payload = {} }) => {
  const patch = {};
  if (payload.name !== undefined) patch.name = String(payload.name || '').trim();
  if (payload.avatar !== undefined) patch.avatar = String(payload.avatar || '').trim();
  if (payload.phoneNumber !== undefined) patch.phoneNumber = String(payload.phoneNumber || '').trim();
  if (payload.countryCode !== undefined) patch.countryCode = String(payload.countryCode || '').trim();
  if (payload.githubUsername !== undefined) patch.githubUsername = String(payload.githubUsername || '').trim();
  if (payload.linkedin !== undefined) patch.linkedin = String(payload.linkedin || '').trim();
  if (payload.location !== undefined) patch.location = String(payload.location || '').trim();
  if (payload.bio !== undefined) patch.bio = String(payload.bio || '').trim();
  if (payload.jobTitle !== undefined) patch.jobTitle = String(payload.jobTitle || '').trim();
  if (payload.recruiterPreferences !== undefined) {
    patch.recruiterPreferences = {
      preferredStacks: Array.isArray(payload.recruiterPreferences?.preferredStacks) ? payload.recruiterPreferences.preferredStacks : [],
      preferredLocations: Array.isArray(payload.recruiterPreferences?.preferredLocations) ? payload.recruiterPreferences.preferredLocations : [],
      preferredJobTypes: Array.isArray(payload.recruiterPreferences?.preferredJobTypes) ? payload.recruiterPreferences.preferredJobTypes : [],
      noteTemplate: String(payload.recruiterPreferences?.noteTemplate || '').trim(),
      activityDigest: payload.recruiterPreferences?.activityDigest !== false
    };
  }

  return User.findOneAndUpdate(
    { _id: recruiterId, organizationId, role: 'recruiter' },
    { $set: patch },
    { new: true }
  )
    .select('name email avatar phoneNumber countryCode githubUsername linkedin location bio jobTitle notifications recruiterPreferences')
    .lean();
};

module.exports = {
  getRecruiterProfile,
  updateRecruiterProfile
};
