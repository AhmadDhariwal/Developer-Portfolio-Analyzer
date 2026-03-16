import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JobFilters, JobsResponse } from '../models/job.model';

@Injectable({ providedIn: 'root' })
export class JobService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getJobs(filters: Partial<JobFilters> = {}, page = 1, limit = 10): Observable<JobsResponse> {
    let params = new HttpParams()
      .set('page',  page.toString())
      .set('limit', limit.toString());

    if (filters.platform && filters.platform !== 'All')               params = params.set('platform',   filters.platform);
    if (filters.location && filters.location !== 'All')                params = params.set('location',   filters.location);
    if (filters.skills   && filters.skills.trim())                     params = params.set('skills',     filters.skills.trim());
    if (filters.jobType  && filters.jobType  !== 'All')                params = params.set('jobType',    filters.jobType);
    if (filters.experienceLevel && filters.experienceLevel !== 'All')  params = params.set('expLevel',   filters.experienceLevel);

    return this.http.get<JobsResponse>(`${this.baseUrl}/jobs`, { params });
  }
}
