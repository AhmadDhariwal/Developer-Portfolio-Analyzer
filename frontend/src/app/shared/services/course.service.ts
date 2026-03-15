import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CourseFilters, CoursesResponse } from '../models/course.model';

@Injectable({ providedIn: 'root' })
export class CourseService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  /**
   * Fetches ranked course recommendations from the backend.
   * All filter and pagination params are appended as query strings.
   */
  getCourses(filters: Partial<CourseFilters> = {}, page = 1, limit = 10): Observable<CoursesResponse> {
    let params = new HttpParams()
      .set('page',  page.toString())
      .set('limit', limit.toString());

    if (filters.platform && filters.platform !== 'All') {
      params = params.set('platform', filters.platform);
    }
    if (filters.rating) {
      params = params.set('rating', filters.rating);
    }
    if (filters.level && filters.level !== 'All') {
      params = params.set('level', filters.level);
    }
    if (filters.duration && filters.duration !== 'All') {
      params = params.set('duration', filters.duration);
    }
    if (filters.topic) {
      params = params.set('topic', filters.topic);
    }

    return this.http.get<CoursesResponse>(`${this.baseUrl}/courses`, { params });
  }
}
