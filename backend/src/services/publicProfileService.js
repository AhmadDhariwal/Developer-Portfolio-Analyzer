const developerContext = require('./developerContextService');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PublicProfile = require('../models/publicProfile');
const PublicProfileView = require('../models/publicProfileView');
const PublicPortfolioVisit = require('../models/publicPortfolioVisit');
const User = require('../models/user');
const ResumeFile = require('../models/resumeFile');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const SkillGraph = require('../models/skillGraph');
const WeeklyReport = require('../models/weeklyReport');
const { isPortfolioEnabled } = require('./publicPortfolioVisibilityService');
const { portfolioCache } = require('./publicPortfolioCacheService');

const DEFAULT_MAX_SKILLS = 12;
const DEFAULT_MAX_PROJECTS = 12;
const DEFAULT_MAX_UPCOMING_PROJECTS = 12;
const DEFAULT_MAX_TESTIMONIALS = 12;
const DEFAULT_MAX_TECH = 10;
const DEFAULT_MAX_WORK_EXPERIENCES = 8;
const DEFAULT_MAX_COMPLETED_COURSES = 50;
const DEFAULT_WORK_EXPERIENCE_ICONS = [
  'mdi-rocket-launch',
  'mdi-lightbulb-on',
  'mdi-code-tags',
  'mdi-palette'
];

const clamp = (value, min = 0, max = 100) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return min;
  return Math.max(min, Math.min(max, numeric));
};

const trimText = (value = '', maxLen = 240) =>
  String(value || '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
const normalizeEmail = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 120);
const normalizePhoneNumber = (value = '') =>
  String(value || '')
    .trim()
    .slice(0, 40);
const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');

const buildBackendOrigin = () =>
  String(process.env.PUBLIC_API_ORIGIN || process.env.API_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');

const buildPublicResumeDownloadUrl = (slug = '') => {
  const safeSlug = String(slug || '').trim();
  if (!safeSlug) return '';
  return `${buildBackendOrigin()}/api/public-profiles/${encodeURIComponent(safeSlug)}/resume`;
};

const toSafeDownloadName = (value = 'resume.pdf') => {
  const sanitized = String(value || 'resume.pdf')
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!sanitized) return 'resume.pdf';
  return /\.pdf$/i.test(sanitized) ? sanitized : `${sanitized}.pdf`;
};

const resolveStoredResumePath = (value = '') => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const normalized = raw.replace(/\\/g, '/');
  const candidate = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.resolve(__dirname, '..', '..', normalized.replace(/^\/+/, ''));

  const relative = path.relative(uploadsDir, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return '';
  try {
    const real = fs.realpathSync(candidate);
    const confined = path.relative(fs.realpathSync(uploadsDir), real);
    if (confined.startsWith('..') || path.isAbsolute(confined)) return '';
    return fs.statSync(real).isFile() && path.extname(real).toLowerCase() === '.pdf' ? real : '';
  } catch {
    return '';
  }
};

const normalizeProjectStatus = (value = '', fallback = 'completed') => {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (['completed', 'in-progress', 'upcoming', 'planned'].includes(status)) {
    return status;
  }
  return fallback;
};

const normalizeUpcomingStatus = (value = '', fallback = 'planned') => {
  const status = String(value || '')
    .trim()
    .toLowerCase();
  if (status === 'in-progress') return 'in-progress';
  if (status === 'planned') return 'planned';
  if (status === 'upcoming') return 'planned';
  return fallback;
};

const normalizeExpectedDate = (value = '') => trimText(value, 48);

const normalizeCompletedCourses = (courses = [], { visibleOnly = false } = {}) => {
  if (!Array.isArray(courses)) return [];
  return courses
    .map((course, index) => {
      const completionDate = course?.completionDate ? new Date(course.completionDate) : null;
      return {
        ...(course?._id ? { _id: course._id } : {}),
        title: trimText(course?.title, 160),
        provider: trimText(course?.provider, 120),
        category: trimText(course?.category, 80),
        skills: normalizeTechList(course?.skills || []).slice(0, 20),
        completionDate:
          completionDate && Number.isFinite(completionDate.getTime()) ? completionDate : null,
        duration: trimText(course?.duration, 80),
        certificateUrl: normalizeUrl(course?.certificateUrl || ''),
        credentialId: trimText(course?.credentialId, 120),
        description: trimText(course?.description, 600),
        order: Number.isFinite(Number(course?.order)) ? Number(course.order) : index,
        isVisible: course?.isVisible !== false
      };
    })
    .filter((course) => course.title && (!visibleOnly || course.isVisible))
    .sort(
      (left, right) =>
        left.order - right.order ||
        Number(right.completionDate || 0) - Number(left.completionDate || 0)
    )
    .slice(0, DEFAULT_MAX_COMPLETED_COURSES);
};

// Persisted content revisions invalidate all workers on their next read.
// Retain the existing mutation hook without deleting analysis/history data.
const invalidatePublicProfileCacheForUser = async () => {};

const normalizeAssetUrl = (value = '') => {
  const raw = String(value || '').trim();
  if (/^\/uploads\/(avatars|portfolio-images)\/[a-z0-9._-]+$/i.test(raw))
    return buildBackendOrigin() + raw;
  return normalizeUrl(raw);
};
const resolveAvatarForResponse = (value = '') => normalizeAssetUrl(value);

