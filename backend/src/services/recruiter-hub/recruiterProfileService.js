const User = require("../../models/user");

const sanitizeString = (value) => String(value || "").trim();
const sanitizeStringArray = (value, limit = 12) => {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => sanitizeString(item))
    .filter(Boolean)
    .slice(0, limit);
};

const mapRecruiterProfile = (profile, teams = []) => {
  if (!profile) return null;

  return {
    ...profile,
    organization: profile.organizationId?._id
      ? {
          _id: String(profile.organizationId._id),
          name: profile.organizationId.name || "",
        }
      : null,
    teams,
  };
};

const createValidationError = (message, errors = {}) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.errors = errors;
  return error;
};

const getRecruiterProfile = async ({ recruiterId, organizationId, teams = [] }) => {
  const profile = await User.findOne({
    _id: recruiterId,
    organizationId,
    role: "recruiter",
  })
    .select(
      "name email avatar phoneNumber countryCode githubUsername linkedin location bio jobTitle website notifications recruiterPreferences recruiterDetails organizationId",
    )
    .populate("organizationId", "name")
    .lean();

  return mapRecruiterProfile(profile, teams);
};

const updateRecruiterProfile = async ({
  recruiterId,
  organizationId,
  payload = {},
  teams = [],
}) => {
  const patch = {};
  const errors = {};
  if (payload.name !== undefined) patch.name = sanitizeString(payload.name);
  if (payload.avatar !== undefined) patch.avatar = sanitizeString(payload.avatar);
  if (payload.phoneNumber !== undefined)
    patch.phoneNumber = sanitizeString(payload.phoneNumber);
  if (payload.countryCode !== undefined)
    patch.countryCode = sanitizeString(payload.countryCode);
  if (payload.githubUsername !== undefined)
    patch.githubUsername = sanitizeString(payload.githubUsername);
  if (payload.linkedin !== undefined)
    patch.linkedin = sanitizeString(payload.linkedin);
  if (payload.location !== undefined)
    patch.location = sanitizeString(payload.location);
  if (payload.bio !== undefined) patch.bio = sanitizeString(payload.bio);
  if (payload.jobTitle !== undefined)
    patch.jobTitle = sanitizeString(payload.jobTitle);
  if (payload.website !== undefined)
    patch.website = sanitizeString(payload.website);
  if (payload.recruiterPreferences !== undefined) {
    patch.recruiterPreferences = {
      preferredStacks: sanitizeStringArray(
        payload.recruiterPreferences?.preferredStacks,
      ),
      preferredLocations: sanitizeStringArray(
        payload.recruiterPreferences?.preferredLocations,
      ),
      preferredJobTypes: sanitizeStringArray(
        payload.recruiterPreferences?.preferredJobTypes,
      ),
      noteTemplate: sanitizeString(payload.recruiterPreferences?.noteTemplate),
      activityDigest: payload.recruiterPreferences?.activityDigest !== false,
    };
  }
  if (payload.recruiterDetails !== undefined) {
    const yearsValue = Number(payload.recruiterDetails?.yearsOfExperience);
    patch.recruiterDetails = {
      education: sanitizeString(payload.recruiterDetails?.education),
      certifications: sanitizeStringArray(
        payload.recruiterDetails?.certifications,
      ),
      yearsOfExperience: Number.isFinite(yearsValue)
        ? Math.max(0, yearsValue)
        : 0,
      experienceSummary: sanitizeString(
        payload.recruiterDetails?.experienceSummary,
      ),
      specialties: sanitizeStringArray(payload.recruiterDetails?.specialties),
      toolsAndPlatforms: sanitizeStringArray(
        payload.recruiterDetails?.toolsAndPlatforms,
      ),
      languages: sanitizeStringArray(payload.recruiterDetails?.languages),
    };
  }

  if (payload.name !== undefined && !patch.name) {
    errors.name = "Name is required.";
  }
  if (payload.name !== undefined && patch.name.length > 120) {
    errors.name = "Name must be 120 characters or fewer.";
  }
  if (patch.jobTitle && patch.jobTitle.length > 120) {
    errors.jobTitle = "Job title must be 120 characters or fewer.";
  }
  if (patch.location && patch.location.length > 120) {
    errors.location = "Location must be 120 characters or fewer.";
  }
  if (patch.website && patch.website.length > 240) {
    errors.website = "Website must be 240 characters or fewer.";
  }
  if (patch.bio && patch.bio.length > 600) {
    errors.bio = "Bio must be 600 characters or fewer.";
  }
  if (
    patch.recruiterDetails?.education &&
    patch.recruiterDetails.education.length > 180
  ) {
    errors.education = "Education must be 180 characters or fewer.";
  }
  if (
    patch.recruiterDetails?.experienceSummary &&
    patch.recruiterDetails.experienceSummary.length > 1200
  ) {
    errors.experienceSummary =
      "Experience summary must be 1200 characters or fewer.";
  }
  if (
    patch.recruiterDetails &&
    (!Number.isFinite(patch.recruiterDetails.yearsOfExperience) ||
      patch.recruiterDetails.yearsOfExperience > 50)
  ) {
    errors.yearsOfExperience =
      "Years of experience must be between 0 and 50.";
  }
  if (Object.keys(errors).length > 0) {
    throw createValidationError(
      "Please correct the highlighted profile fields.",
      errors,
    );
  }

  const profile = await User.findOneAndUpdate(
    { _id: recruiterId, organizationId, role: "recruiter" },
    { $set: patch },
    { new: true },
  )
    .select(
      "name email avatar phoneNumber countryCode githubUsername linkedin location bio jobTitle website notifications recruiterPreferences recruiterDetails organizationId",
    )
    .populate("organizationId", "name")
    .lean();

  return mapRecruiterProfile(profile, teams);
};

module.exports = {
  getRecruiterProfile,
  updateRecruiterProfile,
};
