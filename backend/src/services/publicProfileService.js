const crypto = require('node:crypto');
const PublicProfile = require('../models/publicProfile');
const PublicProfileView = require('../models/publicProfileView');
const User = require('../models/user');
const Analysis = require('../models/analysis');
const ResumeAnalysis = require('../models/resumeAnalysis');
const SkillGraph = require('../models/skillGraph');
const WeeklyReport = require('../models/weeklyReport');

const DEFAULT_MAX_SKILLS = 12;
const DEFAULT_MAX_PROJECTS = 12;
const DEFAULT_MAX_UPCOMING_PROJECTS = 12;
const DEFAULT_MAX_TESTIMONIALS = 12;
const DEFAULT_MAX_TECH = 10;
const DEFAULT_MAX_WORK_EXPERIENCES = 8;
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

const trimText = (value = '', maxLen = 240) => String(value || '').trim().slice(0, maxLen);
const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase().slice(0, 120);

const normalizeProjectStatus = (value = '', fallback = 'completed') => {
  const status = String(value || '').trim().toLowerCase();
  if (['completed', 'in-progress', 'upcoming', 'planned'].includes(status)) {
    return status;
  }
  return fallback;
};

const normalizeUpcomingStatus = (value = '', fallback = 'planned') => {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'in-progress') return 'in-progress';
  if (status === 'planned') return 'planned';
  if (status === 'upcoming') return 'planned';
  return fallback;
};

const normalizeExpectedDate = (value = '') => trimText(value, 48);