const inferRoleLabel = (headline = '', jobTitle = '') => {
  const source = `${headline || ''} ${jobTitle || ''}`.toLowerCase();
  if (source.includes('design')) return 'Designer';
  if (source.includes('product')) return 'Product Engineer';
  if (source.includes('architect')) return 'Software Architect';
  if (source.includes('engineer') || source.includes('developer')) return 'Developer';
  return 'Developer';
};

const getDefaultSectionCopy = ({ user = {}, profile = {} } = {}) => {
  const roleLabel = inferRoleLabel(profile?.headline || '', user?.jobTitle || '');

  return {
    hero: {
      greetingLabel: 'Hello! I Am',
      roleLabel: `A ${roleLabel} who`,
      titleLineOne: 'Judges a book',
      titleLineTwo: 'by its',
      titleHighlight: 'cover',
      titleLineSuffix: '...',
      tagline: 'Because if the cover does not impress you what else can?'
    },
    skills: {
      headline: "I'm currently looking to join a",
      highlight: 'cross-functional',
      headlineSuffix: 'team',
      subheadline: "that values improving people's lives through accessible design"
    },
    contact: {
      heading: 'Contact',
      message:
        "I'm currently looking to join a cross-functional team that values improving people's lives through accessible design. Or have a project in mind? Let's connect.",
      email: normalizeEmail(user?.email || '')
    },
    upcoming: {
      heading: 'Upcoming Projects',
      subheading: 'Currently in development and planned next milestones.'
    },
    testimonials: {
      heading: 'Testimonials',
      subheading: 'What collaborators and clients say about working together.'
    },
    cta: {
      heading: "Let's Work Together",
      subtext: 'Open to impactful product, platform, and AI-focused opportunities.',
      primaryLabel: 'Contact Me',
      secondaryLabel: 'Download Resume',
      resumeUrl: ''
    },
    visibility: {
      projects: true,
      upcoming: true,
      testimonials: true,
      cta: true
    }
  };
};

const normalizeSectionCopy = (sections = {}, { user = {}, profile = {} } = {}) => {
  const defaults = getDefaultSectionCopy({ user, profile });
  const mergedHero = {
    ...defaults.hero,
    ...sections?.hero
  };
  const mergedSkills = {
    ...defaults.skills,
    ...sections?.skills
  };
  const mergedContact = {
    ...defaults.contact,
    ...sections?.contact
  };
  const mergedUpcoming = {
    ...defaults.upcoming,
    ...sections?.upcoming
  };
  const mergedTestimonials = {
    ...defaults.testimonials,
    ...sections?.testimonials
  };
  const mergedCta = {
    ...defaults.cta,
    ...sections?.cta
  };
  const mergedVisibility = {
    ...defaults.visibility,
    ...sections?.visibility
  };

  return {
    hero: {
      greetingLabel: trimText(mergedHero.greetingLabel, 48),
      roleLabel: trimText(mergedHero.roleLabel, 72),
      titleLineOne: trimText(mergedHero.titleLineOne, 96),
      titleLineTwo: trimText(mergedHero.titleLineTwo, 72),
      titleHighlight: trimText(mergedHero.titleHighlight, 48),
      titleLineSuffix: trimText(mergedHero.titleLineSuffix, 16) || '...',
      tagline: trimText(mergedHero.tagline, 180)
    },
    skills: {
      headline: trimText(mergedSkills.headline, 120),
      highlight: trimText(mergedSkills.highlight, 48),
      headlineSuffix: trimText(mergedSkills.headlineSuffix, 96),
      subheadline: trimText(mergedSkills.subheadline, 200)
    },
    contact: {
      heading: trimText(mergedContact.heading, 48) || 'Contact',
      message: trimText(mergedContact.message, 240),
      email: normalizeEmail(mergedContact.email || user?.email || '')
    },
    upcoming: {
      heading: trimText(mergedUpcoming.heading, 64) || 'Upcoming Projects',
      subheading: trimText(mergedUpcoming.subheading, 220)
    },
    testimonials: {
      heading: trimText(mergedTestimonials.heading, 64) || 'Testimonials',
      subheading: trimText(mergedTestimonials.subheading, 220)
    },
    cta: {
      heading: trimText(mergedCta.heading, 72) || "Let's Work Together",
      subtext: trimText(mergedCta.subtext, 240),
      primaryLabel: trimText(mergedCta.primaryLabel, 40) || 'Contact Me',
      secondaryLabel: trimText(mergedCta.secondaryLabel, 40) || 'Download Resume',
      resumeUrl: normalizeUrl(mergedCta.resumeUrl || '')
    },
    visibility: {
      projects: Boolean(mergedVisibility.projects ?? true),
      upcoming: Boolean(mergedVisibility.upcoming ?? true),
      testimonials: Boolean(mergedVisibility.testimonials ?? true),
      cta: Boolean(mergedVisibility.cta ?? true)
    }
  };
};

const normalizeMdiIcon = (value = '', fallback = 'mdi-rocket-launch') => {
  const raw = trimText(value, 64).toLowerCase();
  if (!raw) return fallback;
  if (raw.startsWith('mdi-')) return raw;
  return `mdi-${raw.replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '')}`;
};

