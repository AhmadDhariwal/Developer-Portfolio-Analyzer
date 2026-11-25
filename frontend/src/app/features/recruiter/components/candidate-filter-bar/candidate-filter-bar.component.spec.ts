import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, expect, it, vi } from 'vitest';
import { SearchableSelectComponent } from '../../../../shared/components/searchable-select/searchable-select.component';
import { DEFAULT_CANDIDATE_FILTERS } from '../../models/recruiter.model';
import { CandidateFilterBarComponent } from './candidate-filter-bar.component';

describe('CandidateFilterBarComponent', () => {
  it('submits all dropdown selections while leaving the applied filters untouched until submit', async () => {
    await TestBed.configureTestingModule({
      imports: [CandidateFilterBarComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(CandidateFilterBarComponent);
    const applied = { ...DEFAULT_CANDIDATE_FILTERS };
    fixture.componentRef.setInput('model', applied);
    fixture.detectChanges();

    const submit = vi.fn();
    fixture.componentInstance.apply.subscribe(submit);
    const selects = fixture.debugElement.queryAll(By.directive(SearchableSelectComponent));
    selects[0].componentInstance.valueChange.emit('Frontend');
    selects[1].componentInstance.valueChange.emit('Remote');
    selects[2].componentInstance.valueChange.emit('latest');
    expect(applied).toEqual(DEFAULT_CANDIDATE_FILTERS);
    expect(submit).not.toHaveBeenCalled();

    fixture.debugElement.queryAll(By.css('button.filter-btn'))[1].nativeElement.click();
    expect(submit).toHaveBeenCalledWith({
      ...applied,
      stack: 'Frontend',
      location: 'Remote',
      sortBy: 'latest',
    });
  });
});
