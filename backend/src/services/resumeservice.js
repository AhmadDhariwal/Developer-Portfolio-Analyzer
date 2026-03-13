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

/**
 * AI-Driven Resume Analysis
 */
const analyzeResume = async (text, fileName, fileSize) => {
  const prompt = getResumePrompt(text);
  
  const fallback = {
    skills: [],
    experienceYears: 0,
    experienceLevel: "Junior",
    certifications: [],
    keyAchievements: []
  };

  const aiResult = await aiService.runAIAnalysis(prompt, fallback);
  
  // Map AI groups into the structure expected by the frontend
  const skillsByCategory = {
    'Programming Languages': [],
    'Frameworks & Libraries': [],
    'Technologies & Tools': [],
    'Soft Skills': []
  };

  if (aiResult.skills) {
    aiResult.skills.forEach(s => {
        const cat = s.category || 'Technologies & Tools';
        if (skillsByCategory[cat]) {
            skillsByCategory[cat].push(s.name);
        } else {
            skillsByCategory['Technologies & Tools'].push(s.name);
        }
    });
  }

  return {
    ...aiResult,
    skills: skillsByCategory,
    fileName,
    fileSize,
    atsScore: calculateBasicATS(text, aiResult) // Keep a lightweight helper for score
  };
};

const calculateBasicATS = (text, aiResult) => {
    let score = 50;
    const lowerText = text.toLowerCase();
    
    // Impact of AI skills found
    if (aiResult.skills?.length > 5) score += 20;
    if (aiResult.experienceLevel === 'Senior') score += 15;
    
    // Basic formatting checks
    if (lowerText.includes('experience') && lowerText.includes('education')) score += 10;
    
    return Math.min(score, 100);
};

module.exports = {
  extractTextFromPDF,
  analyzeResume
};

