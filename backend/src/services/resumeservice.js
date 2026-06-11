const fs = require('fs');
const pdfParse = require('pdf-parse');
const crypto = require('node:crypto');
const aiService = require('./aiservice');
const ResumeAnalysisCache = require('../models/resumeAnalysisCache');
const { extractSkillsFromText, canonicalizeSkillName } = require('../utils/skilldetector');

const ANALYSIS_VERSION = 'resume-intel-v2';

const SECTION_ALIASES = {
  summary: ['summary', 'professional summary', 'profile', 'objective'],
  experience: ['experience', 'work experience', 'professional experience', 'employment history'],
  projects: ['projects', 'selected projects', 'personal projects'],
  skills: ['skills', 'technical skills', 'core skills', 'technologies'],
  education: ['education', 'academic background'],
  certifications: ['certifications', 'certificates', 'licenses'],
  achievements: ['achievements', 'awards', 'accomplishments'],
  publications: ['publications', 'research'],
  volunteerWork: ['volunteer', 'volunteering', 'community'],
  leadership: ['leadership', 'leadership experience'],
  openSource: ['open source', 'open-source', 'oss contributions']
};

const TECHNOLOGY_CATALOG = [
  { name: 'JavaScript', category: 'Programming Languages', aliases: ['javascript', 'js', 'ecmascript'] },
  { name: 'TypeScript', category: 'Programming Languages', aliases: ['typescript', 'ts'] },
  { name: 'Python', category: 'Programming Languages', aliases: ['python'] },
  { name: 'Java', category: 'Programming Languages', aliases: ['java'] },
  { name: 'C#', category: 'Programming Languages', aliases: ['c#', 'csharp'] },
  { name: 'C++', category: 'Programming Languages', aliases: ['c++', 'cpp'] },
  { name: 'Go', category: 'Programming Languages', aliases: ['golang', 'go'] },
  { name: 'Rust', category: 'Programming Languages', aliases: ['rust'] },
  { name: 'PHP', category: 'Programming Languages', aliases: ['php'] },
  { name: 'Ruby', category: 'Programming Languages', aliases: ['ruby'] },
  { name: 'Dart', category: 'Programming Languages', aliases: ['dart'] },
  { name: 'React', category: 'Frontend', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'Angular', category: 'Frontend', aliases: ['angular'] },
  { name: 'Vue', category: 'Frontend', aliases: ['vue', 'vue.js', 'vuejs'] },
  { name: 'Next.js', category: 'Frontend', aliases: ['next.js', 'nextjs'] },
  { name: 'HTML', category: 'Frontend', aliases: ['html', 'html5'] },
  { name: 'CSS', category: 'Frontend', aliases: ['css', 'css3'] },
  { name: 'Tailwind CSS', category: 'Frontend', aliases: ['tailwind', 'tailwind css'] },
  { name: 'Node.js', category: 'Backend', aliases: ['node.js', 'nodejs', 'node'] },
  { name: 'Express', category: 'Backend', aliases: ['express', 'express.js'] },
  { name: 'Django', category: 'Backend', aliases: ['django'] },
  { name: 'Flask', category: 'Backend', aliases: ['flask'] },
  { name: 'Spring Boot', category: 'Backend', aliases: ['spring boot'] },
  { name: 'REST APIs', category: 'Backend', aliases: ['rest api', 'rest apis', 'restful'] },
  { name: 'GraphQL', category: 'Backend', aliases: ['graphql'] },
  { name: 'MongoDB', category: 'Database', aliases: ['mongodb', 'mongo'] },
  { name: 'PostgreSQL', category: 'Database', aliases: ['postgresql', 'postgres'] },
  { name: 'MySQL', category: 'Database', aliases: ['mysql'] },
  { name: 'Redis', category: 'Database', aliases: ['redis'] },
  { name: 'SQL Server', category: 'Database', aliases: ['sql server', 'mssql'] },
  { name: 'AWS', category: 'Cloud', aliases: ['aws', 'amazon web services'] },
  { name: 'Azure', category: 'Cloud', aliases: ['azure', 'microsoft azure'] },
  { name: 'Google Cloud', category: 'Cloud', aliases: ['gcp', 'google cloud'] },
  { name: 'Firebase', category: 'Cloud', aliases: ['firebase'] },
  { name: 'Docker', category: 'DevOps', aliases: ['docker'] },
  { name: 'Kubernetes', category: 'DevOps', aliases: ['kubernetes', 'k8s'] },
  { name: 'CI/CD', category: 'DevOps', aliases: ['ci/cd', 'cicd', 'github actions', 'gitlab ci', 'jenkins'] },
  { name: 'Terraform', category: 'DevOps', aliases: ['terraform'] },
  { name: 'Jest', category: 'Testing', aliases: ['jest'] },
  { name: 'Cypress', category: 'Testing', aliases: ['cypress'] },
  { name: 'Playwright', category: 'Testing', aliases: ['playwright'] },
  { name: 'Selenium', category: 'Testing', aliases: ['selenium'] },
  { name: 'React Native', category: 'Mobile', aliases: ['react native'] },
  { name: 'Flutter', category: 'Mobile', aliases: ['flutter'] },
  { name: 'TensorFlow', category: 'AI/ML', aliases: ['tensorflow'] },
  { name: 'PyTorch', category: 'AI/ML', aliases: ['pytorch'] },
  { name: 'Scikit-learn', category: 'AI/ML', aliases: ['scikit-learn', 'sklearn'] },
  { name: 'Pandas', category: 'Data Engineering', aliases: ['pandas'] },
  { name: 'Spark', category: 'Data Engineering', aliases: ['spark', 'apache spark'] },
  { name: 'Kafka', category: 'Data Engineering', aliases: ['kafka', 'apache kafka'] },
  { name: 'Git', category: 'Tools', aliases: ['git'] },
  { name: 'Figma', category: 'Tools', aliases: ['figma'] },
  { name: 'Jira', category: 'Tools', aliases: ['jira'] },
  { name: 'OAuth', category: 'Security', aliases: ['oauth', 'oauth2'] },
  { name: 'JWT', category: 'Security', aliases: ['jwt', 'json web token'] }
];

