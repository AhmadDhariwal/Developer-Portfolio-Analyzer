import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class CandidateService {
  constructor(private readonly api: ApiService) {}

  listCandidates(params: Record<string, string | number> = {}): Observable<any> {
    return this.api.getRecruiterHubCandidates(params);
  }

  getCandidate(id: string): Observable<any> {
    return this.api.getRecruiterHubCandidate(id);
  }

  analyzeCandidate(id: string): Observable<any> {
    return this.api.analyzeRecruiterHubCandidate(id);
  }
}
