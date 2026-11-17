'use strict';

const VERSION = 'resume-content-quality-v1';
const assessContent = (text) => {
  if (typeof text !== 'string') return { state: 'INVALID', scoreable: false, wordCount: 0, version: VERSION };
  const clean = text.normalize('NFKC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim();
  const words = clean.match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) || [];
  const uniqueWordCount = new Set(words.map(word => word.toLowerCase())).size;
  const letters = (clean.match(/\p{L}/gu) || []).length;
  const visible = clean.replace(/\s/g, '').length;
  const readable = visible > 0 && letters / visible >= 0.35 && !clean.includes('\ufffd');
  // Content sufficiency is independent of the approved scoring weights.
  // Repeating a few readable tokens does not make a document scoreable.
  const state = !clean ? 'EMPTY' : !readable || words.length < 5 || uniqueWordCount < 5 ? 'UNREADABLE'
    : words.length < 40 || uniqueWordCount < 12 ? 'PARTIALLY_READABLE' : 'VALID';
  return { state, scoreable: readable && words.length >= 16 && uniqueWordCount >= 12, wordCount: words.length, uniqueWordCount, version: VERSION };
};

const requireReadableContent = (text) => {
  const quality = assessContent(text);
  if (['EMPTY', 'UNREADABLE', 'INVALID'].includes(quality.state)) {
    const error = new Error(quality.state === 'EMPTY'
      ? 'The PDF contains no readable resume text. Upload a text-based PDF.'
      : 'The resume text is unreadable or too short. Upload a readable text-based PDF.');
    error.status = 422;
    error.code = 'RESUME_CONTENT_UNUSABLE';
    error.contentQualityState = quality;
    throw error;
  }
  return quality;
};

module.exports = { VERSION, assessContent, requireReadableContent };
