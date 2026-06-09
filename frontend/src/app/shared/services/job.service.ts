import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  Job,
  JobFilters,
  JobsResponse,
  normalizeJobFilters
} from '../models/job.model';

@Injectable({ providedIn: 'root' })
export class JobService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getJobs(filters: Partial<JobFilters> = {}, page = 1, limit = 10): Observable<JobsResponse> {
    const normalizedFilters = normalizeJobFilters(filters);
    let params = new HttpParams()
      .set('page', String(Math.max(1, page)))
      .set('limit', String(Math.max(1, limit)));

    if (normalizedFilters.platform !== 'All') {
      params = params.set('platform', normalizedFilters.platform);
    }
    if (normalizedFilters.location !== 'All') {
      params = params.set('location', normalizedFilters.location);
    }
    if (normalizedFilters.skills) {
      params = params.set('skills', normalizedFilters.skills);
    }
    if (normalizedFilters.jobType !== 'All') {
      params = params.set('jobType', normalizedFilters.jobType);
    }
    if (normalizedFilters.experienceLevel !== 'All') {
      params = params.set('expLevel', normalizedFilters.experienceLevel);
    }

    return this.http.get<JobsResponse>(`${this.baseUrl}/jobs`, { params }).pipe(
      map((response) => this.normalizeResponse(response, normalizedFilters, page))
    );
  }

  getJobById(id: string): Observable<Job> {
    return this.http.get<{ job?: Partial<Job> }>(`${this.baseUrl}/jobs/${encodeURIComponent(id)}`).pipe(
      map((response) => this.normalizeJob(response?.job, 0))
    );
  }

  private normalizeResponse(response: JobsResponse | null | undefined, filters: JobFilters, requestedPage: number): JobsResponse {
    const jobs = Array.isArray(response?.jobs)
      ? response!.jobs.map((job, index) => this.normalizeJob(job, index))
      : [];
    const total = Number(response?.total ?? jobs.length) || 0;
    const totalPages = Math.max(1, Number(response?.totalPages ?? 1) || 1);
    const page = Math.min(Math.max(1, Number(response?.page ?? requestedPage) || requestedPage), totalPages);

    return {
      jobs,
      total,
      page,
      totalPages,
      hasMore: Boolean(response?.hasMore ?? (page < totalPages)),
      fromCache: Boolean(response?.fromCache),
      sourceMessage: String(response?.sourceMessage || '').trim(),
      primarySource: String(response?.primarySource || '').trim(),
      sourceSummary: response?.sourceSummary || {},
      jsearchConfigured: response?.jsearchConfigured,
      recommendedBasedOn: response?.recommendedBasedOn
        ? {
            ...response.recommendedBasedOn,
            activeFilters: {
              platform: response.recommendedBasedOn.activeFilters?.platform || filters.platform,
              location: response.recommendedBasedOn.activeFilters?.location || filters.location,
              skills: String(response.recommendedBasedOn.activeFilters?.skills || filters.skills || '').trim(),
              jobType: response.recommendedBasedOn.activeFilters?.jobType || filters.jobType,
              experienceLevel: response.recommendedBasedOn.activeFilters?.experienceLevel || filters.experienceLevel
            },
            knownSkills: Array.isArray(response.recommendedBasedOn.knownSkills) ? response.recommendedBasedOn.knownSkills : [],
            skillGaps: Array.isArray(response.recommendedBasedOn.skillGaps) ? response.recommendedBasedOn.skillGaps : [],
            resumeSkills: Array.isArray(response.recommendedBasedOn.resumeSkills) ? response.recommendedBasedOn.resumeSkills : [],
            githubSkills: Array.isArray(response.recommendedBasedOn.githubSkills) ? response.recommendedBasedOn.githubSkills : [],
            summary: String(response.recommendedBasedOn.summary || '').trim()
          }
        : null
    };
  }

  private normalizeJob(job: Partial<Job> | null | undefined, index: number): Job {
    const url = String(job?.url || '').trim();
    const applyUrl = String(job?.applyUrl || url || '').trim();

    return {
      id: String(job?.id || `job-${index}`).trim(),
      externalJobId: String(job?.externalJobId || '').trim(),
      title: String(job?.title || 'Software Engineer').trim(),
      company: String(job?.company || 'Technology Company').trim(),
      companyLogo: String(job?.companyLogo || '').trim(),
      location: String(job?.location || 'Remote').trim(),
      salary: String(job?.salary || 'Competitive').trim(),
      jobType: String(job?.jobType || 'Full Time').trim(),
      skills: Array.isArray(job?.skills)
        ? job!.skills.map((skill) => String(skill || '').trim()).filter(Boolean).slice(0, 8)
        : [],
      postedDate: String(job?.postedDate || '').trim(),
      description: String(job?.description || 'Explore a role aligned with your developer profile.').trim(),
      requirements: Array.isArray(job?.requirements)
        ? job!.requirements.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 14)
        : [],
      benefits: Array.isArray(job?.benefits)
        ? job!.benefits.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10)
        : [],
      platform: (job?.platform || 'Other') as Job['platform'],
      url,
      applyUrl,
      experienceLevel: String(job?.experienceLevel || 'Entry').trim(),
      source: String(job?.source || '').trim(),
      score: Number(job?.score ?? 0) || 0,
      matchScore: Number(job?.matchScore ?? 0) || 0,
      experienceMatch: Number(job?.experienceMatch ?? 0) || 0,
      skillMatch: Number(job?.skillMatch ?? 0) || 0,
      missingSkills: Array.isArray(job?.missingSkills)
        ? job!.missingSkills.map((skill) => String(skill || '').trim()).filter(Boolean).slice(0, 5)
        : [],
      whyMatched: String(job?.whyMatched || '').trim(),
      platformColor: job?.platformColor
    };
  }
}