const emptyTechnologyCategories = () => ({
  Frontend: [],
  Backend: [],
  Database: [],
  Cloud: [],
  DevOps: [],
  Testing: [],
  Mobile: [],
  'AI/ML': [],
  'Programming Languages': [],
  Tools: [],
  Security: [],
  'Data Engineering': []
});

/**
 * Robustly extract text from a PDF file.
 */
const extractTextFromPDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);

  try {
    const parsed = await pdfParse(dataBuffer, { max: 0 });
    const text = (parsed?.text || '').trim();
    if (text.length > 20) return text;
  } catch (primaryErr) {
    console.warn('pdf-parse failed, trying fallback:', primaryErr.message);
  }

  // Fallback: scan raw bytes for printable ASCII runs
  try {
    let raw = '';
    for (let i = 0; i < dataBuffer.length; i++) {
      const c = dataBuffer[i];
      if (c >= 32 && c <= 126) raw += String.fromCharCode(c);
      else if (c === 10 || c === 13) raw += ' ';
    }
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 20) return cleaned;
  } catch (fallbackErr) {
    console.warn('Fallback text extraction also failed:', fallbackErr.message);
  }

  throw new Error('Unable to extract text from this PDF.');
};

/** Clamp a value to 0-100 and ensure it's an integer */
const clamp = (val) => Math.min(100, Math.max(0, Math.round(Number(val) || 0)));

const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const uniqueStrings = (values = [], limit = 100) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};

const countTruthy = (values = []) => values.filter(Boolean).length;

const normalizeResumeText = (text = '') => String(text || '')
  .replace(/\r/g, '\n')
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const getSupportedEvidence = (text = '') => {
  const normalized = ` ${normalizeResumeText(text).toLowerCase()} `;
  return (candidate = '') => {
    const value = String(candidate || '').trim().toLowerCase();
    if (!value) return false;
    return normalized.includes(value)
      || normalized.includes(value.replace(/\./g, ''))
      || normalized.includes(value.replace(/\s+/g, '-'));
  };
};

const splitLines = (text = '') => normalizeResumeText(text)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const headerLookup = (() => {
  const lookup = new Map();
  Object.entries(SECTION_ALIASES).forEach(([section, aliases]) => {
    aliases.forEach((alias) => lookup.set(alias.toLowerCase(), section));
  });
  return lookup;
})();

const detectSections = (text = '') => {
  const sections = {};
  Object.keys(SECTION_ALIASES).forEach((key) => { sections[key] = []; });

  let current = 'summary';
  splitLines(text).forEach((line) => {
    const clean = line.toLowerCase().replace(/[:\-|]+$/g, '').trim();
    if (clean.length <= 42 && headerLookup.has(clean)) {
      current = headerLookup.get(clean);
      return;
    }
    if (sections[current]) sections[current].push(line);
  });

  const present = {};
  Object.keys(SECTION_ALIASES).forEach((key) => {
    present[key] = sections[key].length > 0 || SECTION_ALIASES[key].some((alias) => (
      new RegExp(`(^|\\n)\\s*${escapeRegex(alias)}\\s*[:\\n]`, 'i').test(text)
    ));
  });

  return { sections, present };
};

