const User = require('../../models/user');

const getRecruiterProfile = async ({ recruiterId, organizationId }) => {
  return User.findOne({ _id: recruiterId, organizationId, role: 'recruiter' })
    .select('name email phoneNumber countryCode githubUsername linkedin location bio jobTitle notifications recruiterPreferences')
    .lean();
};

const updateRecruiterProfile = async ({ recruiterId, organizationId, payload = {} }) => {
  return User.findOneAndUpdate(
    { _id: recruiterId, organizationId, role: 'recruiter' },
    {
      $set: {
        name: payload.name !== undefined ? String(payload.name || '').trim() : undefined,
        phoneNumber: payload.phoneNumber !== undefined ? String(payload.phoneNumber || '').trim() : undefined,
        countryCode: payload.countryCode !== undefined ? String(payload.countryCode || '').trim() : undefined,
        githubUsername: payload.githubUsername !== undefined ? String(payload.githubUsername || '').trim() : undefined,
        linkedin: payload.linkedin !== undefined ? String(payload.linkedin || '').trim() : undefined,
        location: payload.location !== undefined ? String(payload.location || '').trim() : undefined,
        bio: payload.bio !== undefined ? String(payload.bio || '').trim() : undefined,
        jobTitle: payload.jobTitle !== undefined ? String(payload.jobTitle || '').trim() : undefined,
        recruiterPreferences: payload.recruiterPreferences !== undefined ? {
          preferredStacks: Array.isArray(payload.recruiterPreferences?.preferredStacks) ? payload.recruiterPreferences.preferredStacks : [],
          preferredLocations: Array.isArray(payload.recruiterPreferences?.preferredLocations) ? payload.recruiterPreferences.preferredLocations : [],
          preferredJobTypes: Array.isArray(payload.recruiterPreferences?.preferredJobTypes) ? payload.recruiterPreferences.preferredJobTypes : [],
          noteTemplate: String(payload.recruiterPreferences?.noteTemplate || '').trim(),
          activityDigest: payload.recruiterPreferences?.activityDigest !== false
        } : undefined
      }
    },
    { new: true }
  )
    .select('name email phoneNumber countryCode githubUsername linkedin location bio jobTitle notifications recruiterPreferences')
    .lean();
};

module.exports = {
  getRecruiterProfile,
  updateRecruiterProfile
};
