import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface InterviewQuestion {
  _id?: string;
  skill?: string;
  topicKey?: string;
  topicType?: 'stack' | 'technology' | 'language' | 'framework';
  question: string;
  answer: string;
  answerSections?: {
    summary?: string;
    explanation?: string;
    bulletPoints?: string[];
    codeExample?: string;
    realWorldContext?: string;
    [key: string]: string | string[] | undefined;
  };
  difficulty: 'easy' | 'medium' | 'hard';
  category?: 'conceptual' | 'scenario_based' | 'code_output' | 'best_practice' | 'system_design' | 'behavioral';
  qualityScore?: number;
  answerFormat?: 'structured' | 'plain';
  isEnriched?: boolean;
  tags: string[];
  source?: 'prebuilt' | 'ai' | 'ai_generated' | 'scraped' | 'user_asked' | 'seed' | 'db' | 'scrape' | 'hybrid';
  sourceType?: 'prebuilt' | 'ai' | 'ai_generated' | 'scraped' | 'user_asked' | 'seed' | 'db' | 'scrape' | 'hybrid';
  sourceLabel?: string;
  popularity?: number;
  confidenceScore?: number;
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
  source?: string;
  aiGeneratedCount?: number;
  scrapedGeneratedCount?: number;
  enrichedCount?: number;
  sourceMix?: Record<string, number>;
  partial?: boolean;
  fromCache?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class InterviewPrepService {
  constructor(private readonly api: ApiService) {}

  getTopQuestions(params: { skill: string; page?: number; limit?: number; difficulty?: string; tags?: string[] }): Observable<InterviewQuestionListResponse> {
    return this.api.getInterviewPrepQuestions({ ...params, block: 'top' });
  }

  getAllQuestions(params: { skill: string; page?: number; limit?: number; difficulty?: string; tags?: string[]; category?: string; source?: string }): Observable<InterviewQuestionListResponse> {
    return this.api.getInterviewPrepQuestions({ ...params, block: 'all' });
  }

  searchQuestions(params: { q: string; page?: number; limit?: number; skill?: string; difficulty?: string; tags?: string[]; lookupOnly?: boolean }): Observable<InterviewQuestionListResponse> {
    return this.api.searchInterviewPrepQuestions(params);
  }

  generateQuestions(payload: { skill: string; query?: string; difficulty?: string; page?: number; limit?: number; target?: number }): Observable<InterviewQuestionListResponse> {
    return this.api.generateInterviewPrepQuestions(payload);
  }

  askQuestion(payload: {
    question: string;
    skill?: string;
    topic?: string;
    stack?: string;
    technology?: string;
    language?: string;
    framework?: string;
  }): Observable<InterviewQuestion> {
    return this.api.askInterviewPrepQuestion(payload);
  }
}
