import { CourseFiltersComponent } from './course-filters';
import { TestBed } from '@angular/core/testing';

describe('Staged course filters', () => {
  it('keeps search and selections staged until explicit apply', () => {
    const filters = new CourseFiltersComponent();
    filters.ngOnInit();
    const emit = vi.spyOn(filters.filtersChange, 'emit');
    filters.filters.topic = ' SQL ';
    filters.filters.platform = 'YouTube';
    filters.onFilterChange();
    expect(emit).not.toHaveBeenCalled();
    expect(filters.hasPendingChanges).toBe(true);
    filters.applyFilters();
    expect(emit).toHaveBeenCalledWith({
      platform: 'YouTube',
      rating: '',
      level: 'All',
      duration: 'All',
      topic: 'SQL',
    });
    expect(filters.hasPendingChanges).toBe(false);
  });
  it('clears search as a draft and resets all filters explicitly', () => {
    const filters = new CourseFiltersComponent();
    filters.initialFilters = { topic: 'Angular', rating: '4.5' };
    filters.ngOnInit();
    const emit = vi.spyOn(filters.filtersReset, 'emit');
    filters.clearTopic();
    expect(filters.appliedFilters.topic).toBe('Angular');
    expect(filters.hasPendingChanges).toBe(true);
    filters.resetFilters();
    expect(emit).toHaveBeenCalledOnce();
    expect(filters.hasDraftFilters).toBe(false);
  });
  it('deduplicates eligible skill options and cannot submit an arbitrary personalized topic', () => {
    const filters = new CourseFiltersComponent();
    filters.personalized = true;
    filters.recommendedSkills = ['Docker', ' docker ', 'Node.js'];
    filters.ngOnInit();
    expect(filters.skillOptions).toEqual(['Docker', 'Node.js']);
    filters.filters.topic = 'AWS';
    filters.applyFilters();
    expect(filters.filters.topic).toBe('');
    filters.filters.topic = 'Docker';
    filters.applyFilters();
    expect(filters.filters.topic).toBe('Docker');
  });
  it('renders only the recommended dropdown in For You and unrestricted search in Discover', async () => {
    const fixture = TestBed.createComponent(CourseFiltersComponent);
    fixture.componentRef.setInput('personalized', true);
    fixture.componentRef.setInput('recommendedSkills', ['Docker', 'docker', 'Angular']);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[type="search"]')).toBeNull();
    const choices = Array.from(
      fixture.nativeElement.querySelector('select[name="topic"]').options as HTMLOptionsCollection,
    ).map((option) => option.text.trim());
    expect(choices).toEqual(['All Recommended Skills', 'Docker', 'Angular']);
    fixture.componentRef.setInput('personalized', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('input[type="search"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('select[name="topic"]')).toBeNull();
    fixture.destroy();
  });
});