const resolveAvatarForResponse = (avatarValue = '', req = null) => {
  const raw = String(avatarValue || '').trim();
  if (!raw) return '';
  if (/^data:/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;

  const host = req?.get?.('host');
  const protocol = req?.protocol;
  if (host && protocol) {
    if (raw.startsWith('/uploads/')) {
      return `${protocol}://${host}${raw}`;
    }

    if (raw.startsWith('uploads/')) {
      return `${protocol}://${host}/${raw}`;
    }
  }

  return raw;
};

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
      message: "I'm currently looking to join a cross-functional team that values improving people's lives through accessible design. Or have a project in mind? Let's connect.",
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

const buildFallbackWorkExperiences = ({ projects = [], skills = [] } = {}) => {
  if (projects.length) {
    return projects.slice(0, 4).map((project, index) => ({
      title: trimText(project.title, 96),
      description: trimText(project.description || `Professional work on ${project.title} with modern technologies.`, 260),
      icon: DEFAULT_WORK_EXPERIENCE_ICONS[index % DEFAULT_WORK_EXPERIENCE_ICONS.length],
      ctaLabel: 'Learn More',
      ctaUrl: normalizeUrl(project.url || project.repoUrl || '')
    }));
  }

  if (skills.length) {
    return skills.slice(0, 4).map((skill, index) => ({
      title: trimText(`${skill.name} Development`, 96),
      description: trimText(`Expert-level proficiency in ${skill.name} with ${skill.score}% mastery. Built production-ready applications.`, 260),
      icon: DEFAULT_WORK_EXPERIENCE_ICONS[index % DEFAULT_WORK_EXPERIENCE_ICONS.length],
      ctaLabel: 'Learn More',
      ctaUrl: ''
    }));
  }

  return [
    {
      title: 'Frontend Development',
      description: 'Creating responsive and interactive user interfaces with modern frameworks.',
      icon: 'mdi-rocket-launch',
      ctaLabel: 'Learn More',
      ctaUrl: ''
    },
    {
      title: 'Backend Engineering',
      description: 'Building scalable server-side applications and RESTful APIs.',
      icon: 'mdi-lightbulb-on',
      ctaLabel: 'Learn More',
      ctaUrl: ''
    },
    {
      title: 'Full Stack Projects',
      description: 'End-to-end development of web applications from concept to deployment.',
      icon: 'mdi-code-tags',
      ctaLabel: 'Learn More',
      ctaUrl: ''
    },
    {
      title: 'UI/UX Design',
      description: 'Designing intuitive and beautiful user experiences with attention to detail.',
      icon: 'mdi-palette',
      ctaLabel: 'Learn More',
      ctaUrl: ''
    }
  ];
};

const normalizeWorkExperiences = (workExperiences = [], { projects = [], skills = [] } = {}) => {
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

  return buildFallbackWorkExperiences({ projects, skills });
};

const slugify = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replaceAll(/[^a-z0-9]+/g, '-')
  .replaceAll(/(^-|-$)/g, '')
  .slice(0, 48);

const normalizeUrl = (value = '') => {
  const raw = trimText(value, 240);
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `https://${raw.replace(/^\/+/, '')}`;
};

const normalizeGithubLink = (value = '', fallbackUsername = '') => {
  const raw = trimText(value, 120);
  const fallback = trimText(fallbackUsername, 80).replace(/^@/, '');
  if (!raw) {
    return fallback ? `https://github.com/${fallback}` : '';
  }

  if (/^https?:\/\//i.test(raw)) {
    return raw;
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
      imageUrl: normalizeUrl(project?.imageUrl || ''),
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
      imageUrl: normalizeUrl(project?.imageUrl || '')
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
      avatarUrl: normalizeUrl(testimonial?.avatarUrl || '')
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
    slug = `${normalized}-${suffix}`.slice(0, 60);
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

  const analysis = await Analysis.findOne({ userId }).lean();
  const resumeAnalysis = await ResumeAnalysis.findOne({ userId }).sort({ analyzedAt: -1 }).lean();
  let resumeSkills = [];
  if (resumeAnalysis?.skills) {
    const skillSource = resumeAnalysis.skills instanceof Map
      ? Array.from(resumeAnalysis.skills.values())
      : Object.values(resumeAnalysis.skills);
    resumeSkills = skillSource.flat();
  }

  let languageSkills = [];
  if (analysis?.languageDistribution) {
    const languageSource = analysis.languageDistribution instanceof Map
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

  profile = await PublicProfile.create({
    userId,
    slug,
    isPublic: false,
    headline: trimText(user?.jobTitle, 120),
    summary: trimText(user?.bio, 520),
    sections: normalizeSectionCopy({}, { user }),
    socialLinks: normalizeSocialLinks({
      website: user?.website || '',
      twitter: user?.twitter || '',
      linkedin: user?.linkedin || '',
      github: user?.githubUsername || ''
    }, user?.githubUsername || '')
  });

  return profile;
};

const calculateProfileStrength = ({ profile, user, skills, projects, workExperiences, sections }) => {
  const checks = [
    Boolean(trimText(profile?.headline || user?.jobTitle || '', 120)),
    Boolean(trimText(profile?.summary || user?.bio || '', 520)),
    (skills?.length || 0) >= 3,
    (projects?.length || 0) >= 1,
    (workExperiences?.length || 0) >= 1,
    Boolean(trimText(profile?.seoTitle || '', 120)),
    Boolean(trimText(profile?.seoDescription || '', 180)),
    Boolean(trimText(profile?.socialLinks?.linkedin || user?.linkedin || '', 240)),
    Boolean(trimText(profile?.socialLinks?.github || user?.githubUsername || '', 120)),
    Boolean(normalizeEmail(sections?.contact?.email || user?.email || ''))
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
};

async function buildPublicProfilePayload(profile, user, req = null) {
  const [skillScores, latestReport] = await Promise.all([
    getSkillScores(profile.userId),
    WeeklyReport.findOne({ userId: profile.userId }).sort({ weekEndDate: -1 }).lean()
  ]);

  const normalizedSkills = profile.skills?.length ? normalizeSkills(profile.skills) : skillScores;
  const normalizedProjects = normalizeProjects(profile.projects || []);
  const normalizedUpcomingProjectsFromField = normalizeUpcomingProjects(profile.upcomingProjects || []);
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
  const normalizedSocialLinks = normalizeSocialLinks(profile.socialLinks || {}, user?.githubUsername || '');
  const sectionsSource = profile.sections?.toObject
    ? profile.sections.toObject()
    : (profile.sections || {});
  const normalizedSections = normalizeSectionCopy(sectionsSource, { user, profile });
  const normalizedWorkExperiences = normalizeWorkExperiences(profile.workExperiences || [], {
    projects: normalizedProjects,
    skills: normalizedSkills
  });

  return {
    id: profile._id,
    slug: profile.slug,
    isPublic: profile.isPublic,
    headline: trimText(profile.headline, 120),
    summary: trimText(profile.summary, 520),
    seoTitle: trimText(profile.seoTitle, 120),
    seoDescription: trimText(profile.seoDescription, 180),
    skills: normalizedSkills,
    projects: normalizedProjects,
    upcomingProjects: normalizedUpcomingProjects,
    testimonials: normalizedTestimonials,
    workExperiences: normalizedWorkExperiences,
    sections: normalizedSections,
    socialLinks: normalizedSocialLinks,
    analytics: {
      totalViews: profile.totalViews || 0,
      uniqueViews: profile.uniqueViews || 0,
      lastViewedAt: profile.lastViewedAt || null
    },
    profileStrengthScore: calculateProfileStrength({
      profile: {
        ...profile,
        socialLinks: normalizedSocialLinks
      },
      user,
      skills: normalizedSkills,
      projects: normalizedProjects,
      workExperiences: normalizedWorkExperiences,
      sections: normalizedSections
    }),
    momentum: latestReport ? {
      weekEndDate: latestReport.weekEndDate,
      score: latestReport.score,
      summary: latestReport.progressSummary,
      topAchievements: latestReport.topAchievements || [],
      biggestRiskArea: latestReport.biggestRiskArea || ''
    } : null,
    user: {
      name: user?.name || '',
      jobTitle: user?.jobTitle || '',
      location: user?.location || '',
      avatar: resolveAvatarForResponse(user?.avatar || '', req),
      githubUsername: user?.githubUsername || '',
      email: user?.email || ''
    }
  };
}

const applyCoreProfileUpdates = async ({ profile, payload }) => {
  if (payload.isPublic !== undefined) {
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
    profile.workExperiences = normalizeWorkExperiences(payload.workExperiences, {
      projects: normalizeProjects(profile.projects || []),
      skills: normalizeSkills(profile.skills || [])
    });
  }
};

const applySectionsUpdate = ({ profile, payload, user }) => {
  if (payload.sections === undefined) return;

  const existingSections = profile.sections?.toObject ? profile.sections.toObject() : (profile.sections || {});
  const incomingSections = payload.sections && typeof payload.sections === 'object' ? payload.sections : {};
  const incomingHero = incomingSections.hero && typeof incomingSections.hero === 'object' ? incomingSections.hero : {};
  const incomingSkills = incomingSections.skills && typeof incomingSections.skills === 'object' ? incomingSections.skills : {};
  const incomingContact = incomingSections.contact && typeof incomingSections.contact === 'object' ? incomingSections.contact : {};
  const incomingUpcoming = incomingSections.upcoming && typeof incomingSections.upcoming === 'object' ? incomingSections.upcoming : {};
  const incomingTestimonials = incomingSections.testimonials && typeof incomingSections.testimonials === 'object' ? incomingSections.testimonials : {};
  const incomingCta = incomingSections.cta && typeof incomingSections.cta === 'object' ? incomingSections.cta : {};
  const incomingVisibility = incomingSections.visibility && typeof incomingSections.visibility === 'object' ? incomingSections.visibility : {};

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

const updatePublicProfile = async (userId, payload = {}) => {
  const profile = await getOrCreatePublicProfile(userId);
  const user = await User.findById(userId)
    .select('name email jobTitle location avatar githubUsername website twitter linkedin bio')
    .lean();

  await applyCoreProfileUpdates({ profile, payload });
  applyCollectionProfileUpdates({ profile, payload });
  applySectionsUpdate({ profile, payload, user });
  applySocialLinksUpdate({ profile, payload, user });

  await profile.save();
  const savedProfile = await PublicProfile.findById(profile._id);
  return buildPublicProfilePayload(savedProfile || profile, user);
};

const recordProfileView = async ({ profile, req }) => {
  if (!profile) return;

  const ipAddress = String(req?.headers['x-forwarded-for'] || req?.ip || '').split(',')[0].trim();
  const userAgent = String(req?.headers['user-agent'] || '');
  const viewerHash = crypto.createHash('sha256')
    .update(`${profile._id}:${ipAddress}:${userAgent}`)
    .digest('hex');

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const existing = await PublicProfileView.findOne({
    profileId: profile._id,
    viewerHash,
    viewedAt: { $gte: since }
  }).lean();

  await PublicProfileView.create({
    profileId: profile._id,
    viewerHash,
    ipAddress,
    userAgent,
    viewedAt: new Date()
  });

  profile.totalViews = Number(profile.totalViews || 0) + 1;
  if (!existing) {
    profile.uniqueViews = Number(profile.uniqueViews || 0) + 1;
  }
  profile.lastViewedAt = new Date();
  await profile.save();
};

const getPublicProfileBySlug = async (slug, req) => {
  const profile = await PublicProfile.findOne({ slug, isPublic: true });
  if (!profile) return null;

  const user = await User.findById(profile.userId)
    .select('name email jobTitle location avatar githubUsername website twitter linkedin bio')
    .lean();
  await recordProfileView({ profile, req });

  return buildPublicProfilePayload(profile, user, req);
};

const getPublicProfileForOwner = async (userId) => {
  const profile = await getOrCreatePublicProfile(userId);
  const user = await User.findById(userId)
    .select('name email jobTitle location avatar githubUsername website twitter linkedin bio')
    .lean();
  return buildPublicProfilePayload(profile, user);
};

const getPublicProfileAnalytics = async (userId) => {
  const profile = await getOrCreatePublicProfile(userId);
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const views = await PublicProfileView.aggregate([
    { $match: { profileId: profile._id, viewedAt: { $gte: since } } },
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
  ]);

  const map = new Map(
    views.map((entry) => {
      const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}-${String(entry._id.day).padStart(2, '0')}`;
      return [key, entry.count];
    })
  );

  const last7Days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - i);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  getOrCreatePublicProfile,
  updatePublicProfile,
  getPublicProfileBySlug,
  getPublicProfileForOwner,
  getPublicProfileAnalytics
};