const extractPersonalInfo = (text = '', userFallback = {}) => {
  const lines = splitLines(text);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const phone = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]?.trim() || '';
  const urls = uniqueStrings(text.match(/https?:\/\/[^\s)]+|www\.[^\s)]+/gi) || [], 12);
  const linkedIn = urls.find((url) => /linkedin\.com/i.test(url)) || (text.match(/linkedin\.com\/[^\s)]+/i)?.[0] || '');
  const github = urls.find((url) => /github\.com/i.test(url)) || (text.match(/github\.com\/[^\s)]+/i)?.[0] || '');
  const portfolio = urls.find((url) => !/linkedin\.com|github\.com/i.test(url)) || userFallback.website || '';
  const location = text.match(/\b(?:remote|hybrid|onsite|[A-Z][a-z]+,\s*[A-Z]{2}|[A-Z][a-z]+,\s*[A-Z][a-z]+)\b/)?.[0] || userFallback.location || '';
  const name = lines.find((line) => {
    if (line.length > 70) return false;
    if (/@|https?:|www\.|github|linkedin|\d{3}/i.test(line)) return false;
    if (headerLookup.has(line.toLowerCase().replace(/[:\-|]+$/g, '').trim())) return false;
    return /^[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3}$/.test(line);
  }) || userFallback.name || '';

  return { name, email, phone, location, portfolio, linkedIn, github };
};

