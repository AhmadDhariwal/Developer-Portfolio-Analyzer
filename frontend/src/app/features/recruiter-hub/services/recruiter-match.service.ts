import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class RecruiterMatchService {
  constructor(private readonly api: ApiService) {}

  listMatches(params: Record<string, string | number> = {}): Observable<any> {
    return this.api.getRecruiterHubMatches(params);
  }

  generateMatches(payload: Record<string, unknown>): Observable<any> {
    return this.api.generateRecruiterHubMatches(payload);
  }

  updateMatchStatus(id: string, status: 'generated' | 'shortlisted' | 'rejected'): Observable<any> {
    return this.api.updateRecruiterHubMatchStatus(id, { status });
  }

  getShortlists(params: Record<string, string | number> = {}): Observable<any> {
    return this.api.getRecruiterHubShortlists(params);
  }

  addToShortlist(payload: Record<string, unknown>): Observable<any> {
    return this.api.createRecruiterHubShortlist(payload);
  }

  updateShortlist(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.api.updateRecruiterHubShortlist(id, payload);
  }

  removeShortlist(id: string): Observable<any> {
    return this.api.deleteRecruiterHubShortlist(id);
  }

  compareCandidates(payload: Record<string, unknown>): Observable<any> {
    return this.api.compareRecruiterHubCandidates(payload);
  }
}
