import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';

@Injectable()
export class RecruiterJobService {
  constructor(private readonly api: ApiService) {}

  listJobs(): Observable<any> {
    return this.api.getRecruiterHubJobs();
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
