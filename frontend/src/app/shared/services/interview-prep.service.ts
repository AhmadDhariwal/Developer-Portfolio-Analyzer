import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface InterviewQuestion {
  question: string;
  answer: string;
  difficulty: string;
  tags: string[];
}

export interface InterviewPrepSession {
  _id: string;
  skillGaps: string[];
  questions: InterviewQuestion[];
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class InterviewPrepService {
  constructor(private readonly api: ApiService) {}

  generateSession(payload: { skillGaps: string[]; careerStack?: string; experienceLevel?: string }): Observable<InterviewPrepSession> {
    return this.api.generateInterviewPrep(payload);
  }

  getHistory(limit = 5): Observable<{ sessions: InterviewPrepSession[] }> {
    return this.api.getInterviewPrepHistory(limit);
  }
}
