const fs = require('fs');
const pdfParse = require('pdf-parse');
const aiService = require('./aiservice');
const { getResumePrompt } = require('../prompts/resumePrompt');

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

/**
 * AI-Driven Resume Analysis
 */
const analyzeResume = async (text, fileName, fileSize) => {
  const prompt = getResumePrompt(text);

  const fallback = {
    skills: [],
    experienceYears: 0,
    experienceLevel: 'Junior',
    certifications: [],
    keyAchievements: [],
    atsScore: 50,
    keywordDensity: 40,
    formatScore: 50,
    contentQuality: 40,
    scoreBreakdown: {
      atsScore:       'AI analysis unavailable. Score is an estimate.',
      keywordDensity: 'AI analysis unavailable. Score is an estimate.',
      formatScore:    'AI analysis unavailable. Score is an estimate.',
      contentQuality: 'AI analysis unavailable. Score is an estimate.'
    },
    suggestions: [
      {
        id: 'suggestion-1',
        title: 'Add quantified achievements',
        description: 'Include measurable results (e.g. "Reduced load time by 40%") to make your impact clear to recruiters.',
        color: 'orange'
      },
      {
        id: 'suggestion-2',
        title: 'Improve keyword coverage',
        description: 'Add more industry-relevant keywords matching the job descriptions you are targeting to improve ATS ranking.',
        color: 'blue'
      },
      {
        id: 'suggestion-3',
        title: 'Ensure clear section headers',
        description: 'Use standard section titles like Experience, Education, and Skills so ATS parsers can correctly categorize your content.',
        color: 'red'
      },
      {
        id: 'suggestion-4',
        title: 'Use strong action verbs',
        description: 'Start bullet points with verbs like "Built", "Led", "Optimized" to convey ownership and impact.',
        color: 'purple'
      }
    ]
  };

  const aiResult = await aiService.runAIAnalysis(prompt, fallback);

  // Map AI skill objects into the category buckets the frontend expects
  const skillsByCategory = {
    'Programming Languages': [],
    'Frameworks & Libraries': [],
    'Technologies & Tools': [],
    'Soft Skills': []
  };

  const rawSkills = Array.isArray(aiResult.skills) ? aiResult.skills : [];
  rawSkills.forEach(s => {
    const name = typeof s === 'string' ? s : s?.name;
    const cat  = s?.category || 'Technologies & Tools';
    if (!name) return;
    if (skillsByCategory[cat]) {
      skillsByCategory[cat].push(name);
    } else {
      skillsByCategory['Technologies & Tools'].push(name);
    }
  });

  // Ensure suggestions always have the required shape
  const suggestions = Array.isArray(aiResult.suggestions) && aiResult.suggestions.length
    ? aiResult.suggestions.map((s, i) => ({
        id:          s.id          || `suggestion-${i + 1}`,
        title:       s.title       || 'Resume Improvement',
        description: s.description || 'Review this section for improvements.',
        color:       s.color       || 'blue',
        icon:        s.icon        || undefined
      }))
    : fallback.suggestions;

  return {
    skills:          skillsByCategory,
    experienceYears: aiResult.experienceYears  ?? 0,
    experienceLevel: aiResult.experienceLevel  || 'Junior',
    certifications:  aiResult.certifications   || [],
    keyAchievements: aiResult.keyAchievements  || [],
    atsScore:        clamp(aiResult.atsScore        ?? fallback.atsScore),
    keywordDensity:  clamp(aiResult.keywordDensity  ?? fallback.keywordDensity),
    formatScore:     clamp(aiResult.formatScore     ?? fallback.formatScore),
    contentQuality:  clamp(aiResult.contentQuality  ?? fallback.contentQuality),
    scoreBreakdown: {
      atsScore:       aiResult.scoreBreakdown?.atsScore       || fallback.scoreBreakdown.atsScore,
      keywordDensity: aiResult.scoreBreakdown?.keywordDensity || fallback.scoreBreakdown.keywordDensity,
      formatScore:    aiResult.scoreBreakdown?.formatScore    || fallback.scoreBreakdown.formatScore,
      contentQuality: aiResult.scoreBreakdown?.contentQuality || fallback.scoreBreakdown.contentQuality,
    },
    suggestions,
    fileName,
    fileSize
  };
};

module.exports = {
  extractTextFromPDF,
  analyzeResume
};
