export interface InterviewAnswerSections {
  shortAnswer?: string;
  summary?: string;
  keyPoints?: string[];
  bulletPoints?: string[];
  explanation?: string;
  example?: string;
  codeExample?: string;
  realWorldUseCase?: string;
  realWorldContext?: string;
  commonMistakes?: string[];
  interviewTip?: string;
}

export interface InterviewQuestion {
  _id?: string | null;
  sessionId?: string;
  skill?: string;
  topicKey?: string;
  topicType?: string;
  question: string;
  answer: string;
  answerSections?: InterviewAnswerSections;
  difficulty: string;
  category?: string;
  rank?: number;
  isTopQuestion?: boolean;
  tags: string[];
  source?: string;
  sourceType?: string;
  originalSourceType?: string;
  sourceLabel?: string;
  sourceMeta?: { url?: string; verificationStatus?: string; seedVersion?: string };
  verificationStatus?: string;
  qualityScore?: number;
  confidenceScore?: number;
  relevanceScore?: number;
  answerFormat?: string;
  isEnriched?: boolean;
  createdAt?: string;
  stored?: boolean;
  duplicate?: boolean;
  fromCache?: boolean;
}

export interface InterviewQuestionListResponse {
  questions: InterviewQuestion[];
  total: number;
  totalAvailable?: number;
  page: number;
  limit: number;
  totalPages: number;
  topicKey?: string;
  source?: string;
  aiGeneratedCount?: number;
  sourceMix?: Record<string, number>;
  partial?: boolean;
  fromCache?: boolean;
  sessionId?: string;
  personalization?: { status?: string; limitation?: string };
}

export interface InterviewSession {
  _id: string;
  kind?: 'practice' | 'custom';
  topicKey?: string;
  careerStack?: string;
  experienceLevel?: string;
  questions: InterviewQuestion[];
  createdAt?: string;
  personalization?: { status?: string; limitation?: string };
}

export interface InterviewCatalogParams {
  skill: string;
  page?: number;
  limit?: number;
  difficulty?: string;
  tags?: string[];
  category?: string;
  source?: string;
}