const normalizeWorkExperiences = (workExperiences = []) => {
  if (Array.isArray(workExperiences) && workExperiences.length) {
    const normalized = [];

    workExperiences.forEach((experience, index) => {
      const title = trimText(experience?.title, 96);
      if (!title) return;

      normalized.push({
        title,
        description: trimText(experience?.description, 260),
        icon: normalizeMdiIcon(
          experience?.icon,
          DEFAULT_WORK_EXPERIENCE_ICONS[index % DEFAULT_WORK_EXPERIENCE_ICONS.length]
        ),
        ctaLabel: trimText(experience?.ctaLabel || 'Learn More', 24),
        ctaUrl: normalizeUrl(experience?.ctaUrl || '')
      });
    });

    if (normalized.length) {
      return normalized.slice(0, DEFAULT_MAX_WORK_EXPERIENCES);
    }
  }

  return [];
};

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-|-$)/g, '')
    .slice(0, 48);

const normalizeUrl = (value = '') => {
  const raw = trimText(value, 240);
  if (!raw) return '';

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw.replace(/^\/+/, '')}`;
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
};

const createValidationError = (message) => Object.assign(new Error(message), { statusCode: 400 });
const isPlainObject = (value) =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const hasUnsafeMarkup = (value) =>
  typeof value === 'string' && /[<>]|javascript\s*:|[\u0000-\u0008]/i.test(value);

const validateUrl = (value, field) => {
  if (value === undefined || value === null || value === '') return;
  if (
    typeof value !== 'string' ||
    !(field === 'imageUrl' || field === 'avatarUrl'
      ? normalizeAssetUrl(value)
      : normalizeUrl(value))
  )
    throw createValidationError(`Invalid ${field}.`);
};

const validatePublicProfileUpdatePayload = (payload) => {
  if (!isPlainObject(payload)) throw createValidationError('Invalid profile payload.');
  if (Buffer.byteLength(JSON.stringify(payload)) > 65536)
    throw createValidationError('Profile payload is too large.');
  [
    'skills',
    'projects',
    'upcomingProjects',
    'testimonials',
    'workExperiences',
    'completedCourses',
    'courses'
  ].forEach((field) => {
    if (
      payload[field] !== undefined &&
      (!Array.isArray(payload[field]) || payload[field].length > 50)
    )
      throw createValidationError(`Invalid ${field}.`);
  });
  ['sections', 'socialLinks'].forEach((field) => {
    if (payload[field] !== undefined && !isPlainObject(payload[field]))
      throw createValidationError(`Invalid ${field}.`);
  });
  if (payload.isPublic !== undefined && typeof payload.isPublic !== 'boolean')
    throw createValidationError('Invalid public visibility.');
  ['headline', 'summary', 'seoTitle', 'seoDescription'].forEach((field) => {
    if (payload[field] !== undefined && typeof payload[field] !== 'string')
      throw createValidationError(`Invalid ${field}.`);
  });
  if (
    payload.slug !== undefined &&
    (typeof payload.slug !== 'string' || (payload.slug.trim() && !slugify(payload.slug)))
  ) {
    throw createValidationError('Invalid slug.');
  }
  for (const [name, section] of Object.entries(payload.sections || {})) {
    if (!isPlainObject(section)) throw createValidationError('Invalid section.');
    if (name === 'visibility' && Object.values(section).some((value) => typeof value !== 'boolean'))
      throw createValidationError('Invalid section visibility.');
  }
  const hasUnsafeValue = (value) =>
    Array.isArray(value)
      ? value.some(hasUnsafeValue)
      : isPlainObject(value)
        ? Object.values(value).some(hasUnsafeValue)
        : hasUnsafeMarkup(value);
  if (hasUnsafeValue(payload)) throw createValidationError('Unsafe content is not allowed.');
  const validateCollection = (items, fields) =>
    (items || []).forEach((item) => {
      if (!isPlainObject(item)) throw createValidationError('Invalid collection item.');
      fields.forEach((field) => validateUrl(item[field], field));
    });
  validateCollection(payload.projects, ['url', 'repoUrl', 'imageUrl']);
  validateCollection(payload.upcomingProjects, ['url', 'repoUrl', 'imageUrl']);
  validateCollection(payload.testimonials, ['avatarUrl']);
  validateCollection(payload.workExperiences, ['ctaUrl']);
  validateCollection(payload.completedCourses || payload.courses, ['certificateUrl']);
  for (const course of payload.completedCourses || payload.courses || []) {
    if (course.isVisible !== undefined && typeof course.isVisible !== 'boolean')
      throw createValidationError('Invalid course visibility.');
  }
  Object.entries(payload.socialLinks || {}).forEach(([field, value]) => validateUrl(value, field));
  if (payload.sections?.cta !== undefined && !isPlainObject(payload.sections.cta))
    throw createValidationError('Invalid cta section.');
  validateUrl(payload.sections?.cta?.resumeUrl, 'resume URL');
};

const normalizeGithubLink = (value = '', fallbackUsername = '') => {
  const raw = trimText(value, 120);
  const fallback = trimText(fallbackUsername, 80).replace(/^@/, '');
  if (!raw) {
    return fallback ? `https://github.com/${fallback}` : '';
  }

  if (/^https?:\/\//i.test(raw)) {
    return normalizeUrl(raw);
  }

  const username = raw
    .replace(/^@/, '')
    .replace(/^github\.com\//i, '')
    .replace(/\/$/, '')
    .trim();

  return username ? `https://github.com/${username}` : '';
};

