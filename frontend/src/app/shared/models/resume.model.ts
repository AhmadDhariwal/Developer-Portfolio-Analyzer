export interface ResumeAnalysis {
  atsScore: number;
  keywordDensity: number;
  formatScore: number;
  contentQuality: number;
  skills: {
    [category: string]: string[];
  };
  suggestions: ResumeSuggestion[];
  fileName?: string;
  fileSize?: number;
  uploadDate?: string;
}

export interface ResumeSuggestion {
  id: string;
  title: string;
  description: string;
  color: 'red' | 'orange' | 'blue' | 'purple' | 'cyan';
  icon?: string;
}

export interface ResumeFile {
  id: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  uploadDate: Date;
}

export interface ScoreCardData {
  title: string;
  score: number;
  maxScore?: number;
  color: 'purple' | 'pink' | 'green' | 'amber';
}
