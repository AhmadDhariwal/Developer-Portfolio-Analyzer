const Job = require("../../models/Job");
const {
  assertRecruiterTeamAccess,
} = require("../../utils/recruiter-hub/recruiterAccess");

const EMPLOYMENT_TYPES = new Set([
  "full-time",
  "part-time",
  "contract",
  "internship",
]);
const JOB_STATUSES = new Set(["draft", "open", "closed"]);

const normalizeSkills = (value) => {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value.map((item) => String(item || "").trim()).filter(Boolean),
      ),
    ];
  }

  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const toJobPayload = (payload = {}) => ({
  title: String(payload.title || "").trim(),
  role: String(payload.role || payload.title || "").trim(),
  description: String(payload.description || "").trim(),
  stack: String(payload.stack || "Full Stack").trim(),
  requiredSkills: normalizeSkills(payload.requiredSkills),
  preferredSkills: normalizeSkills(payload.preferredSkills),
  minExperienceYears: Math.max(0, Number(payload.minExperienceYears || 0)),
  location: String(payload.location || "").trim(),
  employmentType: String(
    payload.jobType || payload.employmentType || "full-time",
  ).trim(),
  salaryRangeMin: Math.max(0, Number(payload.salaryRangeMin || 0)),
  salaryRangeMax: Math.max(0, Number(payload.salaryRangeMax || 0)),
  status: String(payload.status || "open").trim(),
});

const createValidationError = (message, errors = {}) => {
  const error = new Error(message);
  error.statusCode = 400;
  error.errors = errors;
  return error;
};

const validateJobPayload = (jobPayload = {}) => {
  const errors = {};

  if (!jobPayload.title) errors.title = "Job title is required.";
  if (!jobPayload.role) errors.role = "Role label is required.";
  if (!jobPayload.stack) errors.stack = "Stack is required.";
  if (!jobPayload.location) errors.location = "Location is required.";
  if (
    !jobPayload.employmentType ||
    !EMPLOYMENT_TYPES.has(jobPayload.employmentType)
  ) {
    errors.employmentType = "Employment type is invalid.";
  }
  if (!jobPayload.status || !JOB_STATUSES.has(jobPayload.status)) {
    errors.status = "Status is invalid.";
  }
  if (
    !Number.isFinite(jobPayload.minExperienceYears) ||
    jobPayload.minExperienceYears < 0
  ) {
    errors.minExperienceYears = "Minimum experience must be 0 or greater.";
  }
  if (
    !Array.isArray(jobPayload.requiredSkills) ||
    jobPayload.requiredSkills.length === 0
  ) {
    errors.requiredSkills = "At least one required skill is needed.";
  }
  if (jobPayload.description && jobPayload.description.length > 2000) {
    errors.description = "Description must be 2000 characters or fewer.";
  }

  if (Object.keys(errors).length > 0) {
    throw createValidationError(
      "Please correct the highlighted job fields.",
      errors,
    );
  }
};

const listRecruiterJobs = async ({ recruiterId, organizationId }) => {
  return Job.find({ recruiterId, organizationId })
    .sort({ updatedAt: -1 })
    .lean();
};

const getRecruiterJobDetails = async ({
  recruiterId,
  organizationId,
  jobId,
}) => {
  return Job.findOne({ _id: jobId, recruiterId, organizationId }).lean();
};

const createRecruiterJob = async ({
  recruiterId,
  organizationId,
  payload = {},
}) => {
  const teamId = String(payload.teamId || "").trim() || null;
  if (teamId) {
    await assertRecruiterTeamAccess({ recruiterId, organizationId, teamId });
  }

  const jobPayload = toJobPayload(payload);
  validateJobPayload(jobPayload);

  return Job.create({
    ...jobPayload,
    recruiterId,
    organizationId,
    teamId,
    archivedAt: null,
  });
};

const updateRecruiterJob = async ({
  recruiterId,
  organizationId,
  jobId,
  payload = {},
}) => {
  const job = await Job.findOne({ _id: jobId, recruiterId, organizationId });
  if (!job) return null;

  const teamId =
    payload.teamId !== undefined
      ? String(payload.teamId || "").trim() || null
      : job.teamId;
  if (teamId) {
    await assertRecruiterTeamAccess({ recruiterId, organizationId, teamId });
  }

  const patch = toJobPayload(payload);
  validateJobPayload(patch);
  Object.entries(patch).forEach(([key, value]) => {
    if (
      payload[key] !== undefined ||
      (key === "employmentType" &&
        (payload.jobType !== undefined || payload.employmentType !== undefined))
    ) {
      job[key] = value;
    }
  });
  job.teamId = teamId;
  await job.save();
  return job.toObject();
};

const archiveRecruiterJob = async ({ recruiterId, organizationId, jobId }) => {
  const job = await Job.findOne({ _id: jobId, recruiterId, organizationId });
  if (!job) return null;
  job.status = "closed";
  job.archivedAt = new Date();
  await job.save();
  return job.toObject();
};

const deleteRecruiterJob = async ({ recruiterId, organizationId, jobId }) => {
  const deleted = await Job.findOneAndDelete({
    _id: jobId,
    recruiterId,
    organizationId,
  });
  return Boolean(deleted);
};

module.exports = {
  listRecruiterJobs,
  getRecruiterJobDetails,
  createRecruiterJob,
  updateRecruiterJob,
  archiveRecruiterJob,
  deleteRecruiterJob,
};