const normalizeSocialLinks = (socialLinks = {}, fallbackGithubUsername = '') => {
  return {
    website: normalizeUrl(socialLinks.website || ''),
    twitter: normalizeUrl(socialLinks.twitter || ''),
    linkedin: normalizeUrl(socialLinks.linkedin || ''),
    github: normalizeGithubLink(socialLinks.github || '', fallbackGithubUsername)
  };
};

const toSkillScore = (name, score) => ({
  name: trimText(name, 48),
  score: Math.round(clamp(score, 0, 100))
});

const normalizeSkills = (skills = []) => {
  if (!Array.isArray(skills)) return [];

  const deduped = new Map();

  skills.forEach((item) => {
    const skillName = trimText(item?.name || item, 48);
    if (!skillName) return;

    const key = skillName.toLowerCase();
    const normalized = toSkillScore(skillName, item?.score || 0);

    if (!deduped.has(key)) {
      deduped.set(key, normalized);
      return;
    }

    const existing = deduped.get(key);
    if (normalized.score > existing.score) {
      deduped.set(key, normalized);
    }
  });

  return Array.from(deduped.values()).slice(0, DEFAULT_MAX_SKILLS);
};

const normalizeTechList = (tech = []) => {
  if (!Array.isArray(tech)) return [];

  const unique = new Set();
  tech.forEach((item) => {
    const value = trimText(item, 32);
    if (!value) return;
    unique.add(value);
  });

  return Array.from(unique).slice(0, DEFAULT_MAX_TECH);
};

const normalizeProjects = (projects = []) => {
  if (!Array.isArray(projects)) return [];

  const normalized = [];

  projects.forEach((project) => {
    const title = trimText(project?.title, 96);
    if (!title) return;

    normalized.push({
      title,
      description: trimText(project?.description, 520),
      url: normalizeUrl(project?.url || ''),
      repoUrl: normalizeUrl(project?.repoUrl || ''),
      imageUrl: normalizeAssetUrl(project?.imageUrl || ''),
      tech: normalizeTechList(project?.tech || []),
      status: normalizeProjectStatus(project?.status, 'completed'),
      expectedDate: normalizeExpectedDate(project?.expectedDate || '')
    });
  });

  return normalized.slice(0, DEFAULT_MAX_PROJECTS);
};

const normalizeUpcomingProjects = (upcomingProjects = []) => {
  if (!Array.isArray(upcomingProjects)) return [];

  const normalized = [];

  upcomingProjects.forEach((project) => {
    const title = trimText(project?.title, 96);
    if (!title) return;

    normalized.push({
      title,
      description: trimText(project?.description, 520),
      expectedDate: normalizeExpectedDate(project?.expectedDate || ''),
      techStack: normalizeTechList(project?.techStack || project?.tech || []),
      status: normalizeUpcomingStatus(project?.status, 'planned'),
      url: normalizeUrl(project?.url || ''),
      repoUrl: normalizeUrl(project?.repoUrl || ''),
      imageUrl: normalizeAssetUrl(project?.imageUrl || '')
    });
  });

  return normalized.slice(0, DEFAULT_MAX_UPCOMING_PROJECTS);
};

const normalizeTestimonials = (testimonials = []) => {
  if (!Array.isArray(testimonials)) return [];

  const normalized = [];

  testimonials.forEach((testimonial) => {
    const quote = trimText(testimonial?.quote, 520);
    const name = trimText(testimonial?.name, 96);
    if (!quote || !name) return;

    normalized.push({
      quote,
      name,
      role: trimText(testimonial?.role, 96),
      avatarUrl: normalizeAssetUrl(testimonial?.avatarUrl || '')
    });
  });

  return normalized.slice(0, DEFAULT_MAX_TESTIMONIALS);
};

const ensureUniqueSlug = async (base, { excludeProfileId = null } = {}) => {
  const normalized = slugify(base) || `dev-${Date.now()}`;
  let slug = normalized;
  let suffix = 1;

  while (true) {
    const query = { slug };
    if (excludeProfileId) {
      query._id = { $ne: excludeProfileId };
    }

    const exists = await PublicProfile.exists(query);
    if (!exists) break;

    suffix += 1;
    if (suffix > 20)
      throw Object.assign(new Error('Unable to reserve a unique slug.'), { statusCode: 409 });
    const ending = '-' + (suffix < 10 ? suffix : crypto.randomBytes(4).toString('hex'));
    slug = normalized.slice(0, 48 - ending.length) + ending;
  }

  return slug;
};

const getSkillScores = async (userId) => {
  const graph = await SkillGraph.findOne({ userId }).sort({ updatedAt: -1 }).lean();
  if (graph?.nodes?.length) {
    const nodes = graph.nodes
      .filter((node) => node.kind === 'current')
      .sort((a, b) => (b.proficiency || 0) - (a.proficiency || 0))
      .slice(0, 10)
      .map((node) => toSkillScore(node.name, node.proficiency))
      .filter((node) => node.name);

    if (nodes.length) return nodes;
  }

  const analysis = await Analysis.findOne({ userId }).sort({ updatedAt: -1, _id: -1 }).lean();
  const resumeAnalysis = await developerContext.resolveResumeAnalysis(userId, undefined, {
    User,
    ResumeFile,
    ResumeAnalysis
  });
  let resumeSkills = [];
  if (resumeAnalysis?.skills) {
    const skillSource =
      resumeAnalysis.skills instanceof Map
        ? Array.from(resumeAnalysis.skills.values())
        : Object.values(resumeAnalysis.skills);
    resumeSkills = skillSource.flat();
  }

  let languageSkills = [];
  if (analysis?.languageDistribution) {
    const languageSource =
      analysis.languageDistribution instanceof Map
        ? Object.fromEntries(analysis.languageDistribution)
        : analysis.languageDistribution;
    languageSkills = Object.entries(languageSource);
  }

  const skillScores = [];
  resumeSkills.slice(0, 6).forEach((skill) => {
    skillScores.push(toSkillScore(skill, 70));
  });

  languageSkills.slice(0, 6).forEach(([name, score]) => {
    skillScores.push(toSkillScore(name, Number(score) || 60));
  });

  return normalizeSkills(skillScores).slice(0, 10);
};

