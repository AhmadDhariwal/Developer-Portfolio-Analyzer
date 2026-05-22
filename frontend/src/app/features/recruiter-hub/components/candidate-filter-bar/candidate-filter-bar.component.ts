import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SearchableSelectComponent, SearchableSelectOption } from '../../../../shared/components/searchable-select/searchable-select.component';

@Component({
  selector: 'app-candidate-filter-bar',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchableSelectComponent],
  template: `
    <div class="filter-bar">
      <div class="filter-field filter-field--search">
        <label>Search</label>
        <input [(ngModel)]="model.search" placeholder="Name, stack, skills, GitHub" (keyup.enter)="apply.emit(model)" />
      </div>
      <div class="filter-field">
        <label>Stack</label>
        <app-searchable-select [options]="stackOptions" [value]="model.stack" [emptyOptionLabel]="'All stacks'" (valueChange)="setValue('stack',$event)" />
      </div>
      <div class="filter-field">
        <label>Location</label>
        <app-searchable-select [options]="locationOptions" [value]="model.location" [emptyOptionLabel]="'All locations'" (valueChange)="setValue('location',$event)" />
      </div>
      <div class="filter-field">
        <label>Skills</label>
        <input [(ngModel)]="model.skills" placeholder="React, Node.js, Python" (keyup.enter)="apply.emit(model)" />
      </div>
      <div class="filter-field">
        <label>Min Score</label>
        <input [(ngModel)]="model.minReadiness" type="number" min="0" max="100" placeholder="70" />
      </div>
      <div class="filter-field">
        <label>Sort</label>
        <app-searchable-select [options]="sortOptions" [value]="model.sortBy || 'score-desc'" [emptyOptionLabel]="'Highest score'" (valueChange)="setValue('sortBy',$event || 'score-desc')" />
      </div>
      <div class="filter-actions">
        <button type="button" class="filter-btn filter-btn--ghost" (click)="clear.emit()">Clear</button>
        <button type="button" class="filter-btn" (click)="apply.emit(model)">Apply Filters</button>
      </div>
    </div>
  `,
  styles: [`
    .filter-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.9rem;padding:1rem 1.1rem;border-radius:20px;background:linear-gradient(180deg,rgba(15,23,42,.92),rgba(15,23,42,.78));border:1px solid rgba(99,102,241,.18);box-shadow:0 20px 40px rgba(2,6,23,.24)}
    .filter-field{display:flex;flex-direction:column;gap:.4rem}
    .filter-field--search{grid-column:span 2}
    .filter-field label{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
    input{width:100%;min-height:44px;border-radius:12px;border:1px solid rgba(71,85,105,.75);background:rgba(15,23,42,.86);color:#f8fafc;padding:.75rem .9rem;outline:none;transition:border-color .18s ease,box-shadow .18s ease}
    input:focus{border-color:rgba(129,140,248,.65);box-shadow:0 0 0 3px rgba(99,102,241,.14)}
    .filter-actions{display:flex;gap:.75rem;align-items:flex-end;justify-content:flex-end}
    .filter-btn{min-height:44px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem;box-shadow:0 12px 28px rgba(79,70,229,.28)}
    .filter-btn--ghost{background:rgba(30,41,59,.86);color:#cbd5e1;box-shadow:none}
    @media (max-width: 820px){.filter-field--search{grid-column:span 1}.filter-actions{justify-content:stretch}.filter-btn{width:100%}}
  `]
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
    { value: 'score-asc', label: 'Lowest score' }
  ];

  setValue(key: string, value: string): void {
    this.model = { ...this.model, [key]: value };
  }
}
