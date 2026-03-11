const fs = require('fs');
const pdfParse = require('pdf-parse');

/**
 * Robustly extract text from a PDF file.
 * Tries pdf-parse first; if that fails, falls back to a
 * raw buffer scan that captures printable ASCII — good enough
 * for ATS keyword scoring even on protected/compressed PDFs.
 */
const extractTextFromPDF = async (filePath) => {
  const dataBuffer = fs.readFileSync(filePath);

  // Primary: pdf-parse (handles most standard PDFs)
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
    // Filter out very short tokens (PDF binary noise)
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    if (cleaned.length > 20) return cleaned;
  } catch (fallbackErr) {
    console.warn('Fallback text extraction also failed:', fallbackErr.message);
  }

  throw new Error('Unable to extract text from this PDF. Please ensure the file is not password-protected and is a valid PDF.');
};

const SKILL_CATEGORIES = {
  'Programming Languages': [
    'JavaScript', 'Python', 'Java', 'C++', 'C#', 'Ruby', 'PHP', 'TypeScript',
    'Go', 'Rust', 'Swift', 'Kotlin', 'Scala', 'Perl', 'R', 'MATLAB'
  ],
  'Frameworks & Libraries': [
    'React', 'Angular', 'Vue', 'Next.js', 'Svelte', 'Ember',
    'Node.js', 'Express', 'Django', 'Flask', 'Spring Boot', 'FastAPI',
    'GraphQL', 'REST API'
  ],
  'Technologies & Tools': [
    'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure', 'Firebase',
    'MongoDB', 'PostgreSQL', 'MySQL', 'Redis', 'Elasticsearch',
    'Git', 'CI/CD', 'Jenkins', 'GitHub Actions', 'GitLab CI',
    'HTML', 'CSS', 'SASS', 'Webpack', 'Babel'
  ],
  'Soft Skills': [
    'Leadership', 'Communication', 'Problem Solving', 'Team Player',
    'Project Management', 'Agile', 'Scrum', 'Mentoring',
    'Documentation', 'Testing', 'Debugging', 'System Design'
  ]
};

const ATS_KEYWORDS = [
  'experience', 'skills', 'education', 'projects', 'achievements',
  'responsibilities', 'results', 'metrics', 'accomplishments', 'proficient'
];

const extractSkillsByCategory = (text) => {
  const skills = {};
  const lowerText = text.toLowerCase();

  for (const [category, categorySkills] of Object.entries(SKILL_CATEGORIES)) {
    skills[category] = [];
    
    categorySkills.forEach(skill => {
      const regex = new RegExp(`\\b${skill.toLowerCase().replace(/\+/g, '\\+')}\\b`, 'i');
      if (regex.test(lowerText)) {
        skills[category].push(skill);
      }
    });
  }

  return skills;
};

const extractSkills = (text) => {
  const skillsByCategory = extractSkillsByCategory(text);
  const allSkills = [];
  
  for (const skills of Object.values(skillsByCategory)) {
    allSkills.push(...skills);
  }
  
  return allSkills;
};

const calculateATSScore = (text) => {
  const lowerText = text.toLowerCase();
  let score = 50;
  
  // Check for ATS keywords
  const keywordMatches = ATS_KEYWORDS.filter(keyword => 
    lowerText.includes(keyword)
  ).length;
  
  score += Math.min(keywordMatches * 5, 30);
  
  // Check for structured sections
  const sections = ['experience', 'education', 'skills', 'projects'];
  const sectionMatches = sections.filter(section =>
    lowerText.includes(section)
  ).length;
  
  score += sectionMatches * 2.5;
  
  // Check for formatting issues (basic heuristic)
  const hasSpecialChars = (text.match(/[^\w\s]/g) || []).length;
  if (hasSpecialChars > 100) score -= 5;
  
  return Math.min(Math.max(score, 0), 100);
};

const calculateKeywordDensity = (text) => {
  const words = text.toLowerCase().split(/\s+/);
  const totalWords = words.length;
  
  if (totalWords === 0) return 0;
  
  const skills = extractSkills(text);
  const skillMatches = skills.length;
  
  // Keyword density = (skills mentioned / total words) * 100
  const density = (skillMatches / (totalWords / 10)) * 10;
  
  return Math.min(Math.max(density, 0), 100);
};

