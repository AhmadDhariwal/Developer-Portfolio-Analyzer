import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  SearchableSelectComponent,
  SearchableSelectOption,
} from '../../../../shared/components/searchable-select/searchable-select.component';

@Component({
  selector: 'app-candidate-filter-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  templateUrl: './candidate-filter-bar.component.html',
  styleUrl: './candidate-filter-bar.component.scss',
})
export class CandidateFilterBarComponent {
  @Input() model: any = {};
  @Input() stackOptions: SearchableSelectOption[] = [];
  @Input() locationOptions: SearchableSelectOption[] = [];
  @Output() apply = new EventEmitter<any>();
  @Output() clear = new EventEmitter<void>();

  readonly sortOptions: SearchableSelectOption[] = [
    { value: 'score-desc', label: 'Highest score' },
    { value: 'experience-desc', label: 'Most experience' },
    { value: 'latest', label: 'Recently active' },
    { value: 'name-asc', label: 'Name A-Z' },
    { value: 'score-asc', label: 'Lowest score' },
  ];

  setValue(key: string, value: string): void {
    this.model = { ...this.model, [key]: value };
  }
}
