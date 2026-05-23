const {
  getRecruiterScope,
} = require("../../utils/recruiter-hub/recruiterAccess");
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
    const profile = await updateRecruiterProfile({
      ...scope,
      payload: req.body || {},
    });
    if (!profile)
      return res.status(404).json({ message: "Recruiter profile not found." });
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