const calculateFormatScore = (text) => {
  let score = 70;
  
  // Check for excessive special characters (poorly formatted)
  const specialCharCount = (text.match(/[^\w\s.,!?-]/g) || []).length;
  if (specialCharCount > 200) score -= 20;
  
  // Check for reasonable line length (not all on one line)
  const lines = text.split('\n');
  if (lines.length < 5) score -= 20; // Few line breaks, poorly organized
  
  // Check for consistent formatting
  const avgLineLength = text.length / lines.length;
  if (avgLineLength > 200) score -= 10;
  
  return Math.min(Math.max(score, 0), 100);
};

const calculateContentQuality = (text) => {
  let score = 50;
  
  // Length check
  const wordCount = text.split(/\s+/).length;
  if (wordCount > 300) score += 20;
  if (wordCount > 500) score += 10;
  
  // Check for metrics/numbers
  const numberMatches = (text.match(/\d+%|\d+\s*(thousand|million|billion|k|m)/gi) || []).length;
  score += Math.min(numberMatches * 5, 20);
  
  // Check for action verbs
  const actionVerbs = [
    'achieved', 'improved', 'optimized', 'designed', 'developed',
    'implemented', 'led', 'managed', 'architected', 'created'
  ];
  const actionVerbCount = actionVerbs.filter(verb =>
    new RegExp(`\\b${verb}\\b`, 'i').test(text)
  ).length;
  
  score += Math.min(actionVerbCount * 3, 15);
  
  return Math.min(Math.max(score, 0), 100);
};

const generateSuggestions = (text, skills, scores) => {
  const suggestions = [];
  
  // Check for missing cloud platforms
  const cloudPlatforms = ['AWS', 'GCP', 'Azure'];
  const hasCloudPlatform = cloudPlatforms.some(platform =>
    new RegExp(`\\b${platform}\\b`, 'i').test(text)
  );
  
  if (!hasCloudPlatform) {
    suggestions.push({
      id: '1',
      title: 'Add Cloud Platform Experience',
      description: 'Your profile has no notable cloud platform experience. Consider adding AWS, GCP or Azure skills.',
      color: 'blue'
    });
  }
  
  // Check for metrics
  const hasMetrics = /\d+%|\d+\s*x/.test(text);
  if (!hasMetrics) {
    suggestions.push({
      id: '2',
      title: 'Add Quantifiable Metrics',
      description: 'Include metrics like "improved performance by 45%" or "reduced load times by 30%" to strengthen your resume.',
      color: 'red'
    });
  }
  
  // Check for action verbs
  const strongVerbs = ['architected', 'optimized', 'transformed', 'pioneered'];
  const hasStrongVerbs = strongVerbs.some(verb =>
    new RegExp(`\\b${verb}\\b`, 'i').test(text)
  );
  
  if (!hasStrongVerbs) {
    suggestions.push({
      id: '3',
      title: 'Strengthen Action Verbs',
      description: 'Replace weak verbs like "worked on" and "helped with" with strong action verbs like "architected", "optimized".',
      color: 'orange'
    });
  }
  
  // Check for open source contribution section
  if (!new RegExp('open\\s*source|github|contribution', 'i').test(text)) {
    suggestions.push({
      id: '4',
      title: 'Include Open Source Contributions',
      description: 'Your profile has no open source contributions. Add a dedicated section linking to your GitHub projects.',
      color: 'purple'
    });
  }
  
  // Check for professional summary or objective
  if (!new RegExp('summary|objective|professional', 'i').test(text.split('\n')[0])) {
    suggestions.push({
      id: '5',
      title: 'Tailor Summary to Target Role',
      description: 'Your professional summary is generic. Customize it for specific job descriptions and include relevant keywords.',
      color: 'cyan'
    });
  }
  
  return suggestions.slice(0, 5);
};

const analyzeResume = (text, fileName, fileSize) => {
  const skills = extractSkillsByCategory(text);
  const atsScore = calculateATSScore(text);
  const keywordDensity = calculateKeywordDensity(text);
  const formatScore = calculateFormatScore(text);
  const contentQuality = calculateContentQuality(text);
  const suggestions = generateSuggestions(text, skills, {
    atsScore,
    keywordDensity,
    formatScore,
    contentQuality
  });
  
  return {
    atsScore,
    keywordDensity,
    formatScore,
    contentQuality,
    skills,
    suggestions,
    fileName,
    fileSize
  };
};

module.exports = {
  extractTextFromPDF,
  extractSkills,
  extractSkillsByCategory,
  calculateATSScore,
  calculateKeywordDensity,
  calculateFormatScore,
  calculateContentQuality,
  generateSuggestions,
  analyzeResume
};
