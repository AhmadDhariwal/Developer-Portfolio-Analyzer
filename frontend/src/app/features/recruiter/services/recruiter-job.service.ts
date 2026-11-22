import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class RecruiterJobService {
  constructor(private readonly api: ApiService) {}

  listJobs(includeShared = false): Observable<any> {
    // Existing matching/comparison consumers stay owner-only. Only the metadata
    // workspace opts in to team-visible jobs; this is not an evidence grant.
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
