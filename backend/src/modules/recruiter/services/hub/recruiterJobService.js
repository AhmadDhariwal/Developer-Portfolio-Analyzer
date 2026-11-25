const Job = require("../../models/Job");
const { deleteJobWithPipeline } = require("../matching/jobLifecycleService");
const { requireObjectId } = require("../../utils/recruiterValidation");
const accessPolicy = require("../../utils/hub/recruiterJobAccess");

const EMPLOYMENT_TYPES = new Set([
  "full-time",
  "part-time",
  "contract",
  "internship",
]);
const JOB_STATUSES = new Set(["draft", "open", "closed"]);

const publicationFlag = (value) => {
  if (value !== undefined && typeof value !== "boolean") {
    throw createValidationError("Published must be a boolean.");
  }
  return value === true;
};

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
  published: publicationFlag(payload.published),
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

const listRecruiterJobWorkspace = async (scope) =>
  accessPolicy.withAccess(scope, async (ctx) => {
    const jobs = await Job.find({
      organizationId: ctx.organizationId,
      $or: [
        { recruiterId: ctx.recruiterId },
        { teamShared: true, teamId: { $in: [...ctx.grants.keys()] } },
      ],
    })
      .sort({ updatedAt: -1 })
      .session(ctx.session)
      .lean();
    const views = [];
    for (const job of jobs) views.push(await accessPolicy.jobView(job, ctx));
    return {
      jobs: views,
      teams: [...ctx.grants.values()].map(({ team, role }) => ({
        _id: String(team._id),
        name: team.name,
        role,
      })),
    };
  });
const listRecruiterJobs = async (scope) =>
  (await listRecruiterJobWorkspace(scope)).jobs;

// Private consumers (comparison/shortlists) deliberately retain owner-only lookup.
const getRecruiterJobDetails = async ({
  recruiterId,
  organizationId,
  jobId,
}) => {
  return Job.findOne({
    _id: requireObjectId(jobId, "jobId"),
    recruiterId,
    organizationId,
  }).lean();
};

const getAccessibleRecruiterJob = async (scope) =>
  accessPolicy.withAccess(scope, async (ctx) => {
    const job = await Job.findOne({
      _id: requireObjectId(scope.jobId, "jobId"),
      organizationId: ctx.organizationId,
    })
      .session(ctx.session)
      .lean();
    return job ? accessPolicy.jobView(job, ctx) : null;
  });

const validateCollaboration = (payload) => {
  if (
    payload.evaluationShared !== undefined &&
    typeof payload.evaluationShared !== "boolean"
  )
    throw createValidationError("evaluationShared must be a boolean.");
  if (
    payload.teamShared !== undefined &&
    typeof payload.teamShared !== "boolean"
  )
    throw createValidationError("teamShared must be a boolean.");
  if (
    payload.expectedVersion !== undefined &&
    (!Number.isSafeInteger(payload.expectedVersion) ||
      payload.expectedVersion < 0)
  )
    throw createValidationError(
      "expectedVersion must be a non-negative integer.",
    );
  if (
    ["recruiterId", "organizationId", "owner", "access"].some((key) =>
      Object.hasOwn(payload, key),
    )
  )
    throw createValidationError(
      "Ownership and permissions cannot be supplied.",
    );
};
const assertVersion = (job, payload, required = false) => {
  if (required && payload.expectedVersion === undefined)
    throw createValidationError(
      "Refresh the job and supply expectedVersion before changing sharing.",
    );
  if (
    payload.expectedVersion !== undefined &&
    payload.expectedVersion !== Number(job.__v || 0)
  )
    throw accessPolicy.denied(
      "Job changed. Refresh and review it before retrying.",
      409,
    );
};
const readJob = async (ctx, jobId) =>
  Job.findOne({
    _id: requireObjectId(jobId, "jobId"),
    organizationId: ctx.organizationId,
  })
    .session(ctx.session)
    .lean();
const writeJob = async (ctx, job, patch) => {
  const updated = await Job.findOneAndUpdate(
    {
      _id: job._id,
      organizationId: job.organizationId,
      recruiterId: job.recruiterId,
      __v: job.__v === undefined ? { $exists: false } : job.__v,
    },
    { $set: patch, $inc: { __v: 1 } },
    { session: ctx.session, returnDocument: "after" },
  ).lean();
  if (!updated)
    throw accessPolicy.denied("Job changed. Refresh and try again.", 409);
  return accessPolicy.jobView(updated, ctx);
};

