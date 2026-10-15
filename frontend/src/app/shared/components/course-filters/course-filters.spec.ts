import { CourseFiltersComponent } from './course-filters';

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
});
