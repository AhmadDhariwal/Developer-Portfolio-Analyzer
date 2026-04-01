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
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  source?: 'prebuilt' | 'ai' | 'scraped' | 'user_asked';
  sourceType?: 'prebuilt' | 'ai' | 'scraped' | 'user_asked';
  popularity?: number;
  confidenceScore?: number;
  createdAt?: string;
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
    return this.api.getInterviewPrepQuestions(params);
  }

  searchQuestions(params: { q: string; page?: number; limit?: number; skill?: string; difficulty?: string; tags?: string[] }): Observable<InterviewQuestionListResponse> {
    return this.api.searchInterviewPrepQuestions(params);
  }

  generateQuestions(payload: { skill: string; query?: string; page?: number; limit?: number }): Observable<InterviewQuestionListResponse> {
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
