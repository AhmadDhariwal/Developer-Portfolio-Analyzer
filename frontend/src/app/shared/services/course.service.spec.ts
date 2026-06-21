import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CourseService } from './course.service';

describe('CourseService caching', () => {
  let service: CourseService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        CourseService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
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

    const request = httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&topic=Angular`);
    request.flush({
      courses: [{ id: 'course-1', title: 'Angular Patterns', platform: 'Udemy', url: 'https://example.com/course/1' }],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(first.courses.length).toBe(1);
    expect(second.courses.length).toBe(1);
    httpMock.expectNone(`${environment.apiBaseUrl}/courses?page=1&limit=10&topic=Angular`);
  });

  it('reuses the cached getCourses response on a later call with the same params', async () => {
    const initialPromise = firstValueFrom(service.getCourses({ platform: 'Coursera' }, 1, 10));

    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&platform=Coursera`).flush({
      courses: [{ id: 'course-2', title: 'Backend Foundations', platform: 'Coursera', url: 'https://example.com/course/2' }],
      total: 1,
      page: 1,
      totalPages: 1,
      hasMore: false
    });

    await initialPromise;

    const cached = await firstValueFrom(service.getCourses({ platform: 'Coursera' }, 1, 10));

    expect(cached.courses[0]?.title).toBe('Backend Foundations');
    httpMock.expectNone(`${environment.apiBaseUrl}/courses?page=1&limit=10&platform=Coursera`);
  });

  it('creates a new request when the filter key changes', async () => {
    const firstPromise = firstValueFrom(service.getCourses({ level: 'Beginner' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&level=Beginner`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false
    });
    await firstPromise;

    const secondPromise = firstValueFrom(service.getCourses({ level: 'Advanced' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&level=Advanced`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false
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
      hasMore: false
    });
    await firstPromise;

    service.clearCache();

    const secondPromise = firstValueFrom(service.getCourses({ duration: '2-10' }, 1, 10));
    httpMock.expectOne(`${environment.apiBaseUrl}/courses?page=1&limit=10&duration=2-10`).flush({
      courses: [],
      total: 0,
      page: 1,
      totalPages: 1,
      hasMore: false
    });
    await secondPromise;
  });
});
