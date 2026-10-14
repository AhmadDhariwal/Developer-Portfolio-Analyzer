import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CourseService } from './course.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

describe('CourseService caching', () => {
  let service: CourseService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CourseService, provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(CourseService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('shares one request for repeated getCourses subscriptions with the same params', async () => {
    const firstPromise = firstValueFrom(service.getCourses({ topic: 'Angular' }, 1, 10));
    const secondPromise = firstValueFrom(service.getCourses({ topic: 'Angular' }, 1, 10));

    const request = httpMock.expectOne(
      `${environment.apiBaseUrl}/courses?page=1&limit=10&topic=Angular`,
    );
    request.flush({
      courses: [
        {
          id: 'course-1',
          title: 'Angular Patterns',
          platform: 'Udemy',
          url: 'https://example.com/course/1',
        },
      ],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.courses.length).toBe(1);
    expect(second.courses.length).toBe(1);
    httpMock.expectNone(`${environment.apiBaseUrl}/courses?page=1&limit=10&topic=Angular`);
  });

  it('rechecks backend source freshness on a later call with the same params', async () => {
    const initialPromise = firstValueFrom(service.getCourses({ platform: 'Coursera' }, 1, 10));

    httpMock
      .expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&platform=Coursera`)
      .flush({
        courses: [
          {
            id: 'course-2',
            title: 'Backend Foundations',
            platform: 'Coursera',
            url: 'https://example.com/course/2',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
        hasMore: false,
      });

    await initialPromise;

    const next = firstValueFrom(service.getCourses({ platform: 'Coursera' }, 1, 10));
    httpMock
      .expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&platform=Coursera`)
      .flush({
        courses: [
          {
            id: 'course-new',
            title: 'New context course',
            platform: 'Coursera',
            url: 'https://example.com/course/new',
          },
        ],
        total: 1,
        page: 1,
        totalPages: 1,
        hasMore: false,
      });
    const updated = await next;
    expect(updated.courses[0]?.title).toBe('New context course');
    expect(updated.fromFrontendCache).toBe(false);
  });

  it('creates a new request when the filter key changes', async () => {
    const firstPromise = firstValueFrom(service.getCourses({ level: 'Beginner' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&level=Beginner`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await firstPromise;

    const secondPromise = firstValueFrom(service.getCourses({ level: 'Advanced' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&level=Advanced`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await secondPromise;
  });

  it('clears cached course queries when clearCache is called', async () => {
    const firstPromise = firstValueFrom(service.getCourses({ duration: '2-10' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&duration=2-10`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await firstPromise;

    service.clearCache();

    const secondPromise = firstValueFrom(service.getCourses({ duration: '2-10' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&duration=2-10`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await secondPromise;
  });

  it('evicts failed requests so retry can reach the backend', async () => {
    const failedPromise = firstValueFrom(service.getCourses({ topic: 'Testing' }, 1, 10));
    httpMock
      .expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&topic=Testing`)
      .flush({ message: 'Temporary failure' }, { status: 503, statusText: 'Service Unavailable' });
    let rejected = false;
    try {
      await failedPromise;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    const retryPromise = firstValueFrom(service.getCourses({ topic: 'Testing' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&topic=Testing`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });
    await retryPromise;
  });

  it('deduplicates response courses and leaves unavailable display fields empty', async () => {
    const promise = firstValueFrom(service.getCourses({}, 1, 10));
    const duplicate = {
      id: 'course-3',
      title: 'Production Angular',
      platform: 'Coursera',
      url: 'https://example.com/course/3',
      topics: ['Angular', 'Angular'],
    };

    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10`).flush({
      courses: [duplicate, duplicate],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });

    const response = await promise;
    expect(response.courses.length).toBe(1);
    expect(response.courses[0]?.topics).toEqual(['Angular']);
    expect(response.courses[0]?.duration).toBeUndefined();
    expect(response.courses[0]?.rating).toBeUndefined();
  });

  it('drops incomplete courses and does not invent ratings from null or zero', async () => {
    const promise = firstValueFrom(service.getCourses({ topic: 'SQL' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&topic=SQL`).flush({
      courses: [
        {
          id: 'ok',
          title: 'SQL Basics',
          platform: 'Udemy',
          url: 'https://www.udemy.com/course/sql/',
          rating: null,
        },
        { id: 'bad', title: '', platform: 'Udemy', url: 'https://www.udemy.com/course/bad/' },
        {
          id: 'zero',
          title: 'Zero Rated',
          platform: 'Coursera',
          url: 'https://www.coursera.org/learn/zero',
          rating: 0,
        },
      ],
      total: 3,
      page: 1,
      totalPages: 1,
      hasMore: false,
    });

    const response = await promise;
    expect(response.courses.map((course) => course.id)).toEqual(['ok', 'zero']);
    expect(response.courses[0]?.rating).toBeNull();
    expect(response.courses[1]?.rating).toBe(0);
  });
  it('preserves provenance, missing values, actual zero counts and backend ranking order', async () => {
    const promise = firstValueFrom(service.getCourses({}, 1, 10, { refresh: true }));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&refresh=true`).flush({
      courses: [
        {
          id: 'yt_abcdefghijk',
          title: 'Video',
          platform: 'YouTube',
          url: 'https://www.youtube.com/watch?v=abcdefghijk',
          topics: [],
          rating: null,
          reviewCount: null,
          viewCount: 0,
          likeCount: 0,
          engagementScore: 4.1,
          provenance: {
            source: 'youtube-api',
            ratingSource: 'unavailable',
            availability: 'observed',
            metadataVerifiedAt: null,
          },
        },
      ],
      personalization: { status: 'career-context-only', limitation: 'No current evidence' },
      cacheMetadata: { cacheLayer: 'mongo', loadedFromCache: true },
    });
    const result = await promise;
    expect(result.courses[0]).toMatchObject({
      rating: null,
      reviewCount: null,
      viewCount: 0,
      likeCount: 0,
      engagementScore: 4.1,
    });
    expect(result.personalization?.limitation).toBe('No current evidence');
    expect(result.cacheMetadata?.cacheLayer).toBe('mongo');
  });
  it('uses the owned progress and Sprint contracts without metadata or ownership fields', async () => {
    const list = firstValueFrom(service.getMyLearning('completed', 2, 10));
    httpMock
      .expectOne(`${environment.apiBaseUrl}/courses/my-learning?page=2&limit=10&status=completed`)
      .flush({ courses: [], page: 2, totalPages: 2, total: 0 });
    await list;
    const save = firstValueFrom(
      service.saveProgress('fb_a1', {
        status: 'saved',
        notes: 'Notes',
        progressPercent: 0,
        userId: 'forged',
      } as Parameters<typeof service.saveProgress>[1]),
    );
    const put = httpMock.expectOne(`${environment.apiBaseUrl}/courses/fb_a1/progress`);
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ status: 'saved', notes: 'Notes', progressPercent: 0 });
    put.flush({ courseId: 'fb_a1' });
    await save;
    const sprint = firstValueFrom(service.addToSprint('fb_a1'));
    const post = httpMock.expectOne(`${environment.apiBaseUrl}/courses/fb_a1/career-sprint`);
    expect(post.request.method).toBe('POST');
    expect(post.request.body).toEqual({});
    post.flush({ alreadyAdded: true });
    await sprint;
    const remove = firstValueFrom(service.removeProgress('fb_a1'));
    const deletion = httpMock.expectOne(`${environment.apiBaseUrl}/courses/fb_a1/progress`);
    expect(deletion.request.method).toBe('DELETE');
    deletion.flush(null, { status: 204, statusText: 'No Content' });
    await remove;
  });
  it('invalidates a previously viewed Sprint only after a confirmed course handoff', async () => {
    const clearSprint = vi.fn();
    TestBed.inject(FrontendCacheInvalidationService).register('career-sprint', clearSprint);
    const pending = firstValueFrom(service.addToSprint('fb_u2'));
    expect(clearSprint).not.toHaveBeenCalled();
    httpMock
      .expectOne(`${environment.apiBaseUrl}/courses/fb_u2/career-sprint`)
      .flush({ alreadyAdded: false });
    await pending;
    expect(clearSprint).toHaveBeenCalledOnce();
    const failed = firstValueFrom(service.addToSprint('fb_u3')).catch(() => undefined);
    httpMock
      .expectOne(`${environment.apiBaseUrl}/courses/fb_u3/career-sprint`)
      .flush({ message: 'Conflict' }, { status: 409, statusText: 'Conflict' });
    await failed;
    expect(clearSprint).toHaveBeenCalledOnce();
  });
});
