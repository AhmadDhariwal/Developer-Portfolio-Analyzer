import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class RecruiterJobService {
  constructor(private readonly api: ApiService) {}

  listJobs(includeShared = false): Observable<any> {
    // Comparison remains owner-only. Metadata and evaluation workspaces opt in
    // separately; metadata sharing is never an evaluation or evidence grant.
    return this.api.getRecruiterHubJobs().pipe(
      map((response) =>
        includeShared
          ? response
          : {
              ...response,
              jobs: (response?.jobs || []).filter((job: any) => job.access?.matching === true),
            },
      ),
    );
  }

  listEvaluationJobs(): Observable<any> {
    return this.listJobs(true).pipe(
      map((response) => ({
        ...response,
        jobs: (response?.jobs || []).filter((job: any) => job.access?.evaluationView === true),
      })),
    );
  }

  getJob(id: string): Observable<any> {
    return this.api.getRecruiterHubJob(id);
  }

  createJob(payload: Record<string, unknown>): Observable<any> {
    return this.api.createRecruiterHubJob(payload);
  }

  updateJob(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.api.updateRecruiterHubJob(id, payload);
  }

  archiveJob(id: string): Observable<any> {
    return this.api.archiveRecruiterHubJob(id);
  }

  deleteJob(id: string): Observable<any> {
    return this.api.deleteRecruiterHubJob(id);
  }
}
