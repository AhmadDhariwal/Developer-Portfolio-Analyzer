import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { shareReplay } from 'rxjs/operators';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class RecruiterHubService {
  private dashboard$?: Observable<any>;
  private analytics$?: Observable<any>;

  constructor(private readonly api: ApiService) {}

  getDashboard(forceRefresh = false): Observable<any> {
    if (!this.dashboard$ || forceRefresh) {
      this.dashboard$ = this.api.getRecruiterHubDashboard().pipe(shareReplay(1));
    }
    return this.dashboard$;
  }

  getAnalytics(forceRefresh = false): Observable<any> {
    if (!this.analytics$ || forceRefresh) {
      this.analytics$ = this.api.getRecruiterHubAnalytics().pipe(shareReplay(1));
    }
    return this.analytics$;
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

  clearCache(): void {
    this.dashboard$ = undefined;
    this.analytics$ = undefined;
  }
}
