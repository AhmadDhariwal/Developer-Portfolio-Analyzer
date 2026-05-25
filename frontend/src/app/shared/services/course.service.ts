import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  Course,
  CourseFilters,
  CoursesResponse,
  normalizeCourseFilters
} from '../models/course.model';

@Injectable({ providedIn: 'root' })
export class CourseService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getCourses(filters: Partial<CourseFilters> = {}, page = 1, limit = 10): Observable<CoursesResponse> {
    const normalizedFilters = normalizeCourseFilters(filters);
    let params = new HttpParams()
      .set('page', String(Math.max(1, page)))
      .set('limit', String(Math.max(1, limit)));

    if (normalizedFilters.platform !== 'All') {
      params = params.set('platform', normalizedFilters.platform);
    }
    if (normalizedFilters.rating) {
      params = params.set('rating', normalizedFilters.rating);
    }
    if (normalizedFilters.level !== 'All') {
      params = params.set('level', normalizedFilters.level);
    }
    if (normalizedFilters.duration !== 'All') {
      params = params.set('duration', normalizedFilters.duration);
    }
    if (normalizedFilters.topic) {
      params = params.set('topic', normalizedFilters.topic);
    }

    return this.http
      .get<CoursesResponse>(`${this.baseUrl}/courses`, { params })
      .pipe(map((response) => this.normalizeResponse(response, normalizedFilters, page)));
  }

  private normalizeResponse(response: CoursesResponse | null | undefined, filters: CourseFilters, requestedPage: number): CoursesResponse {
    const courses = Array.isArray(response?.courses)
      ? response!.courses.map((course, index) => this.normalizeCourse(course, index))
      : [];

    const total = Number(response?.total ?? courses.length) || 0;
    const totalPages = Math.max(1, Number(response?.totalPages ?? 1) || 1);
    const page = Math.min(Math.max(1, Number(response?.page ?? requestedPage) || requestedPage), totalPages);

    return {
      courses,
      total,
      page,
      totalPages,
      hasMore: Boolean(response?.hasMore ?? (page < totalPages)),
      fromCache: Boolean(response?.fromCache),
      recommendedBasedOn: response?.recommendedBasedOn
        ? {
            ...response.recommendedBasedOn,
            activeFilters: normalizeCourseFilters(response.recommendedBasedOn.activeFilters || filters),
            skillGapsUsed: Array.isArray(response.recommendedBasedOn.skillGapsUsed)
              ? response.recommendedBasedOn.skillGapsUsed.filter(Boolean)
              : [],
            summary: String(response.recommendedBasedOn.summary || '').trim()
          }
        : null
    };
  }

  private normalizeCourse(course: Partial<Course> | null | undefined, index: number): Course {
    const title = String(course?.title || `Recommended Course ${index + 1}`).trim();
    const description = String(course?.description || 'Strengthen your skills with a curated learning resource.').trim();
    const topics = Array.isArray(course?.topics)
      ? course!.topics.map((topic) => String(topic || '').trim()).filter(Boolean).slice(0, 5)
      : [];

    return {
      id: String(course?.id || `${title}-${index}`).trim(),
      title,
      description,
      platform: (course?.platform || 'Udemy') as Course['platform'],
      instructor: String(course?.instructor || course?.platform || 'Course Provider').trim(),
      rating: Number(course?.rating ?? 4.1) || 4.1,
      reviewCount: Number(course?.reviewCount ?? 0) || 0,
      duration: String(course?.duration || 'Self-paced').trim(),
      durationHours: Number(course?.durationHours ?? 0) || 0,
      level: (course?.level || 'All Levels') as Course['level'],
      thumbnail: String(course?.thumbnail || '').trim(),
      url: String(course?.url || '#').trim(),
      topics,
      popularity: Number(course?.popularity ?? 0) || 0,
      relevanceScore: Number(course?.relevanceScore ?? 0) || 0,
      finalScore: Number(course?.finalScore ?? 0) || 0,
      whyRecommended: String(course?.whyRecommended || '').trim(),
      platformColor: course?.platformColor
    };
  }
}
