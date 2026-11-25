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

  updateMatchStatus(
    id: string,
    status: 'generated' | 'shortlisted' | 'rejected',
    expectedVersion?: number,
  ): Observable<any> {
    return this.api.updateRecruiterHubMatchStatus(id, {
      status,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
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
  getApplicationShortlists(page = 1, limit = 20): Observable<any> {
    return this.api.getRecruiterApplicationShortlists(page, limit);
  }
  updateApplicationShortlist(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.api.updateRecruiterApplicationShortlist(id, payload);
  }

  compareCandidates(payload: Record<string, unknown>): Observable<any> {
    return this.api.compareRecruiterHubCandidates(payload);
  }
}