const createRecruiterJob = async ({ payload = {}, ...scope }) => {
  validateCollaboration(payload);
  const jobPayload = toJobPayload(payload);
  validateJobPayload(jobPayload);
  return accessPolicy.withAccess(scope, async (ctx) => {
    const teamId = payload.teamId
      ? requireObjectId(payload.teamId, "teamId")
      : null;
    if (teamId) accessPolicy.sharingTeam(ctx, teamId);
    if (payload.teamShared === true && !teamId)
      throw createValidationError("Select an active team before sharing.");
    if (payload.evaluationShared === true && payload.teamShared !== true)
      throw createValidationError(
        "Share job metadata with an active team before sharing evaluations.",
      );
    const [job] = await Job.create(
      [
        {
          ...jobPayload,
          recruiterId: ctx.recruiterId,
          organizationId: ctx.organizationId,
          teamId,
          teamShared: payload.teamShared === true,
          evaluationShared: payload.evaluationShared === true,
          archivedAt: null,
        },
      ],
      { session: ctx.session },
    );
    return accessPolicy.jobView(job.toObject(), ctx);
  });
};

const updateRecruiterJob = async ({ jobId, payload = {}, ...scope }) => {
  validateCollaboration(payload);
  return accessPolicy.withAccess(scope, async (ctx) => {
    const job = await readJob(ctx, jobId);
    if (!job) return null;
    const permissions = accessPolicy.requirePermission(job, ctx, "edit");
    const changesSharing =
      payload.teamShared !== undefined ||
      payload.teamId !== undefined ||
      payload.evaluationShared !== undefined;
    if (changesSharing && !permissions.manageSharing)
      throw accessPolicy.denied("Only the job owner can change sharing.");
    assertVersion(
      job,
      payload,
      changesSharing &&
        (job.teamShared === true ||
          payload.teamShared !== undefined ||
          payload.evaluationShared !== undefined),
    );
    const teamId =
      payload.teamId !== undefined
        ? payload.teamId
          ? requireObjectId(payload.teamId, "teamId")
          : null
        : job.teamId;
    const teamShared =
      payload.teamShared !== undefined
        ? payload.teamShared
        : job.teamShared === true;
    if (
      changesSharing &&
      teamId &&
      (String(teamId) !== String(job.teamId) ||
        (teamShared &&
          (payload.teamShared === true || payload.evaluationShared === true)))
    )
      accessPolicy.sharingTeam(ctx, teamId);
    if (teamShared && !teamId)
      throw createValidationError("Select an active team before sharing.");
    // A different team never inherits the previous team's evaluation disclosure.
    const evaluationShared =
      payload.evaluationShared !== undefined
        ? payload.evaluationShared
        : teamShared &&
          String(teamId) === String(job.teamId) &&
          job.evaluationShared === true;
    if (evaluationShared && (!teamShared || !teamId))
      throw createValidationError(
        "Share job metadata with an active team before sharing evaluations.",
      );
    const normalized = toJobPayload(payload);
    validateJobPayload(toJobPayload({ ...job, ...payload }));
    const patch = {};
    for (const [key, value] of Object.entries(normalized)) {
      if (
        payload[key] !== undefined ||
        (key === "employmentType" && payload.jobType !== undefined)
      )
        patch[key] = value;
    }
    if (changesSharing)
      Object.assign(patch, { teamId, teamShared, evaluationShared });
    return writeJob(ctx, job, patch);
  });
};

const archiveRecruiterJob = async ({ jobId, ...scope }) =>
  accessPolicy.withAccess(scope, async (ctx) => {
    const job = await readJob(ctx, jobId);
    if (!job) return null;
    accessPolicy.requirePermission(job, ctx, "archive");
    return writeJob(ctx, job, { status: "closed", archivedAt: new Date() });
  });

const deleteRecruiterJob = async ({ jobId, ...scope }) =>
  accessPolicy.withAccess(scope, async (ctx) => {
    const job = await readJob(ctx, jobId);
    if (!job) return false;
    accessPolicy.requirePermission(job, ctx, "delete");
    return deleteJobWithPipeline(
      {
        _id: job._id,
        organizationId: job.organizationId,
        recruiterId: ctx.recruiterId,
      },
      ctx.session,
    );
  });

module.exports = {
  listRecruiterJobs,
  listRecruiterJobWorkspace,
  getRecruiterJobDetails,
  getAccessibleRecruiterJob,
  createRecruiterJob,
  updateRecruiterJob,
  archiveRecruiterJob,
  deleteRecruiterJob,
};
