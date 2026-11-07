import { CourseCardComponent } from './course-card';
import { safeCourseUrl } from '../../models/course.model';

describe('Course card data integrity and actions', () => {
  let card: CourseCardComponent;
  beforeEach(() => {
    card = new CourseCardComponent();
    card.course = {
      id: 'fb_a1',
      title: 'Course',
      platform: 'Udemy',
      url: 'https://www.udemy.com/course/angular/',
      topics: [],
    };
  });
  it('opens only HTTPS links on the actual provider domain', () => {
    expect(card.externalUrl).toContain('udemy.com');
    for (const url of [
      'javascript:alert(1)',
      'http://udemy.com/course/x',
      'https://udemy.com.evil.test/x',
      'https://user:password@udemy.com/x',
      'https://udemy.com:444/x',
    ])
      expect(safeCourseUrl(url, 'Udemy')).toBeNull();
  });
  it('never displays derived engagement or unattributed ratings as provider reviews', () => {
    card.course.rating = 4.9;
    card.course.engagementScore = 4.8;
    expect(card.providerRating).toBe(false);
    card.course.provenance = {
      source: 'provider',
      ratingSource: 'provider-reviews',
      metadataVerifiedAt: null,
      availability: 'unverified',
    };
    expect(card.providerRating).toBe(true);
    card.course.rating = null;
    expect(card.providerRating).toBe(false);
  });
  it('preserves the server status while requesting a status change', () => {
    card.progress = { status: 'saved' } as NonNullable<typeof card.progress>;
    const select = document.createElement('select');
    select.innerHTML =
      '<option value="saved">Saved</option><option value="completed">Completed</option>';
    select.value = 'completed';
    const emit = vi.spyOn(card.progressChange, 'emit');
    card.changeStatus({ target: select } as unknown as Event);
    expect(select.value).toBe('saved');
    expect(emit).toHaveBeenCalledWith({ status: 'completed' });
  });
  it('validates explicit progress, permits zero and leaves unknown progress null', () => {
    card.learningReady = true;
    card.progress = { status: 'saved' } as NonNullable<typeof card.progress>;
    const emit = vi.spyOn(card.progressChange, 'emit');
    card.percent = 0;
    card.notes = 'Recorded';
    card.saveDetails();
    expect(emit).toHaveBeenLastCalledWith({
      status: 'saved',
      notes: 'Recorded',
      progressPercent: 0,
    });
    card.percent = 101;
    card.saveDetails();
    expect(emit).toHaveBeenCalledTimes(1);
    card.percent = null;
    card.saveDetails();
    expect(emit).toHaveBeenLastCalledWith({
      status: 'saved',
      notes: 'Recorded',
      progressPercent: null,
    });
  });
});