const detectTechnologies = (text = '') => {
  const categories = emptyTechnologyCategories();
  TECHNOLOGY_CATALOG.forEach((tech) => {
    const found = tech.aliases.some((alias) => (
      new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(alias)}(?=$|[^a-z0-9+#.])`, 'i').test(text)
    ));
    if (found && categories[tech.category]) categories[tech.category].push(tech.name);
  });

  const detectorSkills = extractSkillsFromText(text).map((skill) => canonicalizeSkillName(skill));
  detectorSkills.forEach((skill) => {
    const catalog = TECHNOLOGY_CATALOG.find((entry) => entry.name.toLowerCase() === String(skill).toLowerCase());
    const category = catalog?.category || 'Tools';
    if (categories[category]) categories[category].push(skill);
  });

  Object.keys(categories).forEach((category) => {
    categories[category] = uniqueStrings(categories[category], 30);
  });
  return categories;
};

const buildLegacySkills = (technologyCategories) => ({
  'Programming Languages': technologyCategories['Programming Languages'] || [],
  'Frameworks & Libraries': uniqueStrings([
    ...(technologyCategories.Frontend || []).filter((item) => !['HTML', 'CSS'].includes(item)),
    ...(technologyCategories.Backend || []).filter((item) => !/api/i.test(item)),
    ...(technologyCategories['AI/ML'] || [])
  ], 40),
  'Technologies & Tools': uniqueStrings([
    ...(technologyCategories.Frontend || []).filter((item) => ['HTML', 'CSS'].includes(item)),
    ...(technologyCategories.Backend || []).filter((item) => /api/i.test(item)),
    ...(technologyCategories.Database || []),
    ...(technologyCategories.Cloud || []),
    ...(technologyCategories.DevOps || []),
    ...(technologyCategories.Testing || []),
    ...(technologyCategories.Mobile || []),
    ...(technologyCategories.Tools || []),
    ...(technologyCategories.Security || []),
    ...(technologyCategories['Data Engineering'] || [])
  ], 60),
  'Soft Skills': uniqueStrings(
    ['leadership', 'communication', 'collaboration', 'mentoring', 'ownership', 'stakeholder']
      .filter((skill) => new RegExp(`\\b${skill}\\b`, 'i').test(JSON.stringify(technologyCategories))),
    20
  )
});

const extractExperienceYears = (text = '') => {
  const explicit = text.match(/(\d{1,2})\+?\s*(?:years|yrs)\s+(?:of\s+)?experience/i);
  if (explicit) return Math.min(40, Number(explicit[1]) || 0);

  const years = uniqueStrings(text.match(/\b(?:20\d{2}|19\d{2})\b/g) || [], 40)
    .map((year) => Number(year))
    .filter((year) => year >= 1980 && year <= new Date().getFullYear());
  if (years.length < 2) return 0;
  return Math.max(0, Math.min(40, Math.max(...years) - Math.min(...years)));
};

const getExperienceLevel = (years) => {
  if (years >= 5) return 'Senior';
  if (years >= 2) return 'Intermediate';
  return 'Junior';
};

const extractBullets = (lines = []) => lines
  .map((line) => line.replace(/^[\s\-*•]+/, '').trim())
  .filter((line) => line.length >= 20);

const hasMetric = (value = '') => /(\d+%|\$\d+|\b\d+x\b|\b\d+\+?\s*(users|clients|requests|projects|teams|engineers|hours|days|weeks|months|seconds|ms)\b)/i.test(value);
const hasActionVerb = (value = '') => /^(built|led|created|designed|developed|implemented|improved|optimized|reduced|increased|launched|managed|owned|delivered|automated|integrated|migrated|mentored)\b/i.test(value.trim());

const extractCertifications = (text = '', sectionLines = []) => uniqueStrings([
  ...sectionLines,
  ...(text.match(/\b(?:AWS|Azure|Google Cloud|GCP|Oracle|Microsoft|Cisco|CompTIA|Kubernetes|Scrum|PMP)[^\n,;]{0,80}(?:Certified|Certification|Associate|Professional|Expert|Practitioner)\b/gi) || [])
], 12);

const extractEducation = (sections) => extractBullets(sections.education || []).slice(0, 10);
const extractProjects = (sections) => extractBullets(sections.projects || []).slice(0, 12);
const extractExperience = (sections) => extractBullets(sections.experience || []).slice(0, 16);
const extractAchievements = (sections) => uniqueStrings([
  ...extractBullets(sections.achievements || []),
  ...extractBullets([...(sections.experience || []), ...(sections.projects || [])]).filter((line) => hasMetric(line))
], 10);

const buildWarnings = ({ personalInfo, present, projects, achievements, technologyCategories, experience, education }) => {
  const warnings = [];
  const add = (code, severity, message, evidence = '') => warnings.push({ code, severity, message, evidence });

  if (!personalInfo.email || !personalInfo.phone) add('missing_contact_details', 'high', 'Email or phone is missing from the resume header.');
  if (!personalInfo.github) add('missing_github', 'medium', 'GitHub link is missing, which weakens proof for technical roles.');
  if (!personalInfo.linkedIn) add('missing_linkedin', 'medium', 'LinkedIn profile is missing from contact details.');
  if (!personalInfo.portfolio) add('missing_portfolio', 'low', 'Portfolio or personal website is not visible.');
  if (!present.skills) add('missing_skills_section', 'high', 'A standard Skills section was not detected.');
  if (!present.projects) add('missing_projects_section', 'medium', 'Projects section was not detected.');
  if (!present.education && education.length === 0) add('missing_education', 'medium', 'Education details were not detected.');
  if (projects.some((project) => project.length < 55 || !hasActionVerb(project))) add('weak_project_descriptions', 'medium', 'Some project descriptions are short or do not clearly describe ownership.');
  if (achievements.length < 2) add('missing_metrics', 'high', 'Few quantified achievements or metrics were found.');
  if (experience.length && experience.filter(hasMetric).length === 0) add('low_impact_achievements', 'medium', 'Experience bullets describe work but do not show measurable outcomes.');

  const allTech = Object.values(technologyCategories).flat();
  const repeated = allTech.filter((skill, index) => allTech.findIndex((item) => item.toLowerCase() === skill.toLowerCase()) !== index);
  if (repeated.length) add('repeated_skills', 'low', 'Repeated skills were detected across sections.', uniqueStrings(repeated, 5).join(', '));
  if (allTech.length > 35 && achievements.length < 2) add('skill_stuffing', 'medium', 'The resume lists many technologies but has limited achievement evidence.');
  if (experience.length === 0 && present.experience) add('experience_gaps', 'low', 'Experience section exists but readable role bullets were limited.');
  if (education.some((line) => /\b(20\d{2}|19\d{2})\b/.test(line)) && education.length === 1) add('education_inconsistencies', 'low', 'Education details may need clearer degree, institution, and date formatting.');

  return warnings;
};

const scoreDeterministically = ({ text, personalInfo, present, projects, experience, achievements, certifications, technologyCategories, warnings }) => {
  const allTech = Object.values(technologyCategories).flat();
  const categoryCount = Object.values(technologyCategories).filter((values) => values.length).length;
  const bulletCount = extractBullets(splitLines(text)).length;
  const hasDates = /\b(?:20\d{2}|19\d{2}|present|current)\b/i.test(text);
  const metricCount = [...projects, ...experience, ...achievements].filter(hasMetric).length;
  const actionCount = [...projects, ...experience, ...achievements].filter(hasActionVerb).length;
  const criticalWarnings = warnings.filter((warning) => warning.severity === 'high').length;

  const atsScore = clamp(
    36
    + countTruthy([personalInfo.email, personalInfo.phone]) * 8
    + countTruthy([present.experience, present.education, present.skills, present.projects]) * 7
    + Math.min(allTech.length, 18)
    + (bulletCount >= 6 ? 8 : 0)
    - criticalWarnings * 7
  );
  const keywordDensity = clamp(28 + Math.min(allTech.length * 3, 45) + Math.min(categoryCount * 4, 24) + (certifications.length ? 5 : 0));
  const formatScore = clamp(35 + countTruthy(Object.values(present)) * 4 + (bulletCount >= 6 ? 14 : 0) + (hasDates ? 10 : 0) - warnings.length * 3);
  const contentQuality = clamp(30 + Math.min(metricCount * 10, 35) + Math.min(actionCount * 3, 18) + (achievements.length ? 10 : 0));
  const projectQuality = clamp(25 + Math.min(projects.length * 12, 30) + Math.min(projects.filter(hasMetric).length * 14, 28) + Math.min(projects.filter((project) => allTech.some((skill) => project.toLowerCase().includes(skill.toLowerCase()))).length * 5, 17));
  const experienceStrength = clamp(25 + Math.min(experience.length * 5, 25) + Math.min(experience.filter(hasMetric).length * 12, 30) + (extractExperienceYears(text) >= 2 ? 15 : 0));
  const skillsCoverage = clamp(20 + Math.min(allTech.length * 3, 48) + Math.min(categoryCount * 5, 30));
  const technicalDepth = clamp(20 + Math.min(categoryCount * 7, 42) + Math.min(projects.length * 4, 16) + Math.min(experience.length * 2, 18));
  const recruiterReadiness = clamp((atsScore * 0.24) + (contentQuality * 0.24) + (projectQuality * 0.18) + (experienceStrength * 0.18) + (skillsCoverage * 0.16) - warnings.length);
  const overallResumeScore = clamp((atsScore * 0.18) + (keywordDensity * 0.12) + (formatScore * 0.12) + (contentQuality * 0.16) + (projectQuality * 0.12) + (experienceStrength * 0.12) + (skillsCoverage * 0.10) + (technicalDepth * 0.08));

  return {
    atsScore,
    keywordCoverage: keywordDensity,
    keywordDensity,
    formattingScore: formatScore,
    formatScore,
    contentQuality,
    projectQuality,
    experienceStrength,
    skillsCoverage,
    technicalDepth,
    recruiterReadiness,
    overallResumeScore,
    explanations: {
      atsScore: `${atsScore}/100 based on contact completeness, standard sections, readable bullets, and high-severity parser warnings.`,
      keywordCoverage: `${keywordDensity}/100 from ${allTech.length} detected technologies across ${categoryCount} categories.`,
      formattingScore: `${formatScore}/100 based on section headers, dates, bullet readability, and warning count.`,
      contentQuality: `${contentQuality}/100 based on action verbs, quantified achievements, and specificity of impact.`,
      projectQuality: `${projectQuality}/100 from project count, technical evidence, and measurable results.`,
      experienceStrength: `${experienceStrength}/100 from role bullets, dates, ownership language, and measurable outcomes.`,
      skillsCoverage: `${skillsCoverage}/100 from breadth and diversity of detected technologies.`,
      technicalDepth: `${technicalDepth}/100 from technology category depth across projects, experience, and skills.`,
      recruiterReadiness: `${recruiterReadiness}/100 combining ATS readiness, impact evidence, project proof, and warnings.`,
      overallResumeScore: `${overallResumeScore}/100 weighted across ATS, content, projects, experience, skills, and technical depth.`
    }
  };
};

const buildSuggestions = ({ warnings, scores, projects, achievements }) => {
  const suggestions = [];
  const push = (title, description, color) => {
    if (!suggestions.some((item) => item.title === title)) {
      suggestions.push({ id: `suggestion-${suggestions.length + 1}`, title, description, color });
    }
  };

  warnings.slice(0, 5).forEach((warning) => {
    if (warning.code === 'missing_contact_details') push('Complete contact details', 'Add email and phone in the resume header so recruiters and ATS tools can reliably parse your profile.', 'red');
    if (warning.code === 'missing_metrics') push('Add measurable impact', 'Rewrite key bullets with numbers such as percentage gains, users served, latency reduced, or revenue influenced.', 'orange');
    if (warning.code === 'weak_project_descriptions') push('Strengthen project bullets', 'For each project, include the problem, your contribution, technologies used, and measurable outcome.', 'purple');
    if (warning.code === 'missing_github') push('Add GitHub proof', 'Include a GitHub URL near your contact details to make technical evidence easy for recruiters to verify.', 'blue');
    if (warning.code === 'missing_linkedin') push('Add LinkedIn profile', 'Add a clean LinkedIn URL so recruiters can cross-check your background quickly.', 'cyan');
  });

  if (scores.keywordCoverage < 65) push('Improve keyword coverage', 'Add role-relevant technologies and domain terms naturally inside projects and experience, not only in a skill list.', 'blue');
  if (scores.contentQuality < 70) push('Rewrite passive bullets', 'Start bullets with strong action verbs and end with concrete results to show ownership and impact.', 'purple');
  if (projects.length === 0) push('Add project evidence', 'Include two or three relevant projects with links, stack, responsibilities, and outcomes.', 'orange');
  if (achievements.length === 0) push('Surface achievements', 'Create an achievements subsection or convert responsibilities into measurable accomplishments.', 'orange');

  return suggestions.slice(0, 6);
};

const buildRecruiterPerspective = ({ personalInfo, scores, warnings, achievements, technologyCategories, aiInsights }) => {
  const allTech = Object.values(technologyCategories).flat();
  const highWarnings = warnings.filter((warning) => warning.severity === 'high').map((warning) => warning.message);
  return {
    strengths: uniqueStrings([
      ...(scores.atsScore >= 75 ? ['ATS-friendly structure'] : []),
      ...(scores.skillsCoverage >= 70 ? ['Broad technical skill coverage'] : []),
      ...(achievements.length ? ['Measurable impact evidence'] : []),
      ...(personalInfo.github ? ['Public code proof available'] : []),
      ...(aiInsights.strengths || [])
    ], 8),
    concerns: uniqueStrings([...highWarnings, ...(aiInsights.concerns || [])], 8),
    interviewRisks: uniqueStrings([
      ...(scores.technicalDepth < 60 ? ['May need deeper technical examples for listed skills'] : []),
      ...(scores.contentQuality < 60 ? ['May struggle to explain measurable business impact'] : []),
      ...(allTech.length > 25 && achievements.length < 2 ? ['Large skill list may invite verification questions'] : []),
      ...(aiInsights.interviewRisks || [])
    ], 8),
    hiringReadiness: scores.recruiterReadiness >= 75 ? 'Strong' : scores.recruiterReadiness >= 55 ? 'Moderate' : 'Needs improvement',
    resumeSummary: aiInsights.resumeSummary || `Resume shows ${allTech.slice(0, 5).join(', ') || 'technical'} experience with an overall deterministic score of ${scores.overallResumeScore}/100.`
  };
};

const buildResumeSignals = ({ normalized, scores, technologyCategories, warnings, recruiterPerspective, resumeHash, analysisVersion }) => ({
  resumeHash,
  analysisVersion,
  personalInfoCompleteness: countTruthy(Object.values(normalized.personalInfo || {})),
  skills: uniqueStrings(Object.values(technologyCategories).flat(), 80),
  technologyCategories,
  scores,
  warnings,
  recruiterPerspective,
  experienceYears: normalized.experienceYears,
  experienceLevel: normalized.experienceLevel,
  achievements: normalized.achievements,
  certifications: normalized.certifications,
  education: normalized.education,
  projects: normalized.projects,
  updatedAt: new Date().toISOString()
});

const getCompactAiInsights = async ({ normalized, scores, warnings, technologyCategories }) => {
  const fallback = {
    __fallback: true,
    atsInsights: [scores.explanations.atsScore],
    contentQualityInsights: [scores.explanations.contentQuality],
    improvementSuggestions: [],
    recruiterPerspective: {
      strengths: [],
      concerns: [],
      interviewRisks: [],
      hiringReadiness: scores.recruiterReadiness >= 75 ? 'Strong' : scores.recruiterReadiness >= 55 ? 'Moderate' : 'Needs improvement'
    },
    resumeSummary: ''
  };

  const compactPayload = {
    summary: {
      experienceYears: normalized.experienceYears,
      experienceLevel: normalized.experienceLevel,
      sectionPresence: normalized.sectionPresence
    },
    experienceSummary: normalized.experience.slice(0, 8),
    projects: normalized.projects.slice(0, 6),
    detectedSkills: uniqueStrings(Object.values(technologyCategories).flat(), 60),
    achievements: normalized.achievements.slice(0, 8),
    missingSections: Object.entries(normalized.sectionPresence || {}).filter(([, present]) => !present).map(([name]) => name),
    warnings: warnings.slice(0, 8),
    deterministicScores: scores
  };

  const prompt = `
You are a senior technical recruiter. Use only the structured resume facts below. Do not invent skills, employers, certifications, schools, dates, or experience.

Structured resume facts:
${JSON.stringify(compactPayload, null, 2)}

Return valid JSON only:
{
  "atsInsights": ["short insight"],
  "contentQualityInsights": ["short insight"],
  "improvementSuggestions": ["specific suggestion"],
  "recruiterPerspective": {
    "strengths": ["recruiter-visible strength"],
    "concerns": ["recruiter concern"],
    "interviewRisks": ["risk to validate in interview"],
    "hiringReadiness": "Strong | Moderate | Needs improvement"
  },
  "resumeSummary": "2 concise sentences based only on the structured facts"
}`.trim();

  const aiResult = await aiService.runAIAnalysis(prompt, fallback, 1);
  if (!aiResult || typeof aiResult !== 'object') return { ...fallback, aiUsed: false };
  const aiUsed = aiResult.__fallback !== true;

  const recruiter = aiResult.recruiterPerspective || {};
  return {
    atsInsights: uniqueStrings(Array.isArray(aiResult.atsInsights) ? aiResult.atsInsights : fallback.atsInsights, 5),
    contentQualityInsights: uniqueStrings(Array.isArray(aiResult.contentQualityInsights) ? aiResult.contentQualityInsights : fallback.contentQualityInsights, 5),
    improvementSuggestions: uniqueStrings(Array.isArray(aiResult.improvementSuggestions) ? aiResult.improvementSuggestions : [], 6),
    strengths: uniqueStrings(Array.isArray(recruiter.strengths) ? recruiter.strengths : [], 6),
    concerns: uniqueStrings(Array.isArray(recruiter.concerns) ? recruiter.concerns : [], 6),
    interviewRisks: uniqueStrings(Array.isArray(recruiter.interviewRisks) ? recruiter.interviewRisks : [], 6),
    hiringReadiness: ['Strong', 'Moderate', 'Needs improvement'].includes(recruiter.hiringReadiness) ? recruiter.hiringReadiness : fallback.recruiterPerspective.hiringReadiness,
    resumeSummary: String(aiResult.resumeSummary || '').trim().slice(0, 600),
    aiUsed
  };
};

const buildImprovementDelta = (current, previous) => {
  if (!previous) return { hasPrevious: false, summary: 'First analyzed version for this resume context.' };
  const previousSkills = uniqueStrings(Object.values(previous.technologyCategories || {}).flat());
  const currentSkills = uniqueStrings(Object.values(current.technologyCategories || {}).flat());
  const newSkillsAdded = currentSkills.filter((skill) => !previousSkills.some((prev) => prev.toLowerCase() === skill.toLowerCase()));
  const scoreChanges = {
    atsScore: current.atsScore - Number(previous.atsScore || 0),
    keywordDensity: current.keywordDensity - Number(previous.keywordDensity || 0),
    formatScore: current.formatScore - Number(previous.formatScore || 0),
    contentQuality: current.contentQuality - Number(previous.contentQuality || 0),
    overallResumeScore: current.qualityScores.overallResumeScore - Number(previous.qualityScores?.overallResumeScore || previous.atsScore || 0)
  };
  return {
    hasPrevious: true,
    previousAnalysisId: previous._id ? String(previous._id) : '',
    previousAnalyzedAt: previous.analyzedAt || previous.createdAt || null,
    currentAnalyzedAt: new Date().toISOString(),
    newSkillsAdded,
    scoreChanges,
    summary: newSkillsAdded.length
      ? `Added ${newSkillsAdded.slice(0, 4).join(', ')} since the previous analysis.`
      : 'No newly detected skills compared with the previous analysis.'
  };
};

const buildDeterministicAnalysis = async ({ text, fileName, fileSize, previousAnalysis, userFallback = {} }) => {
  const normalizedText = normalizeResumeText(text);
  const resumeHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
  const { sections, present } = detectSections(normalizedText);
  const personalInfo = extractPersonalInfo(normalizedText, userFallback);
  const technologyCategories = detectTechnologies(normalizedText);
  const projects = extractProjects(sections);
  const experience = extractExperience(sections);
  const achievements = extractAchievements(sections);
  const certifications = extractCertifications(normalizedText, sections.certifications || []);
  const education = extractEducation(sections);
  const publications = extractBullets(sections.publications || []).slice(0, 8);
  const volunteerWork = extractBullets(sections.volunteerWork || []).slice(0, 8);
  const leadership = extractBullets(sections.leadership || []).slice(0, 8);
  const openSourceContributions = extractBullets(sections.openSource || []).slice(0, 8);
  const experienceYears = extractExperienceYears(normalizedText);
  const normalized = {
    personalInfo,
    education,
    experience,
    projects,
    skills: buildLegacySkills(technologyCategories),
    certifications,
    achievements,
    publications,
    volunteerWork,
    leadership,
    openSourceContributions,
    sectionPresence: present,
    experienceYears,
    experienceLevel: getExperienceLevel(experienceYears)
  };

  const warnings = buildWarnings({ personalInfo, present, projects, achievements, technologyCategories, experience, education });
  const qualityScores = scoreDeterministically({ text: normalizedText, personalInfo, present, projects, experience, achievements, certifications, technologyCategories, warnings });
  const aiInsights = await getCompactAiInsights({ normalized, scores: qualityScores, warnings, technologyCategories });
  const recruiterPerspective = buildRecruiterPerspective({ personalInfo, scores: qualityScores, warnings, achievements, technologyCategories, aiInsights });
  const suggestions = [
    ...buildSuggestions({ warnings, scores: qualityScores, projects, achievements }),
    ...(aiInsights.improvementSuggestions || []).map((description, index) => ({
      id: `ai-suggestion-${index + 1}`,
      title: String(description).split(/[.!?]/)[0].slice(0, 54) || 'Recruiter polish',
      description,
      color: 'cyan'
    }))
  ].slice(0, 6).map((suggestion, index) => ({ ...suggestion, id: `suggestion-${index + 1}` }));

  const result = {
    skills: normalized.skills,
    experienceYears,
    experienceLevel: normalized.experienceLevel,
    certifications,
    keyAchievements: achievements,
    atsScore: qualityScores.atsScore,
    keywordDensity: qualityScores.keywordDensity,
    formatScore: qualityScores.formatScore,
    contentQuality: qualityScores.contentQuality,
    scoreBreakdown: {
      atsScore: qualityScores.explanations.atsScore,
      keywordDensity: qualityScores.explanations.keywordCoverage,
      formatScore: qualityScores.explanations.formattingScore,
      contentQuality: qualityScores.explanations.contentQuality
    },
    suggestions,
    fileName,
    fileSize,
    resumeHash,
    analysisVersion: ANALYSIS_VERSION,
    normalized,
    qualityScores,
    technologyCategories,
    consistencyWarnings: warnings,
    recruiterPerspective,
    aiInsights,
    cacheMetadata: {
      loadedFromCache: false,
      cacheHit: false,
      aiUsed: Boolean(aiInsights.aiUsed),
      analysisVersion: ANALYSIS_VERSION,
      resumeHash
    }
  };
  result.resumeSignals = buildResumeSignals({ normalized, scores: qualityScores, technologyCategories, warnings, recruiterPerspective, resumeHash, analysisVersion: ANALYSIS_VERSION });
  result.improvementDelta = buildImprovementDelta(result, previousAnalysis);
  result.previousAnalysisId = result.improvementDelta.previousAnalysisId || null;
  result.scoreChanges = result.improvementDelta.scoreChanges || {};
  result.newSkillsAdded = result.improvementDelta.newSkillsAdded || [];
  return result;
};

/**
 * Deterministic-first resume intelligence pipeline with optional persistent cache.
 */
const analyzeResume = async (text, fileName, fileSize, options = {}) => {
  const normalizedText = normalizeResumeText(text);
  const resumeHash = crypto.createHash('sha256').update(normalizedText).digest('hex');
  const userId = options.userId || null;
  const resumeFileId = options.resumeFileId || options.fileId || null;
  const forceRefresh = Boolean(options.forceRefresh);
  const analysisVersion = options.analysisVersion || ANALYSIS_VERSION;

  if (userId && resumeFileId && !forceRefresh) {
    const cached = await ResumeAnalysisCache.findOne({ userId, resumeFileId, resumeHash, analysisVersion }).lean();
    if (cached?.result) {
      return {
        ...cached.result,
        cacheMetadata: {
          ...(cached.result.cacheMetadata || {}),
          loadedFromCache: true,
          cacheHit: true,
          aiUsed: false,
          analyzedAt: cached.analyzedAt,
          analysisVersion,
          resumeHash
        }
      };
    }
  }

  const result = await buildDeterministicAnalysis({
    text: normalizedText,
    fileName,
    fileSize,
    previousAnalysis: options.previousAnalysis || null,
    userFallback: options.userFallback || {}
  });

  if (userId && resumeFileId) {
    await ResumeAnalysisCache.findOneAndUpdate(
      { userId, resumeFileId, resumeHash, analysisVersion },
      {
        $set: {
          userId,
          resumeFileId,
          resumeHash,
          analysisVersion,
          result,
          analyzedAt: new Date()
        },
        $setOnInsert: { createdAt: new Date() }
      },
      { upsert: true, new: true }
    );
  }

  return result;
};

module.exports = {
  extractTextFromPDF,
  analyzeResume,
  ANALYSIS_VERSION
};