const getOrCreatePublicProfile = async (userId) => {
  let profile = await PublicProfile.findOne({ userId });
  if (profile) return profile;

  const user = await User.findById(userId).lean();
  const slugSource = user?.name || user?.githubUsername || `dev-${userId}`;
  const slug = await ensureUniqueSlug(slugSource);

  const initialProfile = {
    userId,
    slug,
    isPublic: false,
    headline: trimText(user?.jobTitle, 120),
    summary: trimText(user?.bio, 520),
    sections: normalizeSectionCopy({}, { user }),
    socialLinks: normalizeSocialLinks(
      {
        website: user?.website || '',
        twitter: user?.twitter || '',
        linkedin: user?.linkedin || '',
        github: user?.githubUsername || ''
      },
      user?.githubUsername || ''
    )
  };
  try {
    return await PublicProfile.findOneAndUpdate(
      { userId },
      { $setOnInsert: initialProfile },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // Concurrent initializers contend on the unique slug, then reuse the winner.
    if (error.code === 11000) {
      profile = await PublicProfile.findOne({ userId });
      if (profile) return profile;
    }
    throw error;
  }
};

const calculateProfileStrength = ({
  profile,
  user,
  skills,
  projects,
  workExperiences,
  sections,
  courses = []
}) => {
  const visibleCourses = Array.isArray(courses)
    ? courses.filter(
        (course) => course?.isVisible !== false && Boolean(trimText(course?.title || '', 160))
      )
    : [];
  const checks = [
    Boolean(trimText(profile?.headline || user?.jobTitle || '', 120)),
    Boolean(trimText(profile?.summary || user?.bio || '', 520)),
    (skills?.length || 0) >= 3,
    (projects?.length || 0) >= 1,
    (workExperiences?.length || 0) >= 1,
    visibleCourses.length >= 1,
    Boolean(trimText(profile?.seoTitle || '', 120)),
    Boolean(trimText(profile?.seoDescription || '', 180)),
    Boolean(trimText(profile?.socialLinks?.linkedin || user?.linkedin || '', 240)),
    Boolean(trimText(profile?.socialLinks?.github || user?.githubUsername || '', 120)),
    Boolean(normalizeEmail(sections?.contact?.email || user?.email || ''))
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
};

async function buildPublicProfilePayload(profile, user, req = null, { publicOnly = false } = {}) {
  const [skillScores, latestReport, defaultResume] = await Promise.all([
    profile.skills?.length ? [] : getSkillScores(profile.userId),
    publicOnly
      ? null
      : WeeklyReport.findOne({ userId: profile.userId }).sort({ weekEndDate: -1 }).lean(),
    user?.defaultResumeFileId
      ? ResumeFile.findOne({ _id: user.defaultResumeFileId, userId: profile.userId })
          .select('fileName fileUrl mimeType')
          .lean()
      : null
  ]);

  const normalizedSkills = profile.skills?.length ? normalizeSkills(profile.skills) : skillScores;
  const normalizedProjects = normalizeProjects(profile.projects || []);
  const normalizedUpcomingProjectsFromField = normalizeUpcomingProjects(
    profile.upcomingProjects || []
  );
  const normalizedUpcomingProjects = normalizedUpcomingProjectsFromField.length
    ? normalizedUpcomingProjectsFromField
    : normalizedProjects
        .filter((project) => ['in-progress', 'upcoming', 'planned'].includes(project.status || ''))
        .map((project) => ({
          title: project.title,
          description: project.description,
          expectedDate: project.expectedDate || '',
          techStack: project.tech || [],
          status: normalizeUpcomingStatus(project.status, 'planned'),
          url: project.url,
          repoUrl: project.repoUrl,
          imageUrl: project.imageUrl
        }));
  const normalizedTestimonials = normalizeTestimonials(profile.testimonials || []);
  const completedCourses = normalizeCompletedCourses(profile.completedCourses || [], {
    visibleOnly: publicOnly
  });
  const normalizedSocialLinks = normalizeSocialLinks(
    profile.socialLinks || {},
    developerContext.resolveGithubUsername(user) || ''
  );
  const sectionsSource = profile.sections?.toObject
    ? profile.sections.toObject()
    : profile.sections || {};
  const normalizedSections = normalizeSectionCopy(sectionsSource, { user, profile });
  const normalizedWorkExperiences = normalizeWorkExperiences(profile.workExperiences || []);
  const ownerEmail = normalizedSections.contact.email || normalizeEmail(user?.email || '');
  const ownerPhoneNumber = normalizePhoneNumber(user?.phoneNumber || '');
  const publicEmail = publicOnly ? '' : ownerEmail;
  const publicPhoneNumber = publicOnly ? '' : ownerPhoneNumber;
  const hasDefaultResumeFile = Boolean(
    defaultResume?.fileUrl && resolveStoredResumePath(defaultResume.fileUrl)
  );
  const defaultResumeUrl = hasDefaultResumeFile
    ? publicOnly
      ? buildPublicResumeDownloadUrl(profile.slug)
      : buildBackendOrigin() + '/api/public-profiles/me/resume'
    : '';
  const effectiveResumeUrl =
    publicOnly && !normalizedSections.visibility.cta
      ? ''
      : defaultResumeUrl || normalizedSections.cta.resumeUrl || '';
  const visibleProjects =
    publicOnly && !normalizedSections.visibility.projects ? [] : normalizedProjects;
  const visibleUpcoming =
    publicOnly && !normalizedSections.visibility.upcoming ? [] : normalizedUpcomingProjects;
  const visibleTestimonials =
    publicOnly && !normalizedSections.visibility.testimonials ? [] : normalizedTestimonials;

  return {
    ...(!publicOnly ? { id: profile._id } : {}),
    slug: profile.slug,
    isPublic: profile.isPublic,
    headline: trimText(profile.headline, 120),
    summary: trimText(profile.summary, 520),
    seoTitle: trimText(profile.seoTitle, 120),
    seoDescription: trimText(profile.seoDescription, 180),
    skills: normalizedSkills,
    projects: visibleProjects,
    upcomingProjects: visibleUpcoming,
    testimonials: visibleTestimonials,
    workExperiences: normalizedWorkExperiences,
    completedCourses,
    sections: {
      ...normalizedSections,
      ...(publicOnly && !normalizedSections.visibility.upcoming
        ? { upcoming: { heading: '', subheading: '' } }
        : {}),
      ...(publicOnly && !normalizedSections.visibility.testimonials
        ? { testimonials: { heading: '', subheading: '' } }
        : {}),
      contact: {
        ...normalizedSections.contact,
        email: publicEmail
      },
      cta: {
        ...normalizedSections.cta,
        ...(publicOnly && !normalizedSections.visibility.cta
          ? { heading: '', subtext: '', primaryLabel: '', secondaryLabel: '' }
          : {}),
        resumeUrl: effectiveResumeUrl
      }
    },
    socialLinks: normalizedSocialLinks,
    ...(!publicOnly ? { email: publicEmail, phoneNumber: publicPhoneNumber } : {}),
    defaultResumeUrl: publicOnly && !normalizedSections.visibility.cta ? '' : defaultResumeUrl,
    resumeUrl: effectiveResumeUrl,
    ...(!publicOnly
      ? {
          analytics: {
            totalViews: profile.totalViews || 0,
            uniqueViews: profile.uniqueViews || 0,
            lastViewedAt: profile.lastViewedAt || null
          }
        }
      : {}),
    profileStrengthScore: calculateProfileStrength({
      profile: {
        ...profile,
        socialLinks: normalizedSocialLinks
      },
      user: publicOnly ? { ...user, email: '' } : user,
      skills: normalizedSkills,
      projects: visibleProjects,
      workExperiences: normalizedWorkExperiences,
      sections: publicOnly
        ? { ...normalizedSections, contact: { ...normalizedSections.contact, email: '' } }
        : normalizedSections,
      courses: completedCourses
    }),
    momentum: latestReport
      ? {
          weekEndDate: latestReport.weekEndDate,
          score: latestReport.score,
          summary: latestReport.progressSummary,
          topAchievements: latestReport.topAchievements || [],
          biggestRiskArea: latestReport.biggestRiskArea || ''
        }
      : null,
    user: {
      name: trimText(user?.name, 120),
      jobTitle: trimText(user?.jobTitle, 120),
      location: trimText(user?.location, 120),
      avatar: resolveAvatarForResponse(user?.avatar || user?.avatarUrl || '', req),
      githubUsername: trimText(developerContext.resolveGithubUsername(user), 80),
      ...(!publicOnly ? { phoneNumber: publicPhoneNumber, email: publicEmail } : {})
    }
  };
}

const applyCoreProfileUpdates = async ({ profile, payload }) => {
  if (payload.isPublic !== undefined) {
    if (payload.isPublic && !(await isPortfolioEnabled())) {
      throw Object.assign(new Error('Public portfolio visibility is disabled.'), {
        statusCode: 403
      });
    }
    profile.isPublic = Boolean(payload.isPublic);
  }

  if (payload.headline !== undefined) {
    profile.headline = trimText(payload.headline, 120);
  }

  if (payload.summary !== undefined) {
    profile.summary = trimText(payload.summary, 520);
  }

  if (payload.seoTitle !== undefined) {
    profile.seoTitle = trimText(payload.seoTitle, 120);
  }

  if (payload.seoDescription !== undefined) {
    profile.seoDescription = trimText(payload.seoDescription, 180);
  }

  if (payload.slug !== undefined) {
    const requestedSlug = slugify(payload.slug);
    if (requestedSlug && requestedSlug !== profile.slug) {
      profile.slug = await ensureUniqueSlug(requestedSlug, { excludeProfileId: profile._id });
    }
  }
};

const applyCollectionProfileUpdates = ({ profile, payload }) => {
  if (payload.skills !== undefined) {
    profile.skills = normalizeSkills(payload.skills);
  }

  if (payload.projects !== undefined) {
    profile.projects = normalizeProjects(payload.projects);
  }

  if (payload.upcomingProjects !== undefined) {
    profile.upcomingProjects = normalizeUpcomingProjects(payload.upcomingProjects);
  }

  if (payload.testimonials !== undefined) {
    profile.testimonials = normalizeTestimonials(payload.testimonials);
  }

  if (payload.workExperiences !== undefined) {
    profile.workExperiences = normalizeWorkExperiences(payload.workExperiences);
  }

  if (payload.completedCourses !== undefined || payload.courses !== undefined) {
    profile.completedCourses = normalizeCompletedCourses(
      payload.completedCourses ?? payload.courses
    );
  }
};

const applySectionsUpdate = ({ profile, payload, user }) => {
  if (payload.sections === undefined) return;

  const existingSections = profile.sections?.toObject
    ? profile.sections.toObject()
    : profile.sections || {};
  const incomingSections =
    payload.sections && typeof payload.sections === 'object' ? payload.sections : {};
  const incomingHero =
    incomingSections.hero && typeof incomingSections.hero === 'object' ? incomingSections.hero : {};
  const incomingSkills =
    incomingSections.skills && typeof incomingSections.skills === 'object'
      ? incomingSections.skills
      : {};
  const incomingContact =
    incomingSections.contact && typeof incomingSections.contact === 'object'
      ? incomingSections.contact
      : {};
  const incomingUpcoming =
    incomingSections.upcoming && typeof incomingSections.upcoming === 'object'
      ? incomingSections.upcoming
      : {};
  const incomingTestimonials =
    incomingSections.testimonials && typeof incomingSections.testimonials === 'object'
      ? incomingSections.testimonials
      : {};
  const incomingCta =
    incomingSections.cta && typeof incomingSections.cta === 'object' ? incomingSections.cta : {};
  const incomingVisibility =
    incomingSections.visibility && typeof incomingSections.visibility === 'object'
      ? incomingSections.visibility
      : {};

  const mergedSections = {
    ...existingSections,
    ...incomingSections,
    hero: {
      ...existingSections.hero,
      ...incomingHero
    },
    skills: {
      ...existingSections.skills,
      ...incomingSkills
    },
    contact: {
      ...existingSections.contact,
      ...incomingContact
    },
    upcoming: {
      ...existingSections.upcoming,
      ...incomingUpcoming
    },
    testimonials: {
      ...existingSections.testimonials,
      ...incomingTestimonials
    },
    cta: {
      ...existingSections.cta,
      ...incomingCta
    },
    visibility: {
      ...existingSections.visibility,
      ...incomingVisibility
    }
  };

  profile.sections = normalizeSectionCopy(mergedSections, { user, profile });
  if (typeof profile.markModified === 'function') {
    profile.markModified('sections');
  }
};

const applySocialLinksUpdate = ({ profile, payload, user }) => {
  if (payload.socialLinks === undefined) return;

  const mergedSocialLinks = {
    ...profile.socialLinks,
    ...payload.socialLinks
  };
  profile.socialLinks = normalizeSocialLinks(mergedSocialLinks, user?.githubUsername || '');
  if (typeof profile.markModified === 'function') {
    profile.markModified('socialLinks');
  }
};

const updatePublicProfile = async (userId, payload = {}, req = null) => {
  validatePublicProfileUpdatePayload(payload);
  const profile = await getOrCreatePublicProfile(userId);
  const user = await User.findById(userId)
    .select(
      'name email phoneNumber defaultResumeFileId activeResumeFileId activeGithubUsername activeCareerStack activeExperienceLevel jobTitle location avatar avatarUrl githubUsername website twitter linkedin bio'
    )
    .lean();

  await applyCoreProfileUpdates({ profile, payload });
  applyCollectionProfileUpdates({ profile, payload });
  applySectionsUpdate({ profile, payload, user });
  applySocialLinksUpdate({ profile, payload, user });

  await profile.save();
  const savedProfile = await PublicProfile.findById(profile._id);
  return buildPublicProfilePayload(savedProfile || profile, user, req);
};

let activeAnalytics = 0;
const recordProfileView = async ({ profile, req }) => {
  if (
    !profile ||
    !req ||
    req.method !== 'GET' ||
    req.query?.preview !== undefined ||
    String(req.user?._id || '') === String(profile.userId) ||
    activeAnalytics >= 100
  )
    return;
  const agent = String(req.headers?.['user-agent'] || '').slice(0, 512);
  // Heuristic only: sophisticated bots may still look like ordinary visitors.
  if (!agent || /bot|crawler|spider|headless|preview|curl|wget/i.test(agent) || !req.ip) return;
  const secret = process.env.PUBLIC_PORTFOLIO_ANALYTICS_SECRET || process.env.JWT_SECRET;
  if (!secret) return;
  const viewedAt = new Date();
  const day = viewedAt.toISOString().slice(0, 10);
  const viewerHash = crypto
    .createHmac('sha256', secret)
    .update(profile._id + ':' + day + ':' + req.ip + ':' + agent)
    .digest('hex');
  activeAnalytics++;
  try {
    try {
      await PublicPortfolioVisit.create({
        profileId: profile._id,
        viewerHash,
        viewedAt,
        expiresAt: new Date(viewedAt.getTime() + 90 * 86400000)
      });
    } catch (error) {
      if (error.code === 11000) return;
      throw error;
    }
    await PublicProfile.updateOne(
      { _id: profile._id, isPublic: true },
      {
        $inc: { totalViews: 1, uniqueViews: 1 },
        $set: { lastViewedAt: viewedAt }
      },
      { timestamps: false }
    );
  } finally {
    activeAnalytics--;
  }
};

const getPublicProfileBySlug = async (slug, req) => {
  if (!(await isPortfolioEnabled())) return null;
  const key = String(slug || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || key.length > 60) return null;
  // Mongo authorization failure must never enter a stale cache fallback.
  const profile = await PublicProfile.findOne({ slug: key }).lean();
  if (!profile) return null;
  const preview = req?.query?.preview !== undefined;
  const owner = req?.user?._id && String(req.user._id) === String(profile.userId);
  if (preview && !owner) return null;
  if (!preview && profile.isPublic !== true) return null;
  const user = await User.findById(profile.userId)
    .select(
      'name email phoneNumber defaultResumeFileId activeResumeFileId activeGithubUsername activeCareerStack activeExperienceLevel jobTitle location avatar avatarUrl githubUsername website twitter linkedin bio isActive isPublic'
    )
    .lean();
  if (!user || user.isActive === false) return null;
  if (preview) return buildPublicProfilePayload(profile, user, req);
  const payload = await portfolioCache.get(profile, user, () =>
    buildPublicProfilePayload(profile, user, null, { publicOnly: true })
  );
  void recordProfileView({ profile, req }).catch(() =>
    console.warn('[PublicProfile] View tracking unavailable.')
  );
  return payload;
};

const getPublicProfileForOwner = async (userId, req = null) => {
  const profile = await getOrCreatePublicProfile(userId);
  const user = await User.findById(userId)
    .select(
      'name email phoneNumber defaultResumeFileId activeResumeFileId activeGithubUsername activeCareerStack activeExperienceLevel jobTitle location avatar avatarUrl githubUsername website twitter linkedin bio'
    )
    .lean();
  return buildPublicProfilePayload(profile, user, req);
};

const getPublicProfileResumeDownload = async (slug) => {
  if (!(await isPortfolioEnabled())) {
    return null;
  }

  const profile = await PublicProfile.findOne({ slug, isPublic: true })
    .select('userId slug sections.visibility.cta')
    .lean();
  if (!profile || profile.sections?.visibility?.cta === false) return null;

  return resolveProfileResumeDownload(profile);
};

const getOwnerResumeDownload = async (userId) => {
  const profile = await PublicProfile.findOne({ userId }).select('userId slug').lean();
  return profile ? resolveProfileResumeDownload(profile) : null;
};

const resolveProfileResumeDownload = async (profile) => {
  const user = await User.findById(profile.userId).select('defaultResumeFileId isActive').lean();
  if (user?.isActive === false) return null;
  if (!user?.defaultResumeFileId) return null;

  const resumeFile = await ResumeFile.findOne({
    _id: user.defaultResumeFileId,
    userId: profile.userId
  })
    .select('fileName fileUrl mimeType')
    .lean();
  if (!resumeFile?.fileUrl) return null;

  const mimeType = String(resumeFile.mimeType || 'application/pdf').toLowerCase();
  if (mimeType !== 'application/pdf') return null;

  const filePath = resolveStoredResumePath(resumeFile.fileUrl);
  if (!filePath) return null;

  return {
    filePath,
    fileName: toSafeDownloadName(resumeFile.fileName || `${profile.slug}-resume.pdf`),
    mimeType
  };
};

const getPublicProfileAnalytics = async (userId) => {
  const profile = await getOrCreatePublicProfile(userId);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - 6);
  const pipeline = [
    {
      $match: {
        profileId: profile._id,
        recordType: { $ne: 'unique_guard' },
        viewedAt: { $gte: since }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$viewedAt' },
          month: { $month: '$viewedAt' },
          day: { $dayOfMonth: '$viewedAt' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
  ];

  const [legacy, current] = await Promise.all([
    PublicProfileView.aggregate(pipeline),
    PublicPortfolioVisit.aggregate(pipeline)
  ]);
  const views = [...legacy, ...current];
  const map = new Map();
  views.forEach((entry) => {
    const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}-${String(entry._id.day).padStart(2, '0')}`;
    map.set(key, (map.get(key) || 0) + entry.count);
  });

  const last7Days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - i);
    const key = date.toISOString().slice(0, 10);
    last7Days.push({
      date: key,
      count: Number(map.get(key) || 0)
    });
  }

  const totalViews = Number(profile.totalViews || 0);
  const uniqueViews = Number(profile.uniqueViews || 0);

  return {
    totalViews,
    uniqueViews,
    uniqueViewRate: totalViews > 0 ? Math.round((uniqueViews / totalViews) * 100) : 0,
    lastViewedAt: profile.lastViewedAt || null,
    last7Days
  };
};

module.exports = {
  buildPublicProfilePayload,
  validatePublicProfileUpdatePayload,
  resolveStoredResumePath,
  recordProfileView,
  getOrCreatePublicProfile,
  updatePublicProfile,
  getPublicProfileBySlug,
  getPublicProfileForOwner,
  getPublicProfileAnalytics,
  getPublicProfileResumeDownload,
  getOwnerResumeDownload,
  invalidatePublicProfileCacheForUser
};
