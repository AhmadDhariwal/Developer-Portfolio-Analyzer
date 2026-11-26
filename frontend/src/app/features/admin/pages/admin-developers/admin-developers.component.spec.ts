import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModule } from '../../admin.module';
import {
  AdminDeveloper,
  AdminDeveloperPage,
  AdminDeveloperQuery,
  AdminHiringService,
} from '../../services/admin-hiring.service';
import { AdminDevelopersPageComponent } from './admin-developers.component';

describe('Admin Developers zoneless rendering', () => {
  let requests: Array<{ query: AdminDeveloperQuery; response: Subject<AdminDeveloperPage> }>;
  const developer = (name: string): AdminDeveloper => ({
    _id: name,
    name,
    email: '',
    githubUsername: name,
    jobTitle: 'Engineer',
    location: '',
    avatar: '',
    isPublic: true,
    publicProfileSlug: null,
    createdAt: '2026-11-26T00:00:00Z',
  });
  const page = (name: string, number = 1): AdminDeveloperPage => ({
    developers: name ? [developer(name)] : [],
    page: number,
    limit: 10,
    total: name ? 12 : 0,
    totalPages: name ? 2 : 1,
    hasMore: !!name && number === 1,
  });
  beforeEach(() => {
    requests = [];
    TestBed.configureTestingModule({
      imports: [AdminModule],
      providers: [
        {
          provide: AdminHiringService,
          useValue: {
            getDevelopers: (query: AdminDeveloperQuery) => {
              const response = new Subject<AdminDeveloperPage>();
              requests.push({ query, response });
              return response;
            },
          },
        },
      ],
    });
  });
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const fixture = TestBed.createComponent(AdminDevelopersPageComponent);
    await fixture.whenStable();
    return {
      fixture,
      component: fixture.componentInstance,
      element: fixture.nativeElement as HTMLElement,
    };
  }

  it('repaints initial data, Next, Previous and details after delayed responses without manual detection', async () => {
    const { fixture, component, element } = await setup();
    expect(element.textContent).toContain('Loading public developers');
    requests[0].response.next(page('First'));
    await fixture.whenStable();
    expect(element.querySelector('.developer-card h3')?.textContent).toBe('First');
    element.querySelector<HTMLButtonElement>('.pagination__button:last-child')!.click();
    await fixture.whenStable();
    expect(requests[1].query.page).toBe(2);
    requests[1].response.next(page('Second', 2));
    await fixture.whenStable();
    expect(element.querySelector('.developer-card h3')?.textContent).toBe('Second');
    expect(element.textContent).toContain('Showing 11-12');
    component.openDeveloperDetails(component.developers[0]);
    await fixture.whenStable();
    expect(element.querySelector('.detail-drawer h3')?.textContent).toBe('Second');
    element.querySelector<HTMLButtonElement>('.pagination__button')!.click();
    requests[2].response.next(page('First'));
    await fixture.whenStable();
    expect(element.querySelector('.developer-card h3')?.textContent).toBe('First');
    expect(element.querySelector('.detail-drawer')).toBeNull();
    expect(component.loading).toBe(false);
  });

  it('renders debounced search and filter loading, ignores canceled responses and resets pagination', async () => {
    const { fixture, component, element } = await setup();
    requests[0].response.next(page('First', 2));
    await fixture.whenStable();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    component.onSearchChange('Old');
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    await fixture.whenStable();
    expect(element.textContent).toContain('Loading public developers');
    expect(requests[1].query).toMatchObject({ search: 'Old', page: 1 });
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    component.onSearchChange('Latest');
    await vi.advanceTimersByTimeAsync(250);
    vi.useRealTimers();
    requests[2].response.next(page('Latest'));
    requests[1].response.next(page('Old'));
    await fixture.whenStable();
    expect(element.querySelector('.developer-card h3')?.textContent).toBe('Latest');
    component.onStackChange('Backend');
    expect(requests[3].query).toMatchObject({ page: 1, stack: 'Backend', search: 'Latest' });
    requests[3].response.next(page(''));
    await fixture.whenStable();
    expect(element.textContent).toContain('No developers match the current filters');
    expect(component.loading).toBe(false);
  });

  it('renders delayed errors and can retry the identical query', async () => {
    const { fixture, element } = await setup();
    requests[0].response.error(new Error('Unavailable'));
    await fixture.whenStable();
    expect(element.textContent).toContain('Failed to load public developers.');
    const retry = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Retry',
    );
    expect(retry).toBeDefined();
    retry!.click();
    await fixture.whenStable();
    expect(element.textContent).toContain('Loading public developers');
    expect(requests[1].query).toEqual(requests[0].query);
    requests[1].response.next(page('Recovered'));
    await fixture.whenStable();
    expect(element.querySelector('.developer-card h3')?.textContent).toBe('Recovered');
  });

  it('cancels pending search on Reset and permits repeating that search afterward', async () => {
    const { fixture, component } = await setup();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    component.onSearchChange('Repeat');
    await vi.advanceTimersByTimeAsync(250);
    component.onSearchChange('Pending');
    component.resetFilters();
    await vi.advanceTimersByTimeAsync(250);
    expect(requests.at(-1)?.query.search).toBe('');
    component.onSearchChange('Repeat');
    await vi.advanceTimersByTimeAsync(250);
    expect(requests.at(-1)?.query.search).toBe('Repeat');
    vi.useRealTimers();
    fixture.destroy();
    expect(requests.at(-1)?.response.observed).toBe(false);
  });
});
