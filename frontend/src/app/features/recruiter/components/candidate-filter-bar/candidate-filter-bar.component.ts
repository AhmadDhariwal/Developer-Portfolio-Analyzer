import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../../../shared/components/searchable-select/searchable-select.component';
import { CandidateFilters, DEFAULT_CANDIDATE_FILTERS } from '../../models/recruiter.model';

@Component({
  selector: 'app-candidate-filter-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  templateUrl: './candidate-filter-bar.component.html',
  styleUrl: './candidate-filter-bar.component.scss',
})
export class CandidateFilterBarComponent {
  draft: CandidateFilters = { ...DEFAULT_CANDIDATE_FILTERS };

  @Input() set model(value: CandidateFilters) {
    this.draft = { ...value };
  }
  @Input() stackOptions: SearchableSelectOption[] = [];
  @Input() locationOptions: SearchableSelectOption[] = [];
  @Output() apply = new EventEmitter<CandidateFilters>();
  @Output() clear = new EventEmitter<void>();

  readonly sortOptions: SearchableSelectOption[] = [
    { value: 'score-desc', label: 'Highest score' },
    { value: 'experience-desc', label: 'Most experience' },
    { value: 'latest', label: 'Recently active' },
    { value: 'name-asc', label: 'Name A-Z' },
    { value: 'score-asc', label: 'Lowest score' },
  ];

  submit(): void {
    this.apply.emit({ ...this.draft, minReadiness: this.draft.minReadiness ?? 0 });
  }
}
