import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class RecruiterHubService {
  constructor(private readonly api: ApiService) {}

  getDashboard(): Observable<any> {
    return this.api.getRecruiterHubDashboard();
  }

  getAnalytics(): Observable<any> {
    return this.api.getRecruiterHubAnalytics();
  }

  getActivity(params: Record<string, string | number> = {}): Observable<any> {
    return this.api.getRecruiterHubActivity(params);
  }

  getProfile(): Observable<any> {
    return this.api.getRecruiterHubProfile();
  }

  updateProfile(payload: Record<string, unknown>): Observable<any> {
    return this.api.updateRecruiterHubProfile(payload);
  }
}
