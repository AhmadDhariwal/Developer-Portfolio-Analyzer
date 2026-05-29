const {
  getRecruiterScope,
} = require("../../utils/recruiter-hub/recruiterAccess");
const AuditLog = require("../../models/auditLog");
const {
  getRecruiterProfile,
  updateRecruiterProfile,
} = require("../../services/recruiter-hub/recruiterProfileService");

const getProfile = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const profile = await getRecruiterProfile(scope);
    if (!profile)
      return res.status(404).json({ message: "Recruiter profile not found." });
    return res.status(200).json({ profile });
  } catch (error) {
    console.error("Recruiter hub profile error:", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to load recruiter profile.",
      errors: error.errors || undefined,
    });
  }
};

const patchProfile = async (req, res) => {
  try {
    const scope = await getRecruiterScope(req);
    const before = await getRecruiterProfile(scope);
    const profile = await updateRecruiterProfile({
      ...scope,
      payload: req.body || {},
    });
    if (!profile)
      return res.status(404).json({ message: "Recruiter profile not found." });

    await AuditLog.create({
      actor: scope.recruiterId,
      organizationId: scope.organizationId,
      teamId: scope.teamIds[0] || null,
      action: "RECRUITER_PROFILE_UPDATED",
      method: "PATCH",
      route: req.originalUrl,
      before: before
        ? {
            name: before.name || "",
            githubUsername: before.githubUsername || "",
            location: before.location || "",
          }
        : null,
      after: {
        name: profile.name || "",
        githubUsername: profile.githubUsername || "",
        location: profile.location || "",
      },
      statusCode: 200,
      timestamp: new Date(),
    });

    return res.status(200).json({ profile });
  } catch (error) {
    console.error("Recruiter hub update profile error:", error.message);
    return res.status(error.statusCode || 500).json({
      message: error.message || "Failed to update recruiter profile.",
      errors: error.errors || undefined,
    });
  }
};

module.exports = {
  getProfile,
  patchProfile,
};
